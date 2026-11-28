import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  networkMonitor,
  NetworkQuality,
  NetworkQualitySnapshot,
} from '../lib/networkMonitor';

export interface UseNetworkQualityResult extends NetworkQualitySnapshot {
  isOffline: boolean;
  isWeak: boolean;
  checkNow: () => Promise<NetworkQualitySnapshot>;
}

/**
 * Subscribes to the singleton real-time NetworkMonitor so Aura and call controls
 * react immediately to Wi-Fi/data loss (red) and slow/unstable links (yellow),
 * with memoized snapshots to prevent unnecessary downstream re-renders.
 */
export function useNetworkQuality(): UseNetworkQualityResult {
  const [snapshot, setSnapshot] = useState<NetworkQualitySnapshot>(() =>
    networkMonitor.getSnapshot(),
  );

  useEffect(() => {
    setSnapshot(networkMonitor.getSnapshot());
    return networkMonitor.subscribe(setSnapshot);
  }, []);

  const checkNow = useCallback(() => networkMonitor.probeNow(true), []);

  return useMemo(
    () => ({
      ...snapshot,
      isOffline: snapshot.quality === 'disconnected',
      isWeak: snapshot.quality === 'weak',
      checkNow,
    }),
    [checkNow, snapshot],
  );
}

export type { NetworkQuality };
