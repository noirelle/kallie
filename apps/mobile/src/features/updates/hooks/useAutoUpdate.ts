import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { appEnv } from '../../../lib/env';

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

    // 1. Automatic Expo OTA update (triggered by GitHub Actions on push to main)
    if (!__DEV__ && Updates.isEnabled) {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) {
          setDismissed(false);
          setState({ kind: 'ota_downloading' });
          await Updates.fetchUpdateAsync();
          setState({ kind: 'ota_ready' });
          return;
        }
      } catch {
        // Ignore transient network errors during background update checks
      }
    }

    // 2. GitHub Releases native APK check (for native binary updates)
    if (Platform.OS === 'android' && appEnv.githubRepo) {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${appEnv.githubRepo}/releases/latest`,
          { headers: { Accept: 'application/vnd.github+json' } },
        );
        if (!res.ok) return;

        const release = (await res.json()) as {
          tag_name?: string;
          html_url?: string;
          assets?: Array<{ name?: string; browser_download_url?: string }>;
        };

        const currentVersion = Constants.expoConfig?.version || '0.1.0';
        const latestTag = release.tag_name || '';

        if (latestTag && isNewerVersion(latestTag, currentVersion)) {
          const apkAsset = release.assets?.find((asset) =>
            asset.name?.toLowerCase().endsWith('.apk'),
          );
          const downloadUrl = apkAsset?.browser_download_url || release.html_url || '';
          if (downloadUrl) {
            setDismissed(false);
            setState({
              kind: 'apk_available',
              version: latestTag,
              downloadUrl,
            });
          }
        }
      } catch {
        // Ignore network errors
      }
    }
  }, []);

  useEffect(() => {
    void checkUpdates();

    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void checkUpdates();
      }
    });

    return () => sub.remove();
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
