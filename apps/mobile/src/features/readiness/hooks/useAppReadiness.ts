import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import {
  getActiveAiProviderSync,
  getProviderApiKey,
  subscribeAiProviders,
} from '../../ai/lib/providerStore';
import { PROVIDER_PRESETS } from '../../ai/lib/providerTypes';
import { usePermissions } from '../../permissions/hooks/usePermissions';
import { permissionManager } from '../../permissions/lib/permissionManager';
import { AiProviderConfig } from '../../../types/database';

export interface AppReadinessState {
  hydrated: boolean;
  providerConfigured: boolean;
  microphoneGranted: boolean;
  isReady: boolean;
  activeProvider: AiProviderConfig | null;
  recheck: () => Promise<void>;
}

/**
 * Single source of truth for conditional Aura visibility.
 * Evaluates AI provider configuration (including Keystore API key presence when required)
 * and required OS permissions, and automatically re-validates on focus and app resume
 * without UI flicker.
 */
export function useAppReadiness(): AppReadinessState {
  const { hydrated: permsHydrated, allRequiredGranted } = usePermissions({
    syncOnResume: true,
  });

  const [activeProvider, setActiveProvider] = useState<AiProviderConfig | null>(() =>
    getActiveAiProviderSync(),
  );
  const [providerHydrated, setProviderHydrated] = useState(false);
  const [providerConfigured, setProviderConfigured] = useState(false);

  const checkProvider = useCallback(async () => {
    const active = getActiveAiProviderSync();
    setActiveProvider(active);
    if (!active) {
      setProviderConfigured(false);
      setProviderHydrated(true);
      return;
    }

    const preset = PROVIDER_PRESETS[active.providerType];
    if (!preset?.requiresApiKey) {
      // Custom OpenAI-compatible endpoints (e.g. Ollama / Desktop Bridge) may or may not need a key
      const hasUrl = Boolean(active.baseUrl && active.baseUrl.trim().length > 0);
      setProviderConfigured(hasUrl);
      setProviderHydrated(true);
      return;
    }

    const key = await getProviderApiKey(active);
    setProviderConfigured(Boolean(key && key.trim().length > 0));
    setProviderHydrated(true);
  }, []);

  const recheck = useCallback(async () => {
    await Promise.all([checkProvider(), permissionManager.refreshAll()]);
  }, [checkProvider]);

  useEffect(() => {
    void checkProvider();
    return subscribeAiProviders(() => {
      void checkProvider();
    });
  }, [checkProvider]);

  useFocusEffect(
    useCallback(() => {
      void recheck();
    }, [recheck]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void recheck();
      }
    });
    return () => sub.remove();
  }, [recheck]);

  const hydrated = permsHydrated && providerHydrated;
  const isReady = hydrated && providerConfigured && allRequiredGranted;

  return {
    hydrated,
    providerConfigured,
    microphoneGranted: allRequiredGranted,
    isReady,
    activeProvider,
    recheck,
  };
}
