import { useEffect } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { apiClient } from '../../../lib/apiClient';
import { setPendingCallConnection } from '../../../lib/callSessionStore';
import { appEnv } from '../../../lib/env';

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

type FirebaseMessagingInstance = {
  requestPermission: () => Promise<number>;
  getToken: () => Promise<string>;
  onTokenRefresh: (cb: (token: string) => void) => () => void;
  onMessage: (cb: (msg: { data?: Record<string, string> }) => void) => () => void;
  setBackgroundMessageHandler: (
    cb: (msg: { data?: Record<string, string> }) => Promise<void>,
  ) => void;
};

function getCallKeep(): CallKeepModule | null {
  if (Platform.OS === 'web') return null;
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

async function ensureCallKeepSetup(): Promise<CallKeepModule | null> {
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
        selfManaged: false,
        foregroundService: {
          channelId: 'com.kallie.app.calls',
          channelName: 'Kallie Incoming Calls',
          notificationTitle: 'Kallie call in progress',
        },
      },
    });
    callKeepConfigured = true;
    return callKeep;
  } catch {
    return null;
  }
}

/**
 * Registers the Android killed/background FCM handler at module startup so
 * high-priority incoming_call pushes wake a locked phone and display CallKeep.
 */
export function registerBackgroundFcmHandler(): void {
  if (backgroundHandlerRegistered || Platform.OS !== 'android' || !appEnv.enableAndroidFcm) {
    return;
  }

  const messaging = getFirebaseMessaging();
  if (!messaging) return;

  backgroundHandlerRegistered = true;
  messaging.setBackgroundMessageHandler(async (remoteMessage) => {
    const data = remoteMessage.data;
    if (!data || data.type !== 'incoming_call' || !data.sessionId) {
      return;
    }

    const callKeep = await ensureCallKeepSetup();
    if (!callKeep) return;

    callKeep.displayIncomingCall(
      data.sessionId,
      'Kallie',
      data.title || 'Kallie is calling',
      'generic',
      false,
    );
  });
}

export function useNativeCallKeep(
  userId: string | undefined,
  onAcceptedCall: (sessionId: string) => void,
) {
  useEffect(() => {
    if (!userId || Platform.OS === 'web') {
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
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        ).catch(() => {});
      }

      const callKeep = await ensureCallKeepSetup();
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

      if (Platform.OS === 'android') {
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
            if (data?.type === 'incoming_call' && data.sessionId && callKeep) {
              callKeep.displayIncomingCall(
                data.sessionId,
                'Kallie',
                data.title || 'Kallie is calling',
                'generic',
                false,
              );
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
  }, [onAcceptedCall, userId]);
}
