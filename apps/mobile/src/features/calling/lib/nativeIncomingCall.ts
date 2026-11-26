import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

export interface IncomingCallIntentEvent {
  action: 'show' | 'answer' | 'answer_background' | 'decline' | 'hangup' | 'open_active';
  sessionId: string;
  title: string;
}

interface NativeKallieIncomingCall {
  ensureChannels: () => void;
  showIncomingCall: (
    sessionId: string,
    title: string,
    declineUrl?: string | null,
    declineToken?: string | null,
  ) => void;
  dismissIncomingCall: (sessionId: string) => void;
  startCallForegroundService: (sessionId: string, title: string) => void;
  stopCallForegroundService: () => void;
  getActiveCallSessionId: () => Promise<string | null>;
  showReminderNotification: (scheduleId: string, title: string, body: string) => void;
  consumePendingCallIntent: () => Promise<IncomingCallIntentEvent | null>;
  canUseFullScreenIntent: () => Promise<boolean>;
  openFullScreenIntentSettings: () => Promise<boolean>;
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

  startCallForegroundService(sessionId: string, title: string): void {
    try {
      nativeMod?.startCallForegroundService(sessionId, title);
    } catch {
      // Safe no-op
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
