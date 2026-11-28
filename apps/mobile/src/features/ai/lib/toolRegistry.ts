import { formatSafeError } from '../../../lib/errors';
import { generatePrefixedId } from '../../../lib/id';
import { getLocalDb } from '../../../lib/storage/localDb';
import {
  AutomationRunRecord,
  ToolPermissionPolicy,
  ToolPermissionRecord,
} from '../../../types/database';
import { localMemoryEngine } from '../../memory/lib/memoryRepository';
import {
  getPhoneAutomationEpoch,
  getPhoneControlSettingsSync,
  isSensitiveTapTarget,
  requestSensitiveActionApproval,
} from '../../phoneControl/lib/phoneActionSafety';
import {
  phoneControlBridge,
  TypeSubmitMode,
} from '../../phoneControl/lib/phoneControlBridge';
import {
  cancelSchedulesByQueryLocal,
  getSchedulesSync,
  upsertScheduleLocal,
} from '../../schedules/lib/schedulesRepository';
import { UnifiedToolDefinition } from './providerTypes';

export interface ToolExecutionContext {
  signal?: AbortSignal;
  epoch?: number;
}

export interface LocalToolHandler {
  definition: UnifiedToolDefinition;
  defaultPolicy: ToolPermissionPolicy;
  category?: 'phone' | 'memory' | 'schedule' | 'utility';
  execute: (
    args: Record<string, unknown>,
    ctx?: ToolExecutionContext,
  ) => Promise<Record<string, unknown>>;
}

// FIFO serializer ensures UI-mutating phone tools never overlap or collide across concurrent calls
let phoneToolQueue: Promise<unknown> = Promise.resolve();
let activePhoneToolCount = 0;

// Short-lived cache of the latest get_screen_ui node labels so tap_element safety checks avoid redundant IPC
let lastScreenLabels = new Map<number, string>();
let lastScreenLabelsAtMs = 0;

// Write-through in-memory cache of tool_permissions to eliminate synchronous SQLite reads per tool call
let toolPolicyCache: Map<string, ToolPermissionPolicy> | null = null;
let automationLogCounter = 0;

export function isPhoneToolRunning(): boolean {
  return activePhoneToolCount > 0;
}

function enqueuePhoneAction<T>(fn: () => Promise<T>): Promise<T> {
  const next = phoneToolQueue.then(async () => {
    activePhoneToolCount += 1;
    try {
      return await fn();
    } finally {
      activePhoneToolCount = Math.max(0, activePhoneToolCount - 1);
    }
  });
  phoneToolQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function updateNotchAction(label: string): void {
  if (!getPhoneControlSettingsSync().dynamicNotchEnabled) return;
  phoneControlBridge.updateNotch('acting', label, 0.35);
}

function isExecutionCancelled(ctx?: ToolExecutionContext): boolean {
  if (ctx?.signal?.aborted) return true;
  if (typeof ctx?.epoch === 'number' && getPhoneAutomationEpoch() !== ctx.epoch) {
    return true;
  }
  return false;
}

function sleepAbortable(ms: number, ctx?: ToolExecutionContext): Promise<void> {
  if (ms <= 0 || isExecutionCancelled(ctx)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ctx?.signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    ctx?.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function generateId(): string {
  return generatePrefixedId('run');
}

function resolveScheduleIso(args: Record<string, unknown>): string | null {
  const delay =
    typeof args.delayMinutes === 'number' ? args.delayMinutes : Number(args.delayMinutes);
  if (Number.isFinite(delay) && delay > 0) {
    return new Date(Date.now() + delay * 60_000).toISOString();
  }
  const isoRaw =
    typeof args.scheduledAt === 'string'
      ? args.scheduledAt
      : typeof args.scheduledAtIso === 'string'
        ? args.scheduledAtIso
        : '';
  if (isoRaw.trim()) {
    const parsed = new Date(isoRaw.trim());
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now() - 60_000) {
      return parsed.toISOString();
    }
  }
  return null;
}

export const LOCAL_TOOLS: Record<string, LocalToolHandler> = {
  get_current_time: {
    defaultPolicy: 'allow',
    category: 'utility',
    definition: {
      name: 'get_current_time',
      description: 'Get the current local date, time, and timezone.',
      parameters: { type: 'object', properties: {} },
    },
    execute: async () => ({
      ok: true,
      iso: new Date().toISOString(),
      localString: new Date().toLocaleString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Manila',
    }),
  },

  schedule_callback: {
    defaultPolicy: 'allow',
    category: 'schedule',
    definition: {
      name: 'schedule_callback',
      description: 'Schedule a local reminder or callback alarm on Android.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short reminder title.' },
          reminderNote: { type: 'string', description: 'Reminder detail.' },
          delayMinutes: { type: 'number', description: 'Relative delay in minutes.' },
          scheduledAt: { type: 'string', description: 'Future ISO-8601 datetime string.' },
          recurrence: { type: 'string', enum: ['none', 'daily', 'weekly'] },
        },
        required: ['title'],
      },
    },
    execute: async (args) => {
      const scheduledAt = resolveScheduleIso(args);
      if (!scheduledAt) {
        return { ok: false, error: 'Provide a valid future delayMinutes or scheduledAt ISO time.' };
      }
      const recurrence =
        args.recurrence === 'daily' || args.recurrence === 'weekly' ? args.recurrence : 'none';
      const saved = upsertScheduleLocal({
        title: String(args.title || 'Reminder'),
        ai_prompt: String(args.reminderNote || args.title || 'Scheduled check-in'),
        scheduled_at: scheduledAt,
        recurrence,
      });
      return {
        ok: true,
        id: saved.id,
        title: saved.title,
        scheduledAt: saved.scheduled_at,
        recurrence: saved.recurrence,
      };
    },
  },

  list_scheduled_calls: {
    defaultPolicy: 'allow',
    category: 'schedule',
    definition: {
      name: 'list_scheduled_calls',
      description: 'List active reminders and scheduled callbacks.',
      parameters: { type: 'object', properties: {} },
    },
    execute: async () => {
      const items = getSchedulesSync().filter((s) => s.status === 'active');
      return {
        ok: true,
        schedules: items.map((s) => ({
          id: s.id,
          title: s.title,
          note: s.ai_prompt,
          scheduledAt: s.next_run_at || s.scheduled_at,
          recurrence: s.recurrence,
        })),
      };
    },
  },

  cancel_scheduled_call: {
    defaultPolicy: 'allow',
    category: 'schedule',
    definition: {
      name: 'cancel_scheduled_call',
      description: 'Cancel matching local reminders by title keyword or "all".',
      parameters: {
        type: 'object',
        properties: {
          titleQuery: { type: 'string', description: 'Title keyword or "all".' },
        },
        required: ['titleQuery'],
      },
    },
    execute: async (args) => {
      const result = cancelSchedulesByQueryLocal(String(args.titleQuery || ''));
      return { ok: true, ...result };
    },
  },

  save_memory: {
    defaultPolicy: 'allow',
    category: 'memory',
    definition: {
      name: 'save_memory',
      description: 'Save a long-term preference or personal fact locally.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Fact or preference to remember.' },
          memoryType: {
            type: 'string',
            enum: ['preference', 'fact', 'episodic', 'procedural'],
          },
        },
        required: ['content'],
      },
    },
    execute: async (args) => {
      const content = String(args.content || '').trim();
      if (!content) return { ok: false, error: 'Memory content cannot be empty.' };
      const memoryType =
        args.memoryType === 'preference' ||
        args.memoryType === 'episodic' ||
        args.memoryType === 'procedural'
          ? args.memoryType
          : 'fact';
      const { memory, action } = await localMemoryEngine.ingest({ content, memoryType });
      return { ok: true, id: memory.id, action, content: memory.content };
    },
  },

  search_memory: {
    defaultPolicy: 'allow',
    category: 'memory',
    definition: {
      name: 'search_memory',
      description: 'Search local long-term memories.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search topic or keywords.' },
        },
        required: ['query'],
      },
    },
    execute: async (args) => {
      const hits = await localMemoryEngine.retrieve(String(args.query || ''), { limit: 6 });
      return {
        ok: true,
        memories: hits.map((h) => ({
          id: h.memory.id,
          type: h.memory.memoryType,
          content: h.memory.content,
          confidence: h.memory.confidence,
        })),
      };
    },
  },

  list_installed_apps: {
    defaultPolicy: 'allow',
    category: 'phone',
    definition: {
      name: 'list_installed_apps',
      description: 'List installed launchable Android apps, optionally filtered by keyword.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional app name filter.' },
        },
      },
    },
    execute: async (args) => {
      const query = typeof args.query === 'string' ? args.query : undefined;
      const apps = await phoneControlBridge.listInstalledApps(query);
      return { ok: true, count: apps.length, apps: apps.slice(0, 40) };
    },
  },

  open_app: {
    defaultPolicy: 'allow',
    category: 'phone',
    definition: {
      name: 'open_app',
      description:
        'Dynamically find and open ANY installed Android app by display name, acronym, or package name. If no exact match is found, returns the phone’s installedApps list so you can choose the exact app.',
      parameters: {
        type: 'object',
        properties: {
          appName: { type: 'string', description: 'App name, acronym, or package.' },
        },
        required: ['appName'],
      },
    },
    execute: async (args) => {
      const appName = String(args.appName || '').trim();
      if (!appName) return { ok: false, error: 'Missing appName.' };
      updateNotchAction(`Opening ${appName}…`);
      // Native openApp uses BAL-exempt Accessibility launch & verifies foreground switch
      return phoneControlBridge.openApp(appName);
    },
  },

  open_url: {
    defaultPolicy: 'allow',
    category: 'phone',
    definition: {
      name: 'open_url',
      description: 'Open a web URL or Android deep link (https://, tel:, geo:, fb-messenger://).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Valid URL or deep-link URI.' },
        },
        required: ['url'],
      },
    },
    execute: async (args, ctx) => {
      const url = String(args.url || '').trim();
      if (!url) return { ok: false, error: 'Missing url.' };
      updateNotchAction('Opening link…');
      const res = await phoneControlBridge.openUrl(url);
      if (res.ok) await sleepAbortable(260, ctx);
      return res;
    },
  },

  get_device_status: {
    defaultPolicy: 'allow',
    category: 'phone',
    definition: {
      name: 'get_device_status',
      description: 'Get battery %, charging state, media volume, foreground app, and phone control status.',
      parameters: { type: 'object', properties: {} },
    },
    execute: async () => {
      const status = await phoneControlBridge.getDeviceStatus();
      if (!status) {
        return { ok: false, error: 'Device status unavailable on this platform.' };
      }
      return { ok: true, ...status };
    },
  },

  set_media_volume: {
    defaultPolicy: 'allow',
    category: 'phone',
    definition: {
      name: 'set_media_volume',
      description: 'Set Android media volume percentage (0-100).',
      parameters: {
        type: 'object',
        properties: {
          percent: { type: 'number', description: 'Volume percentage (0-100).' },
        },
        required: ['percent'],
      },
    },
    execute: async (args) => {
      const pct = Number(args.percent);
      if (!Number.isFinite(pct)) return { ok: false, error: 'Invalid percent.' };
      const ok = await phoneControlBridge.setMediaVolume(pct);
      return { ok, mediaVolumePercent: Math.max(0, Math.min(100, Math.round(pct))) };
    },
  },

  get_screen_ui: {
    defaultPolicy: 'allow',
    category: 'phone',
    definition: {
      name: 'get_screen_ui',
      description:
        'Read visible UI elements on the current Android screen (i=index, t=text, d=desc, id=viewId, click/edit/scroll, x/y).',
      parameters: {
        type: 'object',
        properties: {
          maxNodes: { type: 'number', description: 'Max UI nodes (default 55).' },
        },
      },
    },
    execute: async (args) => {
      updateNotchAction('Reading screen…');
      const maxNodes = typeof args.maxNodes === 'number' ? args.maxNodes : 55;
      const dump = await phoneControlBridge.getScreenUi(maxNodes);
      if (dump.ok && Array.isArray(dump.nodes)) {
        const nextMap = new Map<number, string>();
        for (const node of dump.nodes) {
          const label = [node.t, node.d, node.id].filter(Boolean).join(' ').trim();
          if (label) nextMap.set(node.i, label);
        }
        lastScreenLabels = nextMap;
        lastScreenLabelsAtMs = Date.now();
      }
      return dump as unknown as Record<string, unknown>;
    },
  },

  tap_element: {
    defaultPolicy: 'allow',
    category: 'phone',
    definition: {
      name: 'tap_element',
      description: 'Tap a visible UI element by text/description/viewId or nodeIndex from get_screen_ui.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Label, description, or viewId.' },
          nodeIndex: { type: 'number', description: 'Index from get_screen_ui.' },
          actionSummary: {
            type: 'string',
            description: 'Preview text when tapping a Send/Post/Delete button.',
          },
        },
      },
    },
    execute: async (args, ctx) => {
      const query = typeof args.query === 'string' ? args.query.trim() : undefined;
      const nodeIndex = typeof args.nodeIndex === 'number' ? args.nodeIndex : -1;
      if (!query && nodeIndex < 0) {
        return { ok: false, error: 'Provide either query or nodeIndex.' };
      }

      // ALWAYS inspect nodeIndex label even when query is also supplied (prevents Send/Delete gate bypass)
      let inspectedLabel = '';
      if (nodeIndex >= 0) {
        const cacheFresh = Date.now() - lastScreenLabelsAtMs < 12_000;
        if (cacheFresh && lastScreenLabels.has(nodeIndex)) {
          inspectedLabel = lastScreenLabels.get(nodeIndex) || '';
        } else {
          inspectedLabel = await phoneControlBridge.inspectNodeLabel(nodeIndex);
        }
      }
      const combinedLabel = [query, inspectedLabel].filter(Boolean).join(' ').trim();
      const displayLabel = inspectedLabel || query || '';

      if (isSensitiveTapTarget(combinedLabel)) {
        const preview =
          typeof args.actionSummary === 'string' && args.actionSummary.trim()
            ? args.actionSummary.trim()
            : `Tap "${displayLabel}" on screen?`;
        const approval = await requestSensitiveActionApproval({
          title: 'Confirm screen action',
          preview,
          approveLabel: /\bsend\b/i.test(combinedLabel) ? 'Send' : 'Confirm',
        });
        if (!approval.approved) {
          return {
            ok: false,
            cancelled: true,
            reason: approval.via,
            error: `User did not approve tapping "${displayLabel}" (${approval.via}).`,
          };
        }
      }

      if (isExecutionCancelled(ctx)) {
        return { ok: false, cancelled: true, error: 'Action cancelled.' };
      }

      updateNotchAction(displayLabel ? `Tapping ${displayLabel.slice(0, 18)}…` : 'Tapping…');
      const res = await phoneControlBridge.tapElement(query, nodeIndex);
      if (res.ok) await sleepAbortable(160, ctx);
      return res;
    },
  },

  tap_xy: {
    defaultPolicy: 'allow',
    category: 'phone',
    definition: {
      name: 'tap_xy',
      description: 'Tap exact (x, y) pixel coordinates on screen.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X pixel coordinate.' },
          y: { type: 'number', description: 'Y pixel coordinate.' },
        },
        required: ['x', 'y'],
      },
    },
    execute: async (args, ctx) => {
      const x = Number(args.x);
      const y = Number(args.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
        return { ok: false, error: 'Invalid x/y coordinates (must be non-negative numbers).' };
      }
      updateNotchAction('Tapping screen…');
      const res = await phoneControlBridge.tapXY(x, y);
      if (res.ok) await sleepAbortable(140, ctx);
      return res;
    },
  },

  type_text: {
    defaultPolicy: 'allow',
    category: 'phone',
    definition: {
      name: 'type_text',
      description:
        'Type text into a focused or matching input field. Use submitMode="search" for search bars, "send" for chat messages (triggers confirmation), "enter" for keyboard submit, or "none".',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to type.' },
          targetQuery: {
            type: 'string',
            description: 'Optional input/search bar label (expands search bars automatically).',
          },
          submitMode: {
            type: 'string',
            enum: ['none', 'send', 'search', 'enter'],
            description: 'Submission mode after typing.',
          },
          recipientName: {
            type: 'string',
            description: 'Recipient name for confirmation preview when sending a message.',
          },
        },
        required: ['text'],
      },
    },
    execute: async (args, ctx) => {
      const text = String(args.text || '');
      const targetQuery =
        typeof args.targetQuery === 'string' && args.targetQuery.trim()
          ? args.targetQuery.trim()
          : undefined;
      const rawMode = typeof args.submitMode === 'string' ? args.submitMode.toLowerCase() : '';
      const submitMode: TypeSubmitMode =
        rawMode === 'send' || rawMode === 'search' || rawMode === 'enter' || rawMode === 'none'
          ? rawMode
          : args.submit === true
            ? 'send'
            : 'none';
      const recipient =
        typeof args.recipientName === 'string' && args.recipientName.trim()
          ? args.recipientName.trim()
          : '';

      if (submitMode === 'send' && !text.trim()) {
        return { ok: false, error: 'Cannot send an empty message.' };
      }

      if (submitMode === 'send') {
        const approval = await requestSensitiveActionApproval({
          title: recipient ? `Send to ${recipient}` : 'Confirm send message',
          preview: text,
          approveLabel: 'Send',
        });
        if (!approval.approved) {
          return {
            ok: false,
            cancelled: true,
            reason: approval.via,
            error: `Message send cancelled (${approval.via}).`,
          };
        }
      }

      if (isExecutionCancelled(ctx)) {
        return { ok: false, cancelled: true, error: 'Action cancelled.' };
      }

      updateNotchAction(
        submitMode === 'send'
          ? 'Sending message…'
          : submitMode === 'search'
            ? 'Searching…'
            : 'Typing…',
      );
      const res = await phoneControlBridge.typeText(text, targetQuery, submitMode);
      if (res.ok) await sleepAbortable(160, ctx);
      return res;
    },
  },

  scroll_screen: {
    defaultPolicy: 'allow',
    category: 'phone',
    definition: {
      name: 'scroll_screen',
      description: 'Scroll the active Android screen up, down, left, or right.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        },
        required: ['direction'],
      },
    },
    execute: async (args, ctx) => {
      const dir = String(args.direction || 'down').toLowerCase();
      if (dir !== 'up' && dir !== 'down' && dir !== 'left' && dir !== 'right') {
        return { ok: false, error: 'direction must be up, down, left, or right.' };
      }
      updateNotchAction(`Scrolling ${dir}…`);
      const res = await phoneControlBridge.scrollScreen(dir);
      if (res.ok) await sleepAbortable(160, ctx);
      return res;
    },
  },

  system_action: {
    defaultPolicy: 'allow',
    category: 'phone',
    definition: {
      name: 'system_action',
      description: 'Run Android system navigation (back, home, recents, notifications, quick_settings, lock_screen).',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['back', 'home', 'recents', 'notifications', 'quick_settings', 'lock_screen'],
          },
        },
        required: ['action'],
      },
    },
    execute: async (args, ctx) => {
      const action = String(args.action || '').toLowerCase() as
        | 'back'
        | 'home'
        | 'recents'
        | 'notifications'
        | 'quick_settings'
        | 'lock_screen';
      updateNotchAction(`Running ${action}…`);
      const res = await phoneControlBridge.performSystemAction(action);
      if (res.ok) await sleepAbortable(180, ctx);
      return { ok: res.ok, action, ...(res.error ? { error: res.error } : {}) };
    },
  },

  list_recent_notifications: {
    defaultPolicy: 'allow',
    category: 'phone',
    definition: {
      name: 'list_recent_notifications',
      description: 'List recent Android chat notifications with keys for 1-step inline reply.',
      parameters: {
        type: 'object',
        properties: {
          appFilter: { type: 'string', description: 'Optional app or sender filter.' },
        },
      },
    },
    execute: async (args) => {
      const filter = typeof args.appFilter === 'string' ? args.appFilter : undefined;
      const { notificationAccessConnected, notifications } =
        await phoneControlBridge.listRecentNotificationsWithStatus(filter);
      if (!notificationAccessConnected && notifications.length === 0) {
        return {
          ok: true,
          notificationAccessConnected: false,
          count: 0,
          notifications: [],
          note: 'Notification Access is not enabled. Use open_app + get_screen_ui instead.',
        };
      }
      return {
        ok: true,
        notificationAccessConnected,
        count: notifications.length,
        notifications,
      };
    },
  },

  reply_notification: {
    defaultPolicy: 'allow',
    category: 'phone',
    definition: {
      name: 'reply_notification',
      description: 'Send a 1-step inline reply to a recent messaging notification without opening the app.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Notification key from list_recent_notifications.' },
          message: { type: 'string', description: 'Reply text.' },
          recipientName: { type: 'string', description: 'Recipient name for confirmation.' },
        },
        required: ['key', 'message'],
      },
    },
    execute: async (args, ctx) => {
      const key = String(args.key || '').trim();
      const message = String(args.message || '').trim();
      const recipient =
        typeof args.recipientName === 'string' && args.recipientName.trim()
          ? args.recipientName.trim()
          : 'contact';
      if (!key || !message) {
        return { ok: false, error: 'Both key and message are required.' };
      }

      // Verify notification is still active & replyable BEFORE showing the Confirm Card
      const stillValid = await phoneControlBridge.hasReplyableNotification(key);
      if (!stillValid) {
        return {
          ok: false,
          error: 'Notification expired or was dismissed. Open the app to reply instead.',
        };
      }

      const approval = await requestSensitiveActionApproval({
        title: `Quick reply to ${recipient}`,
        preview: message,
        approveLabel: 'Send',
      });
      if (!approval.approved) {
        return {
          ok: false,
          cancelled: true,
          reason: approval.via,
          error: `Quick reply cancelled (${approval.via}).`,
        };
      }

      if (isExecutionCancelled(ctx)) {
        return { ok: false, cancelled: true, error: 'Action cancelled.' };
      }

      updateNotchAction(`Replying to ${recipient.slice(0, 14)}…`);
      return phoneControlBridge.replyToNotification(key, message);
    },
  },

  return_to_kallie: {
    defaultPolicy: 'allow',
    category: 'phone',
    definition: {
      name: 'return_to_kallie',
      description: 'Bring the Kallie app back to the foreground.',
      parameters: { type: 'object', properties: {} },
    },
    execute: async () => {
      const ok = await phoneControlBridge.bringKallieToFront();
      return { ok };
    },
  },
};

const ALL_TOOL_DEFINITIONS: UnifiedToolDefinition[] = Object.values(LOCAL_TOOLS).map(
  (t) => t.definition,
);

const VOICE_END_CALL_TOOL: UnifiedToolDefinition = {
  name: 'end_call',
  description: 'End the voice call cleanly after saying goodbye.',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string' },
    },
  },
};

const VOICE_TOOL_DEFINITIONS: UnifiedToolDefinition[] = [
  ...ALL_TOOL_DEFINITIONS,
  VOICE_END_CALL_TOOL,
];

export function isPhoneControlTool(toolName: string): boolean {
  return LOCAL_TOOLS[toolName]?.category === 'phone';
}

export function getAutomationEpochSnapshot(): number {
  return getPhoneAutomationEpoch();
}

export function getAllToolDefinitions(): UnifiedToolDefinition[] {
  return ALL_TOOL_DEFINITIONS;
}

export function getVoiceToolDefinitions(): UnifiedToolDefinition[] {
  return VOICE_TOOL_DEFINITIONS;
}

function ensureToolPolicyCache(): Map<string, ToolPermissionPolicy> {
  if (toolPolicyCache) return toolPolicyCache;
  const map = new Map<string, ToolPermissionPolicy>();
  const db = getLocalDb();
  if (db) {
    try {
      const rows = db.getAllSync<{ tool_id: string; policy: ToolPermissionPolicy }>(
        'SELECT tool_id, policy FROM tool_permissions',
      );
      for (const row of rows) {
        if (row?.tool_id && row?.policy) {
          map.set(row.tool_id, row.policy);
        }
      }
    } catch {
      // Fallback to defaults
    }
  }
  toolPolicyCache = map;
  return map;
}

export function getToolPermissionPolicy(toolId: string): ToolPermissionPolicy {
  const cached = ensureToolPolicyCache().get(toolId);
  if (cached) return cached;
  return LOCAL_TOOLS[toolId]?.defaultPolicy ?? 'allow';
}

export function setToolPermissionPolicy(toolId: string, policy: ToolPermissionPolicy): void {
  ensureToolPolicyCache().set(toolId, policy);
  const db = getLocalDb();
  if (!db) return;
  try {
    db.runSync(
      `INSERT INTO tool_permissions (tool_id, policy, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(tool_id) DO UPDATE SET policy = excluded.policy, updated_at = excluded.updated_at`,
      [toolId, policy, new Date().toISOString()],
    );
  } catch {
    // Ignore
  }
}

export function listToolPermissionsSync(): ToolPermissionRecord[] {
  const cache = ensureToolPolicyCache();
  const nowIso = new Date().toISOString();
  return Object.keys(LOCAL_TOOLS).map((toolId) => ({
    toolId,
    policy: cache.get(toolId) ?? LOCAL_TOOLS[toolId].defaultPolicy ?? 'allow',
    updatedAt: nowIso,
  }));
}

function logAutomationRun(record: AutomationRunRecord): void {
  const db = getLocalDb();
  if (!db) return;
  try {
    // Truncate bulky screen dumps so automation_runs never bloats SQLite
    const inputTrimmed = record.inputJson.slice(0, 512);
    const outputTrimmed = record.outputJson ? record.outputJson.slice(0, 512) : null;
    db.runSync(
      `INSERT INTO automation_runs (id, tool_id, conversation_id, input_json, output_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.toolId,
        record.conversationId,
        inputTrimmed,
        outputTrimmed,
        record.status,
        record.createdAt,
      ],
    );
    automationLogCounter += 1;
    if (automationLogCounter % 25 === 0) {
      db.runSync(
        `DELETE FROM automation_runs WHERE id NOT IN (
           SELECT id FROM automation_runs ORDER BY created_at DESC LIMIT 200
         )`,
      );
    }
  } catch {
    // Ignore logging error
  }
}

export async function executeLocalTool(
  toolName: string,
  args: Record<string, unknown>,
  conversationId: string | null = null,
  ctx?: ToolExecutionContext,
): Promise<Record<string, unknown>> {
  const handler = LOCAL_TOOLS[toolName];
  if (!handler) {
    return { ok: false, error: `Unknown local tool "${toolName}".` };
  }

  const runTool = async (): Promise<Record<string, unknown>> => {
    if (isExecutionCancelled(ctx)) {
      return { ok: false, cancelled: true, error: 'Automation was stopped by user.' };
    }

    const policy = getToolPermissionPolicy(toolName);
    const nowIso = new Date().toISOString();
    if (policy === 'deny') {
      logAutomationRun({
        id: generateId(),
        toolId: toolName,
        conversationId,
        inputJson: JSON.stringify(args),
        outputJson: JSON.stringify({ ok: false, error: 'Denied by tool permission policy' }),
        status: 'denied',
        createdAt: nowIso,
      });
      return { ok: false, error: `Tool "${toolName}" is disabled in Settings → Access.` };
    }

    if (policy === 'ask') {
      const approval = await requestSensitiveActionApproval({
        title: `Allow ${toolName}?`,
        preview: JSON.stringify(args).slice(0, 140),
        approveLabel: 'Allow',
        forceConfirm: true,
      });
      if (!approval.approved) {
        return { ok: false, cancelled: true, error: `Permission denied for "${toolName}".` };
      }
    }

    try {
      const result = await handler.execute(args, ctx);
      logAutomationRun({
        id: generateId(),
        toolId: toolName,
        conversationId,
        inputJson: JSON.stringify(args),
        outputJson: JSON.stringify(result),
        status: result.ok === false ? 'failed' : 'executed',
        createdAt: nowIso,
      });
      return result;
    } catch (err) {
      const message = formatSafeError(err, 'Tool execution error');
      logAutomationRun({
        id: generateId(),
        toolId: toolName,
        conversationId,
        inputJson: JSON.stringify(args),
        outputJson: JSON.stringify({ ok: false, error: message }),
        status: 'failed',
        createdAt: nowIso,
      });
      return { ok: false, error: message };
    } finally {
      if (handler.category === 'phone') {
        phoneControlBridge.clearNotchAction();
      }
    }
  };

  if (handler.category === 'phone') {
    return enqueuePhoneAction(runTool);
  }
  return runTool();
}
