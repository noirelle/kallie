import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { Linking, PermissionsAndroid, Platform } from 'react-native';

const ONBOARDING_STORAGE_KEY = 'kallie_permissions_onboarding_v1';

export interface PermissionStates {
  notifications: boolean;
  microphone: boolean;
}

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

export function useOnboardingPermissions() {
  const [hydrated, setHydrated] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [permissions, setPermissions] = useState<PermissionStates>({
    notifications: false,
    microphone: false,
  });
  const [busyKey, setBusyKey] = useState<'notifications' | 'microphone' | null>(null);

  const refreshPermissions = useCallback(async () => {
    const [notifications, microphone] = await Promise.all([
      checkAndroidNotificationPermission(),
      checkAndroidMicPermission(),
    ]);
    setPermissions({ notifications, microphone });
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        const stored = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
        if (active) {
          setCompleted(stored === 'done');
        }
        await refreshPermissions();
      } finally {
        if (active) {
          setHydrated(true);
        }
      }
    };
    void init();
    return () => {
      active = false;
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
            title: 'Microphone Permission',
            message: 'Kallie needs microphone access for live AI voice calls.',
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

  const completeOnboarding = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, 'done');
    setCompleted(true);
  }, []);

  return {
    hydrated,
    completed,
    permissions,
    busyKey,
    toggleNotifications,
    toggleMicrophone,
    completeOnboarding,
  };
}
