import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckIcon, MonitorIcon, QrIcon } from '../src/components/MonoIcons';
import { FadeSlideView, MonoHeader, MonoStatusDot } from '../src/components/MonoUi';
import { QrScannerModal } from '../src/features/bridge/components/QrScannerModal';
import {
  DesktopBridgeMeta,
  normalizeBridgeBaseUrl,
  pairDesktopBridge,
  parsePairingUri,
  selectDesktopEngineModel,
} from '../src/features/bridge/lib/desktopBridgeClient';
import { markLocalOnboardingComplete } from '../src/features/onboarding/hooks/useOnboardingPermissions';
import { MONO, RADIUS, TYPE } from '../src/theme/monoTheme';

type PairStatus = 'idle' | 'pairing' | 'success' | 'error';

export default function PairDesktopScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    url?: string | string[];
    token?: string | string[];
    name?: string | string[];
  }>();

  const rawUrl = Array.isArray(params.url) ? params.url[0] : params.url || '';
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token || '';
  const rawName = Array.isArray(params.name) ? params.name[0] : params.name || 'PC';

  const [status, setStatus] = useState<PairStatus>(rawUrl && rawToken ? 'pairing' : 'idle');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [meta, setMeta] = useState<DesktopBridgeMeta | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [switchingModel, setSwitchingModel] = useState<string | null>(null);

  const pairWithPayload = useCallback(
    async (baseUrlRaw: string, tokenRaw: string, deviceNameRaw: string) => {
      const baseUrl = normalizeBridgeBaseUrl(baseUrlRaw);
      if (!baseUrl || !tokenRaw.trim()) {
        setStatus('error');
        setErrorMsg('Invalid pairing code');
        return;
      }

      setStatus('pairing');
      setErrorMsg(null);
      try {
        const result = await pairDesktopBridge({
          baseUrl,
          token: tokenRaw.trim(),
          deviceName: deviceNameRaw.trim() || 'PC',
        });
        await markLocalOnboardingComplete();
        setMeta(result.meta);
        setSelectedModel(result.selectedModel);
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : 'Unable to reach PC');
      }
    },
    [],
  );

  useEffect(() => {
    if (rawUrl && rawToken) {
      void pairWithPayload(rawUrl, rawToken, rawName);
    }
  }, [pairWithPayload, rawName, rawToken, rawUrl]);

  const handleQrScanned = useCallback(
    (uri: string) => {
      setScannerOpen(false);
      const parsed = parsePairingUri(uri);
      if (!parsed) {
        setStatus('error');
        setErrorMsg('Invalid Kallie QR');
        return;
      }
      void pairWithPayload(parsed.baseUrl, parsed.token, parsed.deviceName);
    },
    [pairWithPayload],
  );

  const handleSelectModel = async (modelId: string) => {
    setSwitchingModel(modelId);
    try {
      await selectDesktopEngineModel(modelId);
      setSelectedModel(modelId);
    } finally {
      setSwitchingModel(null);
    }
  };

  const installedModels =
    meta?.engines.flatMap((engine) =>
      engine.installed ? engine.models : [],
    ) ?? [];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <MonoHeader
        title="Pair PC"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <FadeSlideView style={styles.inner}>
          <View style={styles.iconCircle}>
            {status === 'pairing' ? (
              <ActivityIndicator size="small" color={MONO.white} />
            ) : status === 'success' ? (
              <CheckIcon color={MONO.white} size={24} />
            ) : (
              <MonitorIcon color={MONO.white} size={24} />
            )}
          </View>

          <Text style={styles.title}>
            {status === 'idle'
              ? 'Scan PC QR'
              : status === 'pairing'
                ? rawName
                : status === 'success'
                  ? meta?.deviceName || rawName
                  : 'Failed'}
          </Text>

          {status === 'idle' ? (
            <View style={styles.actions}>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                onPress={() => setScannerOpen(true)}
              >
                <QrIcon color={MONO.black} size={18} />
                <Text style={styles.primaryBtnText}>Open Camera</Text>
              </Pressable>
              <Text style={styles.cmdHint}>npm run dev:bridge</Text>
            </View>
          ) : null}

          {status === 'error' ? (
            <View style={styles.actions}>
              <View style={styles.statusPill}>
                <MonoStatusDot active={false} />
                <Text style={styles.statusText}>{errorMsg}</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                onPress={() => setScannerOpen(true)}
              >
                <QrIcon color={MONO.black} size={18} />
                <Text style={styles.primaryBtnText}>Scan Again</Text>
              </Pressable>
            </View>
          ) : null}

          {status === 'success' && meta ? (
            <View style={styles.actions}>
              {installedModels.length > 0 ? (
                <View style={styles.chipWrap}>
                  {installedModels.map((item) => {
                    const active = selectedModel === item.id;
                    return (
                      <Pressable
                        key={item.id}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => void handleSelectModel(item.id)}
                        disabled={switchingModel === item.id}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                onPress={() => router.replace('/')}
              >
                <Text style={styles.primaryBtnText}>Continue</Text>
              </Pressable>
            </View>
          ) : null}
        </FadeSlideView>
      </ScrollView>

      <QrScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={handleQrScanned}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: MONO.bg },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  inner: { alignItems: 'center', gap: 18 },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...TYPE.title, color: MONO.white },
  actions: { width: '100%', maxWidth: 320, gap: 14, alignItems: 'center' },
  primaryBtn: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    backgroundColor: MONO.white,
    borderRadius: RADIUS.pill,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { ...TYPE.button, color: MONO.black },
  cmdHint: { ...TYPE.mono, color: MONO.textMuted },
  statusPill: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: RADIUS.md,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
  },
  statusText: { ...TYPE.caption, flex: 1, color: MONO.textSecondary },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: RADIUS.pill,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: MONO.white, borderColor: MONO.white },
  chipText: { ...TYPE.caption, color: MONO.textSecondary },
  chipTextActive: { ...TYPE.label, fontSize: 12, color: MONO.black },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
});
