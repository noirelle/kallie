import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, PermissionsAndroid, Platform } from 'react-native';
import { getPreferenceSync, setPreferenceSync } from '../../../lib/storage/localDb';
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
  const initialSavedRef = useRef<Partial<OnboardingSavedData> | null | undefined>(undefined);
  if (initialSavedRef.current === undefined) {
    initialSavedRef.current = getPreferenceSync<Partial<OnboardingSavedData>>(ONBOARDING_STORAGE_KEY);
  }
  const initialSaved = initialSavedRef.current;

  const [hydrated, setHydrated] = useState(Boolean(initialSaved));
  const [completed, setCompleted] = useState(Boolean(initialSaved?.completed));
  const [discoverySource, setDiscoverySource] = useState<string | null>(
    initialSaved?.discoverySource ?? null,
  );
  const [interests, setInterests] = useState<string[]>(
    Array.isArray(initialSaved?.interests) ? initialSaved.interests : [],
  );
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
        let isCompleted = Boolean(initialSaved?.completed);
        if (!initialSaved) {
          // One-time migration from legacy AsyncStorage to SQLite preferences
          const raw = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
          if (active && raw) {
            const parsed = JSON.parse(raw) as Partial<OnboardingSavedData>;
            setPreferenceSync(ONBOARDING_STORAGE_KEY, parsed);
            isCompleted = Boolean(parsed.completed);
            setCompleted(isCompleted);
            setDiscoverySource(parsed.discoverySource ?? null);
            setInterests(Array.isArray(parsed.interests) ? parsed.interests : []);
          }
        }
        // Unblock boot overlay immediately once onboarding status is known;
        // only query native OS permission states when the onboarding wizard is shown.
        if (active) {
          setHydrated(true);
        }
        if (!isCompleted && active) {
          await refreshPermissions();
        }
      } catch {
        if (active) {
          setHydrated(true);
        }
      }
    };
    void init();

    return () => {
      active = false;
    };
  }, [initialSaved, refreshPermissions]);

  // Only refresh OS permission toggles on foreground resume while onboarding is active
  useEffect(() => {
    if (!hydrated || completed) {
      return;
    }
    void refreshPermissions();
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshPermissions();
      }
    });
    return () => {
      appStateSub.remove();
    };
  }, [completed, hydrated, refreshPermissions]);

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
      setPreferenceSync(ONBOARDING_STORAGE_KEY, payload);
      await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(payload)).catch(() => {});
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
