import { Linking, PermissionsAndroid, Platform } from 'react-native';
import { getPreferenceSync, setPreferenceSync } from '../../../lib/storage/localDb';
import { nativeIncomingCall } from '../../calling/lib/nativeIncomingCall';
import { phoneControlBridge } from '../../phoneControl/lib/phoneControlBridge';

export type PermissionId =
  | 'microphone'
  | 'notifications'
  | 'fullScreenIntent'
  | 'camera'
  | 'accessibility'
  | 'notificationAccess';

export type PermissionStatus = 'granted' | 'denied' | 'blocked' | 'unavailable';

export interface PermissionDescriptor {
  id: PermissionId;
  title: string;
  description: string;
  required: boolean;
  supported: boolean;
}

export interface PermissionMeta {
  asked: boolean;
  wasEverGranted: boolean;
  revoked: boolean;
  blocked: boolean;
}

export interface PermissionSnapshot {
  hydrated: boolean;
  statuses: Record<PermissionId, PermissionStatus>;
  meta: Record<PermissionId, PermissionMeta>;
  busyKey: PermissionId | null;
}

const PERMISSION_META_PREF_KEY = 'kallie_permission_meta_v1';

const IS_ANDROID = Platform.OS === 'android';
const ANDROID_API = IS_ANDROID ? Number(Platform.Version) : 0;

export const SUPPORTS_NOTIFICATIONS_RUNTIME = !IS_ANDROID || ANDROID_API >= 33;
export const SUPPORTS_FULL_SCREEN_INTENT_TOGGLE = IS_ANDROID && ANDROID_API >= 34;

export const PERMISSION_DESCRIPTORS: readonly PermissionDescriptor[] = [
  {
    id: 'microphone',
    title: 'Microphone',
    description: 'Required so Kallie can hear you during live voice calls.',
    required: true,
    supported: true,
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Delivers incoming scheduled calls and pre-call reminders.',
    required: false,
    supported: true,
  },
  {
    id: 'fullScreenIntent',
    title: 'Full-screen calls',
    description: 'Allows incoming Kallie calls to ring over your lock screen.',
    required: false,
    supported: SUPPORTS_FULL_SCREEN_INTENT_TOGGLE,
  },
  {
    id: 'accessibility',
    title: 'Phone Control & Notch',
    description:
      'Allows Kallie to show the live Dynamic Notch pill and tap/type in apps when you ask.',
    required: false,
    supported: IS_ANDROID,
  },
  {
    id: 'notificationAccess',
    title: 'Quick Reply (Messenger)',
    description:
      'Lets Kallie read and reply to incoming chat notifications in one step.',
    required: false,
    supported: IS_ANDROID,
  },
] as const;

type PermissionListener = (snapshot: PermissionSnapshot) => void;

const DEFAULT_META: PermissionMeta = {
  asked: false,
  wasEverGranted: false,
  revoked: false,
  blocked: false,
};

function createInitialMeta(): Record<PermissionId, PermissionMeta> {
  const persisted = getPreferenceSync<Partial<Record<PermissionId, Partial<PermissionMeta>>>>(
    PERMISSION_META_PREF_KEY,
  );
  const build = (id: PermissionId): PermissionMeta => ({
    ...DEFAULT_META,
    ...(persisted?.[id] || {}),
  });
  return {
    microphone: build('microphone'),
    notifications: build('notifications'),
    fullScreenIntent: build('fullScreenIntent'),
    camera: build('camera'),
    accessibility: build('accessibility'),
    notificationAccess: build('notificationAccess'),
  };
}

let state: PermissionSnapshot = {
  hydrated: !IS_ANDROID,
  statuses: {
    microphone: IS_ANDROID ? 'denied' : 'granted',
    notifications: IS_ANDROID && ANDROID_API >= 33 ? 'denied' : 'granted',
    fullScreenIntent: SUPPORTS_FULL_SCREEN_INTENT_TOGGLE ? 'denied' : 'granted',
    camera: IS_ANDROID ? 'denied' : 'granted',
    accessibility: IS_ANDROID ? 'denied' : 'unavailable',
    notificationAccess: IS_ANDROID ? 'denied' : 'unavailable',
  },
  meta: createInitialMeta(),
  busyKey: null,
};

const listeners = new Set<PermissionListener>();
let inFlightRefreshAll: Promise<PermissionSnapshot> | null = null;
const inFlightChecks = new Map<PermissionId, Promise<PermissionStatus>>();
const inFlightRequests = new Map<PermissionId, Promise<PermissionStatus>>();

function persistMeta(meta: Record<PermissionId, PermissionMeta>): void {
  setPreferenceSync(PERMISSION_META_PREF_KEY, meta);
}

function emit(): void {
  const snapshot: PermissionSnapshot = {
    hydrated: state.hydrated,
    statuses: { ...state.statuses },
    meta: {
      microphone: { ...state.meta.microphone },
      notifications: { ...state.meta.notifications },
      fullScreenIntent: { ...state.meta.fullScreenIntent },
      camera: { ...state.meta.camera },
      accessibility: { ...state.meta.accessibility },
      notificationAccess: { ...state.meta.notificationAccess },
    },
    busyKey: state.busyKey,
  };
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // Ignore individual subscriber errors
    }
  });
}

function applyCheckedStatus(
  id: PermissionId,
  granted: boolean,
): { status: PermissionStatus; changed: boolean } {
  const prevMeta = state.meta[id];
  const nextStatus: PermissionStatus = granted
    ? 'granted'
    : prevMeta.blocked
      ? 'blocked'
      : 'denied';

  const nextMeta: PermissionMeta = {
    asked: prevMeta.asked || granted,
    wasEverGranted: prevMeta.wasEverGranted || granted,
    revoked: !granted && prevMeta.wasEverGranted,
    blocked: granted ? false : prevMeta.blocked,
  };

  const changed =
    state.statuses[id] !== nextStatus ||
    prevMeta.asked !== nextMeta.asked ||
    prevMeta.wasEverGranted !== nextMeta.wasEverGranted ||
    prevMeta.revoked !== nextMeta.revoked ||
    prevMeta.blocked !== nextMeta.blocked;

  state.statuses[id] = nextStatus;
  state.meta[id] = nextMeta;

  if (changed) {
    persistMeta(state.meta);
  }
  return { status: nextStatus, changed };
}

async function checkNativePermissionRaw(id: PermissionId): Promise<boolean> {
  if (!IS_ANDROID) {
    return true;
  }
  try {
    switch (id) {
      case 'microphone':
        return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      case 'notifications':
        if (ANDROID_API < 33) return true;
        return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      case 'fullScreenIntent':
        if (!SUPPORTS_FULL_SCREEN_INTENT_TOGGLE) return true;
        return await nativeIncomingCall.canUseFullScreenIntent();
      case 'camera':
        return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
      case 'accessibility': {
        const caps = await phoneControlBridge.getCapabilities();
        return caps.accessibilityConnected || caps.accessibilityEnabled;
      }
      case 'notificationAccess': {
        const caps = await phoneControlBridge.getCapabilities();
        return caps.notificationAccessConnected || caps.notificationAccessEnabled;
      }
    }
  } catch {
    return false;
  }
}

/**
 * Pure non-prompting live status check (single-flight deduplicated).
 * Never displays an OS permission dialog.
 */
async function checkPermission(id: PermissionId): Promise<PermissionStatus> {
  if (!IS_ANDROID) {
    return 'granted';
  }
  const existing = inFlightChecks.get(id);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const granted = await checkNativePermissionRaw(id);
    const { status, changed } = applyCheckedStatus(id, granted);
    if (changed) {
      emit();
    }
    return status;
  })().finally(() => {
    inFlightChecks.delete(id);
  });

  inFlightChecks.set(id, promise);
  return promise;
}

/**
 * Silently refreshes all managed permissions in parallel without prompting.
 * Automatically detects permissions granted or revoked in system Settings.
 * Only notifies subscribers when hydration or permission status actually changes.
 */
async function refreshAll(): Promise<PermissionSnapshot> {
  if (!IS_ANDROID) {
    if (!state.hydrated) {
      state.hydrated = true;
      emit();
    }
    return getSnapshot();
  }
  if (inFlightRefreshAll) {
    return inFlightRefreshAll;
  }

  inFlightRefreshAll = (async () => {
    const [mic, notif, fsi, caps] = await Promise.all([
      checkNativePermissionRaw('microphone'),
      checkNativePermissionRaw('notifications'),
      checkNativePermissionRaw('fullScreenIntent'),
      phoneControlBridge.getCapabilities(),
    ]);
    const a11y = caps.accessibilityConnected || caps.accessibilityEnabled;
    const notifAccess = caps.notificationAccessConnected || caps.notificationAccessEnabled;
    const r1 = applyCheckedStatus('microphone', mic);
    const r2 = applyCheckedStatus('notifications', notif);
    const r3 = applyCheckedStatus('fullScreenIntent', fsi);
    const r4 = applyCheckedStatus('accessibility', a11y);
    const r5 = applyCheckedStatus('notificationAccess', notifAccess);
    const hydrationChanged = !state.hydrated;
    state.hydrated = true;
    if (hydrationChanged || r1.changed || r2.changed || r3.changed || r4.changed || r5.changed) {
      emit();
    }
    return getSnapshot();
  })().finally(() => {
    inFlightRefreshAll = null;
  });

  return inFlightRefreshAll;
}

async function openSystemSettings(id?: PermissionId): Promise<void> {
  try {
    if (IS_ANDROID && id === 'fullScreenIntent') {
      const opened = await nativeIncomingCall.openFullScreenIntentSettings();
      if (opened) return;
    }
    if (IS_ANDROID && id === 'notifications') {
      const opened = await nativeIncomingCall.openNotificationSettings();
      if (opened) return;
    }
    if (IS_ANDROID && id === 'accessibility') {
      const opened = await phoneControlBridge.openAccessibilitySettings();
      if (opened) return;
    }
    if (IS_ANDROID && id === 'notificationAccess') {
      const opened = await phoneControlBridge.openNotificationListenerSettings();
      if (opened) return;
    }
    await Linking.openSettings();
  } catch {
    // Safe fallback if Settings intent is unavailable
  }
}

/**
 * Explicit user-initiated permission toggle / request (called ONLY from the
 * Permission Management page, Onboarding step, or explicit optional feature toggle).
 * - Deduplicated so concurrent taps never stack OS prompts.
 * - If already granted, opens OS Settings so the user can review/manage access.
 * - If previously blocked (NEVER_ASK_AGAIN) or special Android setting, navigates
 *   directly to the appropriate OS Settings screen.
 */
async function requestPermission(
  id: PermissionId,
  options?: { openSettingsIfGranted?: boolean },
): Promise<PermissionStatus> {
  if (!IS_ANDROID) {
    return 'granted';
  }
  const existing = inFlightRequests.get(id);
  if (existing) {
    return existing;
  }

  const run = (async () => {
    state.busyKey = id;
    emit();

    try {
      // Always verify live OS status first so already-granted permissions never prompt
      const currentlyGranted = await checkNativePermissionRaw(id);
      if (currentlyGranted) {
        applyCheckedStatus(id, true);
        if (options?.openSettingsIfGranted) {
          await openSystemSettings(id);
        }
        return 'granted' as PermissionStatus;
      }

      if (id === 'fullScreenIntent' || id === 'accessibility' || id === 'notificationAccess') {
        state.meta[id] = { ...state.meta[id], asked: true };
        persistMeta(state.meta);
        await openSystemSettings(id);
        const rechecked = await checkNativePermissionRaw(id);
        return applyCheckedStatus(id, rechecked).status;
      }

      if (id === 'notifications' && ANDROID_API < 33) {
        await openSystemSettings('notifications');
        return applyCheckedStatus('notifications', true).status;
      }

      // If OS permanently blocked runtime prompts, go straight to Settings
      if (state.meta[id].blocked) {
        await openSystemSettings(id);
        const rechecked = await checkNativePermissionRaw(id);
        return applyCheckedStatus(id, rechecked).status;
      }

      const androidPerm =
        id === 'microphone'
          ? PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
          : id === 'notifications'
            ? PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
            : PermissionsAndroid.PERMISSIONS.CAMERA;

      const result = await PermissionsAndroid.request(androidPerm);
      const granted = result === PermissionsAndroid.RESULTS.GRANTED;
      const neverAskAgain = result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;

      state.meta[id] = {
        asked: true,
        wasEverGranted: state.meta[id].wasEverGranted || granted,
        revoked: !granted && state.meta[id].wasEverGranted,
        blocked: neverAskAgain,
      };
      state.statuses[id] = granted ? 'granted' : neverAskAgain ? 'blocked' : 'denied';
      persistMeta(state.meta);

      if (neverAskAgain) {
        await openSystemSettings(id);
      }

      return state.statuses[id];
    } catch {
      const rechecked = await checkNativePermissionRaw(id);
      return applyCheckedStatus(id, rechecked).status;
    } finally {
      state.busyKey = null;
      emit();
    }
  })().finally(() => {
    inFlightRequests.delete(id);
  });

  inFlightRequests.set(id, run);
  return run;
}

function getSnapshot(): PermissionSnapshot {
  return {
    hydrated: state.hydrated,
    statuses: { ...state.statuses },
    meta: {
      microphone: { ...state.meta.microphone },
      notifications: { ...state.meta.notifications },
      fullScreenIntent: { ...state.meta.fullScreenIntent },
      camera: { ...state.meta.camera },
      accessibility: { ...state.meta.accessibility },
      notificationAccess: { ...state.meta.notificationAccess },
    },
    busyKey: state.busyKey,
  };
}

function subscribe(listener: PermissionListener): () => void {
  listeners.add(listener);
  listener(getSnapshot());
  return () => {
    listeners.delete(listener);
  };
}

function isGrantedSync(id: PermissionId): boolean {
  return state.statuses[id] === 'granted';
}

export const permissionManager = {
  getSnapshot,
  subscribe,
  refreshAll,
  checkPermission,
  requestPermission,
  openSystemSettings,
  isGrantedSync,
};
