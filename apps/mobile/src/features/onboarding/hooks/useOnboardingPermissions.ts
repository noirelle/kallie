import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPreferenceSync, setPreferenceSync } from '../../../lib/storage/localDb';
import { usePermissions } from '../../permissions/hooks/usePermissions';
import type { PermissionId } from '../../permissions/lib/permissionManager';

const ONBOARDING_STORAGE_KEY = 'kallie_onboarding_v2';

export interface PermissionStates {
  notifications: boolean;
  microphone: boolean;
  fullScreenIntent: boolean;
}

export type PermissionBusyKey = PermissionId | null;

export interface OnboardingSavedData {
  completed: boolean;
  discoverySource: string | null;
  interests: string[];
}

export function useOnboardingPermissions() {
  const initialSavedRef = useRef<Partial<OnboardingSavedData> | null | undefined>(undefined);
  if (initialSavedRef.current === undefined) {
    initialSavedRef.current = getPreferenceSync<Partial<OnboardingSavedData>>(
      ONBOARDING_STORAGE_KEY,
    );
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

  // Delegate all permission state & OS dialogs to the single centralized permissionManager
  const {
    permissions,
    busyKey,
    supportsFullScreenIntentToggle,
    togglePermission,
  } = usePermissions({ syncOnResume: hydrated && !completed });

  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        if (!initialSaved) {
          // One-time migration from legacy AsyncStorage to SQLite preferences
          const raw = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
          if (active && raw) {
            const parsed = JSON.parse(raw) as Partial<OnboardingSavedData>;
            setPreferenceSync(ONBOARDING_STORAGE_KEY, parsed);
            setCompleted(Boolean(parsed.completed));
            setDiscoverySource(parsed.discoverySource ?? null);
            setInterests(Array.isArray(parsed.interests) ? parsed.interests : []);
          }
        }
      } catch {
        // Ignore storage read errors
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
  }, [initialSaved]);

  const toggleNotifications = useCallback(async () => {
    await togglePermission('notifications');
  }, [togglePermission]);

  const toggleMicrophone = useCallback(async () => {
    await togglePermission('microphone');
  }, [togglePermission]);

  const toggleFullScreenIntent = useCallback(async () => {
    await togglePermission('fullScreenIntent');
  }, [togglePermission]);

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
    permissions: {
      notifications: permissions.notifications,
      microphone: permissions.microphone,
      fullScreenIntent: permissions.fullScreenIntent,
    },
    busyKey,
    supportsFullScreenIntentToggle,
    toggleNotifications,
    toggleMicrophone,
    toggleFullScreenIntent,
    completeOnboarding,
  };
}
