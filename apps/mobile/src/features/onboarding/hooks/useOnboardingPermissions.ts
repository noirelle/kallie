import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, PermissionsAndroid, Platform } from 'react-native';
import { nativeIncomingCall } from '../../calling/lib/nativeIncomingCall';

const ONBOARDING_STORAGE_KEY = 'kallie_onboarding_v2';

export interface PermissionStates {
  notifications: boolean;
  microphone: boolean;
  fullScreenIntent: boolean;
}

export type PermissionBusyKey =
  | 'notifications'
  | 'microphone'
  | 'fullScreenIntent'
  | null;

export interface OnboardingSavedData {
  completed: boolean;
  discoverySource: string | null;
  interests: string[];
}

const SUPPORTS_FULL_SCREEN_INTENT_TOGGLE =
  Platform.OS === 'android' && Number(Platform.Version) >= 34;

async function checkAndroidNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) < 33) return true;
  try {
    return await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
  } catch {
    return false;
  }
}

async function checkAndroidMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    return await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
  } catch {
    return false;
  }
}

async function checkAndroidFullScreenIntentPermission(): Promise<boolean> {
  if (!SUPPORTS_FULL_SCREEN_INTENT_TOGGLE) return true;
  return nativeIncomingCall.canUseFullScreenIntent();
}

export function useOnboardingPermissions() {
  const [hydrated, setHydrated] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [discoverySource, setDiscoverySource] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<PermissionStates>({
    notifications: false,
    microphone: false,
    fullScreenIntent: !SUPPORTS_FULL_SCREEN_INTENT_TOGGLE,
  });
  const [busyKey, setBusyKey] = useState<PermissionBusyKey>(null);

  const refreshPermissions = useCallback(async () => {
    const [notifications, microphone, fullScreenIntent] = await Promise.all([
      checkAndroidNotificationPermission(),
      checkAndroidMicPermission(),
      checkAndroidFullScreenIntentPermission(),
    ]);
    setPermissions({ notifications, microphone, fullScreenIntent });
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        const raw = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
        if (active && raw) {
          const parsed = JSON.parse(raw) as Partial<OnboardingSavedData>;
          setCompleted(Boolean(parsed.completed));
          setDiscoverySource(parsed.discoverySource ?? null);
          setInterests(Array.isArray(parsed.interests) ? parsed.interests : []);
        }
        await refreshPermissions();
      } catch {
        // Ignore storage read errors
      } finally {
        if (active) {
          setHydrated(true);
        }
      }
    };
    void init();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshPermissions();
      }
    });

    return () => {
      active = false;
      appStateSub.remove();
    };
  }, [refreshPermissions]);

  const toggleNotifications = useCallback(async () => {
    if (busyKey) return;
    setBusyKey('notifications');
    try {
      if (permissions.notifications) {
        await Linking.openSettings();
        return;
      }

      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
        if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
          await Linking.openSettings();
        }
      }
      await refreshPermissions();
    } finally {
      setBusyKey(null);
    }
  }, [busyKey, permissions.notifications, refreshPermissions]);

  const toggleMicrophone = useCallback(async () => {
    if (busyKey) return;
    setBusyKey('microphone');
    try {
      if (permissions.microphone) {
        await Linking.openSettings();
        return;
      }

      if (Platform.OS === 'android') {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone permission',
            message: 'Kallie needs microphone access for live voice calls.',
            buttonPositive: 'Allow',
            buttonNegative: 'Cancel',
          },
        );
        if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
          await Linking.openSettings();
        }
      }
      await refreshPermissions();
    } finally {
      setBusyKey(null);
    }
  }, [busyKey, permissions.microphone, refreshPermissions]);

  const toggleFullScreenIntent = useCallback(async () => {
    if (busyKey) return;
    setBusyKey('fullScreenIntent');
    try {
      const opened = await nativeIncomingCall.openFullScreenIntentSettings();
      if (!opened) {
        await Linking.openSettings();
      }
      await refreshPermissions();
    } finally {
      setBusyKey(null);
    }
  }, [busyKey, refreshPermissions]);

  const toggleInterest = useCallback((id: string) => {
    setInterests((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }, []);

  const completeOnboarding = useCallback(
    async (overrides?: { discoverySource?: string | null; interests?: string[] }) => {
      const payload: OnboardingSavedData = {
        completed: true,
        discoverySource: overrides?.discoverySource ?? discoverySource,
        interests: overrides?.interests ?? interests,
      };
      await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(payload));
      setCompleted(true);
    },
    [discoverySource, interests],
  );

  return {
    hydrated,
    completed,
    discoverySource,
    setDiscoverySource,
    interests,
    toggleInterest,
    permissions,
    busyKey,
    supportsFullScreenIntentToggle: SUPPORTS_FULL_SCREEN_INTENT_TOGGLE,
    toggleNotifications,
    toggleMicrophone,
    toggleFullScreenIntent,
    completeOnboarding,
  };
}
