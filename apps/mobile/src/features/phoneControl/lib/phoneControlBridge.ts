import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { formatSafeError } from '../../../lib/errors';

export type NotchVisualState =
  | 'listening'
  | 'speaking'
  | 'thinking'
  | 'acting'
  | 'confirm'
  | 'muted'
  | 'disconnected';

export type TypeSubmitMode = 'none' | 'send' | 'search' | 'enter';

export interface PhoneControlCapabilities {
  accessibilityConnected: boolean;
  accessibilityEnabled: boolean;
  notificationAccessConnected: boolean;
  notificationAccessEnabled: boolean;
  overlayPermissionGranted: boolean;
  notchAvailable: boolean;
}

export interface InstalledAppEntry {
  label: string;
  packageName: string;
}

export interface DeviceStatusSnapshot {
  batteryPercent: number;
  isCharging: boolean;
  mediaVolumePercent: number;
  foregroundPackage: string;
  accessibilityConnected: boolean;
  notificationAccessConnected: boolean;
}

export interface ScreenUiNode {
  i: number;
  t?: string;
  d?: string;
  id?: string;
  click?: boolean;
  edit?: boolean;
  scroll?: boolean;
  chk?: boolean;
  off?: boolean;
  x: number;
  y: number;
}

export interface ScreenUiDump {
  ok: boolean;
  error?: string;
  pkg?: string;
  w?: number;
  h?: number;
  n?: number;
  nodes?: ScreenUiNode[];
}

export interface RecentNotificationEntry {
  key: string;
  packageName: string;
  appName: string;
  title: string;
  text: string;
  timestamp: number;
  canReply: boolean;
}

interface NativePhoneControlModule {
  getCapabilities: () => Promise<PhoneControlCapabilities>;
  openAccessibilitySettings: () => Promise<boolean>;
  openNotificationListenerSettings: () => Promise<boolean>;
  openOverlaySettings: () => Promise<boolean>;
  listInstalledApps: (query: string | null) => Promise<InstalledAppEntry[]>;
  openApp: (
    appNameOrPackage: string,
  ) => Promise<{
    ok: boolean;
    packageName?: string;
    label?: string;
    verified?: boolean;
    actualPackage?: string;
    ambiguous?: boolean;
    matches?: string[];
    installedApps?: string[];
    error?: string;
  }>;
  openUrl: (
    url: string,
  ) => Promise<boolean | { ok: boolean; verified?: boolean; actualPackage?: string; error?: string }>;
  bringKallieToFront: () => Promise<boolean>;
  getDeviceStatus: () => Promise<DeviceStatusSnapshot>;
  setMediaVolume: (percent: number) => Promise<boolean>;
  getScreenUi: (maxNodes: number) => Promise<string>;
  inspectNodeLabel?: (nodeIndex: number) => Promise<string>;
  tapElement: (
    query: string | null,
    nodeIndex: number,
  ) => Promise<{ ok: boolean; message?: string; error?: string }>;
  tapXY: (x: number, y: number) => Promise<{ ok: boolean; error?: string }>;
  typeText: (
    text: string,
    targetQuery: string | null,
    submitMode: string,
  ) => Promise<{ ok: boolean; message?: string; error?: string }>;
  scrollScreen: (direction: string) => Promise<{ ok: boolean; error?: string }>;
  performSystemAction: (
    action: string,
  ) => Promise<boolean | { ok: boolean; error?: string }>;
  listRecentNotifications: (appFilter: string | null) => Promise<string>;
  hasReplyableNotification?: (key: string) => Promise<boolean>;
  replyToNotification: (
    key: string,
    replyText: string,
  ) => Promise<{ ok: boolean; message?: string; error?: string }>;
  showNotch: (state: string, statusText: string, audioLevel: number) => void;
  updateNotch: (state: string, statusText: string, audioLevel: number) => void;
  setNotchAudioLevel?: (audioLevel: number) => void;
  clearNotchAction?: () => void;
  showNotchConfirm: (
    requestId: string,
    title: string,
    preview: string,
    approveLabel: string,
  ) => void;
  clearNotchConfirm: (requestId: string | null) => void;
  hideNotch: () => void;
}

const nativeMod =
  Platform.OS === 'android'
    ? (NativeModules.KalliePhoneControl as NativePhoneControlModule | undefined)
    : undefined;

const emitter = nativeMod ? new NativeEventEmitter(nativeMod as never) : null;

const UNAVAILABLE_MSG = 'Native Android phone control is unavailable in this build.';

const DEFAULT_CAPABILITIES: PhoneControlCapabilities = {
  accessibilityConnected: false,
  accessibilityEnabled: false,
  notificationAccessConnected: false,
  notificationAccessEnabled: false,
  overlayPermissionGranted: false,
  notchAvailable: false,
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, timeoutMs);
    promise
      .then((val) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(val);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      });
  });
}

export const phoneControlBridge = {
  isAvailable(): boolean {
    return Boolean(nativeMod);
  },

  async getCapabilities(): Promise<PhoneControlCapabilities> {
    if (!nativeMod) return DEFAULT_CAPABILITIES;
    return withTimeout(nativeMod.getCapabilities(), 3_000, DEFAULT_CAPABILITIES);
  },

  async openAccessibilitySettings(): Promise<boolean> {
    if (!nativeMod) return false;
    return nativeMod.openAccessibilitySettings().catch(() => false);
  },

  async openNotificationListenerSettings(): Promise<boolean> {
    if (!nativeMod) return false;
    return nativeMod.openNotificationListenerSettings().catch(() => false);
  },

  async openOverlaySettings(): Promise<boolean> {
    if (!nativeMod) return false;
    return nativeMod.openOverlaySettings().catch(() => false);
  },

  async listInstalledApps(query?: string): Promise<InstalledAppEntry[]> {
    if (!nativeMod) return [];
    return withTimeout(nativeMod.listInstalledApps(query?.trim() || null), 5_000, []);
  },

  async openApp(appNameOrPackage: string): Promise<{
    ok: boolean;
    packageName?: string;
    label?: string;
    verified?: boolean;
    actualPackage?: string;
    ambiguous?: boolean;
    matches?: string[];
    installedApps?: string[];
    error?: string;
  }> {
    if (!nativeMod) return { ok: false, error: UNAVAILABLE_MSG };
    try {
      return await withTimeout(nativeMod.openApp(appNameOrPackage), 6_000, {
        ok: false,
        error: 'Timed out waiting for app to open.',
      });
    } catch (err) {
      return { ok: false, error: formatSafeError(err, 'Unable to open app') };
    }
  },

  async openUrl(url: string): Promise<{
    ok: boolean;
    verified?: boolean;
    actualPackage?: string;
    error?: string;
  }> {
    if (!nativeMod) return { ok: false, error: UNAVAILABLE_MSG };
    try {
      const res = await withTimeout(nativeMod.openUrl(url), 5_000, {
        ok: false,
        error: 'Timed out opening URL.',
      });
      if (typeof res === 'boolean') {
        return res ? { ok: true } : { ok: false, error: 'Unable to open URL.' };
      }
      return res;
    } catch (err) {
      return { ok: false, error: formatSafeError(err, 'Unable to open URL') };
    }
  },

  async bringKallieToFront(): Promise<boolean> {
    if (!nativeMod) return false;
    return withTimeout(nativeMod.bringKallieToFront(), 3_000, false);
  },

  async getDeviceStatus(): Promise<DeviceStatusSnapshot | null> {
    if (!nativeMod) return null;
    return withTimeout(nativeMod.getDeviceStatus(), 3_000, null);
  },

  async setMediaVolume(percent: number): Promise<boolean> {
    if (!nativeMod) return false;
    return nativeMod.setMediaVolume(Math.round(percent)).catch(() => false);
  },

  async getScreenUi(maxNodes = 55): Promise<ScreenUiDump> {
    if (!nativeMod) return { ok: false, error: UNAVAILABLE_MSG };
    try {
      const raw = await withTimeout(
        nativeMod.getScreenUi(maxNodes),
        4_500,
        '{"ok":false,"error":"Timed out reading screen UI."}',
      );
      return JSON.parse(raw) as ScreenUiDump;
    } catch (err) {
      return { ok: false, error: formatSafeError(err, 'Failed to inspect screen UI') };
    }
  },

  async inspectNodeLabel(nodeIndex: number): Promise<string> {
    if (!nativeMod?.inspectNodeLabel || nodeIndex < 0) return '';
    return withTimeout(nativeMod.inspectNodeLabel(nodeIndex), 2_000, '');
  },

  async tapElement(
    query?: string,
    nodeIndex = -1,
  ): Promise<{ ok: boolean; message?: string; error?: string }> {
    if (!nativeMod) return { ok: false, error: UNAVAILABLE_MSG };
    try {
      return await withTimeout(nativeMod.tapElement(query?.trim() || null, nodeIndex), 5_000, {
        ok: false,
        error: 'Tap timed out.',
      });
    } catch (err) {
      return { ok: false, error: formatSafeError(err, 'Tap failed') };
    }
  },

  async tapXY(x: number, y: number): Promise<{ ok: boolean; error?: string }> {
    if (!nativeMod) return { ok: false, error: UNAVAILABLE_MSG };
    try {
      return await withTimeout(nativeMod.tapXY(x, y), 5_000, {
        ok: false,
        error: 'Tap gesture timed out.',
      });
    } catch (err) {
      return { ok: false, error: formatSafeError(err, 'Tap failed') };
    }
  },

  async typeText(
    text: string,
    targetQuery?: string,
    submitMode: TypeSubmitMode = 'none',
  ): Promise<{ ok: boolean; message?: string; error?: string }> {
    if (!nativeMod) return { ok: false, error: UNAVAILABLE_MSG };
    try {
      return await withTimeout(
        nativeMod.typeText(text, targetQuery?.trim() || null, submitMode),
        6_500,
        { ok: false, error: 'Text entry timed out.' },
      );
    } catch (err) {
      return { ok: false, error: formatSafeError(err, 'Type failed') };
    }
  },

  async scrollScreen(
    direction: 'up' | 'down' | 'left' | 'right',
  ): Promise<{ ok: boolean; error?: string }> {
    if (!nativeMod) return { ok: false, error: UNAVAILABLE_MSG };
    try {
      return await withTimeout(nativeMod.scrollScreen(direction), 5_000, {
        ok: false,
        error: 'Scroll timed out.',
      });
    } catch (err) {
      return { ok: false, error: formatSafeError(err, 'Scroll failed') };
    }
  },

  async performSystemAction(
    action: 'back' | 'home' | 'recents' | 'notifications' | 'quick_settings' | 'lock_screen',
  ): Promise<{ ok: boolean; error?: string }> {
    if (!nativeMod) return { ok: false, error: UNAVAILABLE_MSG };
    const res = await withTimeout(nativeMod.performSystemAction(action), 3_000, {
      ok: false,
      error: 'System action timed out.',
    });
    if (typeof res === 'boolean') {
      return res ? { ok: true } : { ok: false, error: `Could not execute ${action}.` };
    }
    return res;
  },

  async listRecentNotificationsWithStatus(appFilter?: string): Promise<{
    notificationAccessConnected: boolean;
    notifications: RecentNotificationEntry[];
  }> {
    if (!nativeMod) {
      return { notificationAccessConnected: false, notifications: [] };
    }
    try {
      const raw = await withTimeout(
        nativeMod.listRecentNotifications(appFilter?.trim() || null),
        3_000,
        '{"notificationAccessConnected":false,"notifications":[]}',
      );
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return {
          notificationAccessConnected: true,
          notifications: parsed as RecentNotificationEntry[],
        };
      }
      return {
        notificationAccessConnected: Boolean(parsed?.notificationAccessConnected),
        notifications: Array.isArray(parsed?.notifications)
          ? (parsed.notifications as RecentNotificationEntry[])
          : [],
      };
    } catch {
      return { notificationAccessConnected: false, notifications: [] };
    }
  },

  async listRecentNotifications(appFilter?: string): Promise<RecentNotificationEntry[]> {
    const res = await this.listRecentNotificationsWithStatus(appFilter);
    return res.notifications;
  },

  async hasReplyableNotification(key: string): Promise<boolean> {
    if (!nativeMod?.hasReplyableNotification) return true;
    return withTimeout(nativeMod.hasReplyableNotification(key), 2_000, false);
  },

  async replyToNotification(
    key: string,
    replyText: string,
  ): Promise<{ ok: boolean; message?: string; error?: string }> {
    if (!nativeMod) return { ok: false, error: UNAVAILABLE_MSG };
    try {
      return await withTimeout(nativeMod.replyToNotification(key, replyText), 5_000, {
        ok: false,
        error: 'Quick reply timed out.',
      });
    } catch (err) {
      return { ok: false, error: formatSafeError(err, 'Reply failed') };
    }
  },

  showNotch(state: NotchVisualState, statusText: string, audioLevel = 0.14): void {
    nativeMod?.showNotch(state, statusText, audioLevel);
  },

  updateNotch(state: NotchVisualState, statusText: string, audioLevel = 0.14): void {
    nativeMod?.updateNotch(state, statusText, audioLevel);
  },

  setNotchAudioLevel(audioLevel: number): void {
    nativeMod?.setNotchAudioLevel?.(audioLevel);
  },

  clearNotchAction(): void {
    nativeMod?.clearNotchAction?.();
  },

  showNotchConfirm(
    requestId: string,
    title: string,
    preview: string,
    approveLabel = 'Send',
  ): void {
    nativeMod?.showNotchConfirm(requestId, title, preview, approveLabel);
  },

  clearNotchConfirm(requestId?: string): void {
    nativeMod?.clearNotchConfirm(requestId ?? null);
  },

  hideNotch(): void {
    nativeMod?.hideNotch();
  },

  onNotchStop(listener: () => void): () => void {
    if (!emitter) return () => {};
    const sub = emitter.addListener('KallieNotchStop', () => listener());
    return () => sub.remove();
  },

  onNotchConfirm(
    listener: (event: { requestId: string; approved: boolean }) => void,
  ): () => void {
    if (!emitter) return () => {};
    const sub = emitter.addListener('KallieNotchConfirm', (raw) => {
      const payload = raw as { requestId?: string; approved?: boolean };
      if (payload?.requestId) {
        listener({ requestId: payload.requestId, approved: Boolean(payload.approved) });
      }
    });
    return () => sub.remove();
  },
};
