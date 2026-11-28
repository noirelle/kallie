import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { getPreferenceSync, setPreferenceSync } from '../../../lib/storage/localDb';

const ONBOARDING_DONE_KEY = 'kallie:local_welcome_completed:v2';
const completionListeners = new Set<() => void>();

export async function markLocalOnboardingComplete(): Promise<void> {
  setPreferenceSync(ONBOARDING_DONE_KEY, true);
  completionListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Ignore listener failure
    }
  });
  await AsyncStorage.setItem(ONBOARDING_DONE_KEY, 'true').catch(() => {});
}

export function useOnboardingPermissions() {
  const initialDone = getPreferenceSync<boolean>(ONBOARDING_DONE_KEY);
  const [hydrated, setHydrated] = useState(initialDone !== null);
  const [completed, setCompleted] = useState(Boolean(initialDone));

  useEffect(() => {
    const onExternalComplete = () => {
      setCompleted(true);
      setHydrated(true);
    };
    completionListeners.add(onExternalComplete);
    return () => {
      completionListeners.delete(onExternalComplete);
    };
  }, []);

  useEffect(() => {
    if (initialDone !== null) return;
    let mounted = true;
    void AsyncStorage.getItem(ONBOARDING_DONE_KEY)
      .then((raw) => {
        if (!mounted) return;
        const done = raw === 'true';
        setCompleted(done);
        setPreferenceSync(ONBOARDING_DONE_KEY, done);
        setHydrated(true);
      })
      .catch(() => {
        if (mounted) setHydrated(true);
      });
    return () => {
      mounted = false;
    };
  }, [initialDone]);

  const completeOnboarding = useCallback(async () => {
    setCompleted(true);
    await markLocalOnboardingComplete();
  }, []);

  return {
    hydrated,
    completed,
    completeOnboarding,
  };
}
