import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const AURA_GUIDE_KEY_PREFIX = 'kallie_aura_guide_v1_';

export function useAuraGuide(userId?: string) {
  const [hydrated, setHydrated] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setCompleted(false);
      setHydrated(true);
      return;
    }

    setHydrated(false);
    AsyncStorage.getItem(`${AURA_GUIDE_KEY_PREFIX}${userId}`)
      .then((val) => {
        if (active) {
          setCompleted(val === 'done');
        }
      })
      .catch(() => {
        if (active) {
          setCompleted(false);
        }
      })
      .finally(() => {
        if (active) {
          setHydrated(true);
        }
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const completeGuide = useCallback(async () => {
    if (userId) {
      await AsyncStorage.setItem(`${AURA_GUIDE_KEY_PREFIX}${userId}`, 'done').catch(
        () => {},
      );
    }
    setCompleted(true);
  }, [userId]);

  return { hydrated, completed, completeGuide };
}
