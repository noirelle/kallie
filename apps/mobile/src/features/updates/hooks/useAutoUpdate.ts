import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { cacheManager } from '../../../lib/cache/cacheManager';
import { appEnv } from '../../../lib/env';
import { scheduleAfterPaint } from '../../../lib/scheduleAfterPaint';

const GITHUB_RELEASE_CACHE_KEY = 'meta:github_latest_release';
const OTA_CHECK_CACHE_KEY = 'meta:expo_ota_check';
const GITHUB_RELEASE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const GITHUB_RELEASE_SWR_MS = 24 * 60 * 60 * 1000; // 24 hours SWR
const OTA_CHECK_TTL_MS = 5 * 60 * 1000; // 5 minutes in-memory (always checks once on cold launch)

interface CachedGithubRelease {
  tagName: string;
  downloadUrl: string;
}

export type UpdateBannerState =
  | { kind: 'idle' }
  | { kind: 'ota_downloading' }
  | { kind: 'ota_ready' }
  | { kind: 'apk_available'; version: string; downloadUrl: string };

function isNewerVersion(latestTag: string, currentVersion: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);

  const a = parse(latestTag);
  const b = parse(currentVersion);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

export function useAutoUpdate() {
  const [state, setState] = useState<UpdateBannerState>({ kind: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  const checkUpdates = useCallback(async () => {
    if (Platform.OS === 'web') {
      return;
    }

    // 1. Automatic Expo OTA update (throttled to 30 min + single-flight deduplicated)
    if (!__DEV__ && Updates.isEnabled) {
      const otaCached = cacheManager.getSync<{ checkedAt: number }>(OTA_CHECK_CACHE_KEY);
      if (!otaCached?.isFresh) {
        try {
          const otaReady = await cacheManager.dedupe(OTA_CHECK_CACHE_KEY, async () => {
            const result = await Updates.checkForUpdateAsync();
            cacheManager.set(
              OTA_CHECK_CACHE_KEY,
              { checkedAt: Date.now() },
              { ttlMs: OTA_CHECK_TTL_MS, persist: false },
            );
            if (result.isAvailable) {
              setDismissed(false);
              setState({ kind: 'ota_downloading' });
              await Updates.fetchUpdateAsync();
              setState({ kind: 'ota_ready' });
              return true;
            }
            return false;
          });
          if (otaReady) return;
        } catch {
          // Ignore transient network errors during background update checks
        }
      }
    }

    // 2. GitHub Releases native APK check (6h TTL + ETag 304 + 24h SWR + dedupe)
    if (Platform.OS === 'android' && appEnv.githubRepo) {
      try {
        const releaseInfo = await cacheManager.fetchWithCache<CachedGithubRelease | null>(
          `${GITHUB_RELEASE_CACHE_KEY}:${appEnv.githubRepo}`,
          async (cached) => {
            const headers: Record<string, string> = {
              Accept: 'application/vnd.github+json',
            };
            if (cached?.etag) {
              headers['If-None-Match'] = cached.etag;
            }
            const res = await fetch(
              `https://api.github.com/repos/${appEnv.githubRepo}/releases/latest`,
              { headers },
            );
            if (res.status === 304 && cached) {
              return { value: cached.value, etag: cached.etag, notModified: true };
            }
            if (!res.ok) {
              throw new Error(`GitHub release check HTTP ${res.status}`);
            }

            const release = (await res.json()) as {
              tag_name?: string;
              html_url?: string;
              assets?: Array<{ name?: string; browser_download_url?: string }>;
            };
            const tagName = release.tag_name || '';
            const apkAsset = release.assets?.find((asset) =>
              asset.name?.toLowerCase().endsWith('.apk'),
            );
            const downloadUrl = apkAsset?.browser_download_url || release.html_url || '';
            return {
              value: tagName && downloadUrl ? { tagName, downloadUrl } : null,
              etag: res.headers.get('etag'),
            };
          },
          {
            ttlMs: GITHUB_RELEASE_TTL_MS,
            staleWhileRevalidateMs: GITHUB_RELEASE_SWR_MS,
            persist: true,
          },
        );

        const currentVersion = Constants.expoConfig?.version || '0.1.0';
        if (releaseInfo && isNewerVersion(releaseInfo.tagName, currentVersion)) {
          setDismissed(false);
          setState({
            kind: 'apk_available',
            version: releaseInfo.tagName,
            downloadUrl: releaseInfo.downloadUrl,
          });
        }
      } catch {
        // Ignore network errors
      }
    }
  }, []);

  useEffect(() => {
    // Defer initial update check past first paint & standby staging so boot stays instant
    const cancelDeferred = scheduleAfterPaint(() => {
      void checkUpdates();
    }, 1500);

    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void checkUpdates();
      }
    });

    return () => {
      cancelDeferred();
      sub.remove();
    };
  }, [checkUpdates]);

  const applyUpdate = useCallback(async () => {
    if (state.kind === 'ota_ready') {
      await Updates.reloadAsync();
    } else if (state.kind === 'apk_available') {
      await Linking.openURL(state.downloadUrl);
    }
  }, [state]);

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  return {
    state: dismissed ? ({ kind: 'idle' } as UpdateBannerState) : state,
    applyUpdate,
    dismiss,
  };
}
