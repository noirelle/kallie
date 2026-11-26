import { useEffect } from 'react';
import { Platform } from 'react-native';
import { apiClient } from '../../../lib/apiClient';
import { setPendingCallConnection } from '../../../lib/callSessionStore';
import { appEnv } from '../../../lib/env';
import { nativeIncomingCall } from '../lib/nativeIncomingCall';

type CallKeepModule = {
  setup: (options: Record<string, unknown>) => Promise<void>;
  displayIncomingCall: (
    uuid: string,
    handle: string,
    localizedCallerName?: string,
    handleType?: string,
    hasVideo?: boolean,
  ) => void;
  endCall: (uuid: string) => void;
  backToForeground: () => void;
  addEventListener: (event: string, handler: (data: { callUUID: string }) => void) => void;
  removeEventListener: (event: string) => void;
};

type FirebaseRemoteMessage = {
  data?: Record<string, string>;
  notification?: {
    title?: string;
    body?: string;
  };
};

type FirebaseMessagingInstance = {
  requestPermission: () => Promise<number>;
  getToken: () => Promise<string>;
  onTokenRefresh: (cb: (token: string) => void) => () => void;
  onMessage: (cb: (msg: FirebaseRemoteMessage) => void) => () => void;
  setBackgroundMessageHandler: (
    cb: (msg: FirebaseRemoteMessage) => Promise<void>,
  ) => void;
};

export interface ForegroundIncomingCallPayload {
  sessionId: string;
  title: string;
  roomName?: string;
}

function getCallKeep(): CallKeepModule | null {
  if (Platform.OS !== 'ios') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-callkeep');
    return (mod.default || mod) as CallKeepModule;
  } catch {
    return null;
  }
}

function getFirebaseMessaging(): FirebaseMessagingInstance | null {
  if (Platform.OS !== 'android' || !appEnv.enableAndroidFcm) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-firebase/messaging');
    const messagingFactory = mod.default || mod;
    return messagingFactory() as FirebaseMessagingInstance;
  } catch {
    return null;
  }
}

let callKeepConfigured = false;
let backgroundHandlerRegistered = false;

async function ensureIosCallKeepSetup(): Promise<CallKeepModule | null> {
  const callKeep = getCallKeep();
  if (!callKeep) return null;
  if (callKeepConfigured) return callKeep;

  try {
    await callKeep.setup({
      ios: {
        appName: 'Kallie',
        supportsVideo: false,
      },
      android: {
        alertTitle: 'Phone Account Permission',
        alertDescription:
          'Kallie needs permission to show incoming AI voice calls even when your screen is locked.',
        cancelButton: 'Cancel',
        okButton: 'Allow',
        additionalPermissions: [],
        selfManaged: true,
      },
    });
    callKeepConfigured = true;
    return callKeep;
  } catch {
    return null;
  }
}

/**
 * Registers the Android background / killed FCM handler at module load so
 * high-priority data pushes trigger the native full-screen incoming call
 * notification (CATEGORY_CALL + setFullScreenIntent) or dismiss ended calls.
 */
export function registerBackgroundFcmHandler(): void {
  if (backgroundHandlerRegistered || Platform.OS !== 'android' || !appEnv.enableAndroidFcm) {
    return;
  }

  nativeIncomingCall.ensureChannels();

  const messaging = getFirebaseMessaging();
  if (!messaging) return;

  backgroundHandlerRegistered = true;
  messaging.setBackgroundMessageHandler(async (remoteMessage) => {
    const data = remoteMessage.data;
    if (!data?.type) return;

    if (data.type === 'incoming_call' && data.sessionId) {
      nativeIncomingCall.showIncomingCall(data.sessionId, data.title || 'Kallie');
      return;
    }

    if (data.type === 'call_ended' && data.sessionId) {
      nativeIncomingCall.dismissIncomingCall(data.sessionId);
      return;
    }

    if (data.type === 'call_reminder' && data.scheduleId && !remoteMessage.notification) {
      const minutes = data.minutesBefore || '10';
      const body =
        data.scheduledTimeText
          ? `Kallie will call you in ${minutes} minutes (${data.scheduledTimeText}).`
          : `Kallie will call you in ${minutes} minutes.`;
      nativeIncomingCall.showReminderNotification(data.scheduleId, 'Kallie', body);
    }
  });
}

export function useNativeCallKeep(
  userId: string | undefined,
  onAcceptedCall: (sessionId: string) => void,
  enabled = true,
  options?: {
    onForegroundIncomingCall?: (payload: ForegroundIncomingCallPayload) => void;
    onForegroundCallEnded?: (sessionId: string) => void;
  },
) {
  const onForegroundIncomingCall = options?.onForegroundIncomingCall;
  const onForegroundCallEnded = options?.onForegroundCallEnded;

  useEffect(() => {
    if (Platform.OS === 'android') {
      nativeIncomingCall.ensureChannels();
    }
  }, []);

  useEffect(() => {
    if (!enabled || !userId || Platform.OS === 'web') {
      return;
    }

    if (Platform.OS === 'android' && !appEnv.enableAndroidFcm) {
      return;
    }
    if (Platform.OS === 'ios' && !appEnv.enableIosVoip) {
      return;
    }

    let cancelled = false;
    let unsubTokenRefresh: (() => void) | undefined;
    let unsubForegroundMsg: (() => void) | undefined;
    let activeCallKeep: CallKeepModule | null = null;

    const init = async () => {
      if (Platform.OS === 'ios') {
        const callKeep = await ensureIosCallKeepSetup();
        if (cancelled) return;
        activeCallKeep = callKeep;

        if (callKeep) {
          callKeep.addEventListener('answerCall', async ({ callUUID }) => {
            try {
              callKeep.backToForeground();
              const joinData = await apiClient.acceptCall(callUUID);
              setPendingCallConnection(joinData);
              onAcceptedCall(joinData.session.id);
            } catch {
              callKeep.endCall(callUUID);
            }
          });

          callKeep.addEventListener('endCall', ({ callUUID }) => {
            void apiClient.declineCall(callUUID).catch(() => {});
            void apiClient.endCall(callUUID).catch(() => {});
          });
        }
        return;
      }

      if (Platform.OS === 'android') {
        nativeIncomingCall.ensureChannels();

        const messaging = getFirebaseMessaging();
        if (!messaging) return;

        try {
          await messaging.requestPermission();
          const fcmToken = await messaging.getToken();
          if (fcmToken && !cancelled) {
            await apiClient.registerDevice({
              platform: 'android',
              fcmToken,
              deviceName: 'Android Device',
            });
          }

          unsubTokenRefresh = messaging.onTokenRefresh((nextToken) => {
            void apiClient
              .registerDevice({
                platform: 'android',
                fcmToken: nextToken,
                deviceName: 'Android Device',
              })
              .catch(() => {});
          });

          unsubForegroundMsg = messaging.onMessage((remoteMessage) => {
            const data = remoteMessage.data;
            if (!data?.type) return;

            if (data.type === 'incoming_call' && data.sessionId) {
              onForegroundIncomingCall?.({
                sessionId: data.sessionId,
                title: data.title || 'Kallie',
                roomName: data.roomName,
              });
              return;
            }

            if (data.type === 'call_ended' && data.sessionId) {
              nativeIncomingCall.dismissIncomingCall(data.sessionId);
              onForegroundCallEnded?.(data.sessionId);
              return;
            }

            if (data.type === 'call_reminder' && data.scheduleId) {
              const title = remoteMessage.notification?.title || 'Kallie';
              const body =
                remoteMessage.notification?.body ||
                (data.scheduledTimeText
                  ? `Kallie will call you in ${data.minutesBefore || '10'} minutes (${data.scheduledTimeText}).`
                  : `Kallie will call you in ${data.minutesBefore || '10'} minutes.`);
              nativeIncomingCall.showReminderNotification(data.scheduleId, title, body);
            }
          });
        } catch {
          // Ignore when Firebase isn't configured in dev environment
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
      unsubTokenRefresh?.();
      unsubForegroundMsg?.();
      activeCallKeep?.removeEventListener('answerCall');
      activeCallKeep?.removeEventListener('endCall');
    };
  }, [
    enabled,
    onAcceptedCall,
    onForegroundCallEnded,
    onForegroundIncomingCall,
    userId,
  ]);
}
