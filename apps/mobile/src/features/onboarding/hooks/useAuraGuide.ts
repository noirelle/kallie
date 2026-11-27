import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { getPreferenceSync, setPreferenceSync } from '../../../lib/storage/localDb';

const AURA_GUIDE_KEY_PREFIX = 'kallie_aura_guide_v2_';

export function useAuraGuide(userId?: string) {
  const [state, setState] = useState<{ hydrated: boolean; completed: boolean }>(() => {
    if (!userId) return { hydrated: true, completed: false };
    const saved = getPreferenceSync<boolean>(`${AURA_GUIDE_KEY_PREFIX}${userId}`);
    return {
      hydrated: saved !== null,
      completed: saved === true,
    };
  });
  const { hydrated, completed } = state;

  useEffect(() => {
    let active = true;
    if (!userId) {
      setState({ hydrated: true, completed: false });
      return;
    }

    const prefKey = `${AURA_GUIDE_KEY_PREFIX}${userId}`;
    const savedLocal = getPreferenceSync<boolean>(prefKey);
    if (savedLocal !== null) {
      setState({ hydrated: true, completed: savedLocal === true });
      return;
    }

    // One-time fallback/migration from legacy AsyncStorage
    setState((prev) => (prev.hydrated ? { hydrated: false, completed: false } : prev));
    AsyncStorage.getItem(prefKey)
      .then((val) => {
        const done = val === 'done';
        if (done) {
          setPreferenceSync(prefKey, true);
        }
        if (active) {
          setState({ hydrated: true, completed: done });
        }
      })
      .catch(() => {
        if (active) {
          setState({ hydrated: true, completed: false });
        }
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const completeGuide = useCallback(async () => {
    if (userId) {
      const prefKey = `${AURA_GUIDE_KEY_PREFIX}${userId}`;
      setPreferenceSync(prefKey, true);
      await AsyncStorage.setItem(prefKey, 'done').catch(() => {});
    }
    setState({ hydrated: true, completed: true });
  }, [userId]);

  return { hydrated, completed, completeGuide };
}
