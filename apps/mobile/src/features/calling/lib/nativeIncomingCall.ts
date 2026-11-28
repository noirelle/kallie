import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

export interface IncomingCallIntentEvent {
  action: 'show' | 'answer' | 'answer_background' | 'decline' | 'hangup' | 'open_active';
  sessionId: string;
  title: string;
  aiPrompt?: string;
}

export interface LocalReminderAlarmItem {
  scheduleId: string;
  dedupeKey: string;
  title: string;
  aiPrompt?: string;
  scheduledAtIso: string;
  timezone: string;
  minutesBefore: number;
  triggerAtMs: number;
}

interface NativeKallieIncomingCall {
  ensureChannels: () => void;
  showIncomingCall: (
    sessionId: string,
    title: string,
    declineUrl?: string | null,
    declineToken?: string | null,
  ) => void;
  scheduleTestCall?: (delaySeconds: number, title: string, aiPrompt?: string | null) => void;
  moveToBackground?: () => void;
  setKeepScreenOn?: (enabled: boolean) => void;
  dismissIncomingCall: (sessionId: string) => void;
  startCallForegroundService: (sessionId: string, title: string) => Promise<boolean>;
  stopCallForegroundService: () => void;
  getActiveCallSessionId: () => Promise<string | null>;
  showReminderNotification: (scheduleId: string, title: string, body: string) => void;
  syncLocalReminderAlarms?: (alarmsJson: string) => void;
  consumePendingCallIntentSync?: () => IncomingCallIntentEvent | null;
  consumePendingCallIntent: () => Promise<IncomingCallIntentEvent | null>;
  canUseFullScreenIntent: () => Promise<boolean>;
  openFullScreenIntentSettings: () => Promise<boolean>;
  openNotificationSettings?: () => Promise<boolean>;
}

const nativeMod: NativeKallieIncomingCall | null =
  Platform.OS === 'android'
    ? (NativeModules.KallieIncomingCall as NativeKallieIncomingCall | undefined) ?? null
    : null;

export const nativeIncomingCall = {
  isAvailable: Boolean(nativeMod),

  ensureChannels(): void {
    try {
      nativeMod?.ensureChannels();
    } catch {
      // Safe no-op on non-Android or older dev builds
    }
  },

  showIncomingCall(
    sessionId: string,
    title: string,
    declineUrl?: string | null,
    declineToken?: string | null,
  ): void {
    try {
      nativeMod?.showIncomingCall(
        sessionId,
        title,
        declineUrl ?? null,
        declineToken ?? null,
      );
    } catch {
      // Safe no-op
    }
  },

  dismissIncomingCall(sessionId: string): void {
    try {
      nativeMod?.dismissIncomingCall(sessionId);
    } catch {
      // Safe no-op
    }
  },

  scheduleTestCall(delaySeconds: number, title: string, aiPrompt?: string | null): void {
    try {
      nativeMod?.scheduleTestCall?.(delaySeconds, title, aiPrompt ?? null);
    } catch {
      // Safe no-op
    }
  },

  moveToBackground(): void {
    try {
      nativeMod?.moveToBackground?.();
    } catch {
      // Safe no-op
    }
  },

  setKeepScreenOn(enabled: boolean): void {
    try {
      nativeMod?.setKeepScreenOn?.(enabled);
    } catch {
      // Safe no-op
    }
  },

  consumePendingCallIntentSync(): IncomingCallIntentEvent | null {
    if (Platform.OS !== 'android' || !nativeMod?.consumePendingCallIntentSync) return null;
    try {
      return nativeMod.consumePendingCallIntentSync();
    } catch {
      return null;
    }
  },

  async startCallForegroundService(sessionId: string, title: string): Promise<boolean> {
    if (!nativeMod) return true;
    try {
      const res = await nativeMod.startCallForegroundService(sessionId, title);
      return Boolean(res);
    } catch {
      return false;
    }
  },

  stopCallForegroundService(): void {
    try {
      nativeMod?.stopCallForegroundService();
    } catch {
      // Safe no-op
    }
  },

  async getActiveCallSessionId(): Promise<string | null> {
    if (!nativeMod) return null;
    try {
      return await nativeMod.getActiveCallSessionId();
    } catch {
      return null;
    }
  },

  showReminderNotification(scheduleId: string, title: string, body: string): void {
    try {
      nativeMod?.showReminderNotification(scheduleId, title, body);
    } catch {
      // Safe no-op
    }
  },

  syncLocalReminderAlarms(alarms: LocalReminderAlarmItem[]): void {
    if (Platform.OS !== 'android') return;
    try {
      nativeMod?.syncLocalReminderAlarms?.(JSON.stringify(alarms));
    } catch {
      // Safe no-op on older dev builds without alarm receiver
    }
  },

  async consumePendingCallIntent(): Promise<IncomingCallIntentEvent | null> {
    if (!nativeMod) return null;
    try {
      return await nativeMod.consumePendingCallIntent();
    } catch {
      return null;
    }
  },

  async canUseFullScreenIntent(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    if (!nativeMod) return true;
    try {
      return await nativeMod.canUseFullScreenIntent();
    } catch {
      return true;
    }
  },

  async openFullScreenIntentSettings(): Promise<boolean> {
    if (!nativeMod) return false;
    try {
      return await nativeMod.openFullScreenIntentSettings();
    } catch {
      return false;
    }
  },

  async openNotificationSettings(): Promise<boolean> {
    if (!nativeMod?.openNotificationSettings) return false;
    try {
      return await nativeMod.openNotificationSettings();
    } catch {
      return false;
    }
  },

  subscribeToIntents(
    listener: (event: IncomingCallIntentEvent) => void,
  ): () => void {
    if (Platform.OS !== 'android') {
      return () => {};
    }
    const sub = DeviceEventEmitter.addListener('kallieIncomingCallIntent', listener);
    return () => sub.remove();
  },
};
