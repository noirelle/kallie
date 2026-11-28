import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AgentAudioVisualizerAura } from '../../../components/AgentAudioVisualizerAura';
import {
  CheckIcon,
  ChevronRightIcon,
  KeyIcon,
  QrIcon,
  SlidersIcon,
  SparkIcon,
} from '../../../components/MonoIcons';
import {
  FadeSlideView,
  MonoDivider,
  MonoPressable,
  MonoSectionCard,
} from '../../../components/MonoUi';
import { MONO, RADIUS, TYPE } from '../../../theme/monoTheme';
import {
  checkClipboardForApiKey,
  DetectedClipboardKey,
  openFreeGeminiKeyPage,
  saveDetectedClipboardKey,
} from '../../ai/lib/clipboardKeyDetector';
import { startOpenRouterOAuth } from '../../ai/lib/openRouterAuth';
import { MicIcon } from '../../calling/components/CallIcons';
import { permissionManager } from '../../permissions/lib/permissionManager';

interface SetupGateViewProps {
  providerConfigured: boolean;
  microphoneGranted: boolean;
  onConfigureAi: () => void;
  onScanPcQr: () => void;
  onOpenPermissions: () => void;
  onOpenSettings: () => void;
}

/**
 * Minimalist conditional fallback shown instead of the interactive Aura
 * whenever required AI configuration or microphone permission is missing.
 */
export function SetupGateView({
  providerConfigured,
  microphoneGranted,
  onConfigureAi,
  onScanPcQr,
  onOpenPermissions,
  onOpenSettings,
}: SetupGateViewProps) {
  const [requestingMic, setRequestingMic] = useState(false);
  const [launchingOAuth, setLaunchingOAuth] = useState(false);
  const [clipboardKey, setClipboardKey] = useState<DetectedClipboardKey | null>(null);
  const [savingClipboardKey, setSavingClipboardKey] = useState(false);

  const scanClipboard = useCallback(async () => {
    if (providerConfigured) {
      setClipboardKey(null);
      return;
    }
    const detected = await checkClipboardForApiKey();
    setClipboardKey(detected);
  }, [providerConfigured]);

  useEffect(() => {
    void scanClipboard();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void scanClipboard();
      }
    });
    return () => sub.remove();
  }, [scanClipboard]);

  const handleConnectCopiedKey = async () => {
    if (!clipboardKey || savingClipboardKey) return;
    setSavingClipboardKey(true);
    try {
      await saveDetectedClipboardKey(clipboardKey, { setActive: true });
      setClipboardKey(null);
    } finally {
      setSavingClipboardKey(false);
    }
  };

  const handleOneTapConnect = async () => {
    if (launchingOAuth) return;
    setLaunchingOAuth(true);
    try {
      await startOpenRouterOAuth();
    } catch {
      onConfigureAi();
    } finally {
      setLaunchingOAuth(false);
    }
  };

  const handleMicPress = async () => {
    if (microphoneGranted || requestingMic) return;
    setRequestingMic(true);
    try {
      const result = await permissionManager.requestPermission('microphone');
      if (result !== 'granted') {
        onOpenPermissions();
      }
    } finally {
      setRequestingMic(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <View style={styles.spacer} />
        <MonoPressable
          style={styles.iconBtn}
          scaleTo={0.92}
          onPress={onOpenSettings}
          hitSlop={10}
          accessibilityLabel="Open settings"
        >
          <SlidersIcon color={MONO.white} size={18} />
        </MonoPressable>
      </View>

      <FadeSlideView style={styles.center}>
        <View style={styles.dormantAuraWrap}>
          <AgentAudioVisualizerAura
            size="md"
            connectionStatus="disconnected"
            state="idle"
            audioLevel={0.04}
          />
        </View>

        <Text style={styles.title}>Setup</Text>

        <View style={styles.checklistWrap}>
          <MonoSectionCard>
          <Pressable
            style={({ pressed }) => [
              styles.row,
              providerConfigured && styles.rowDone,
              pressed && styles.rowPressed,
            ]}
            onPress={onConfigureAi}
          >
            <View style={[styles.iconWrap, providerConfigured && styles.iconWrapDone]}>
              <SparkIcon color={providerConfigured ? MONO.black : MONO.white} size={16} />
            </View>
            <Text style={styles.rowLabel}>AI</Text>
            <View style={styles.rowRight}>
              {providerConfigured ? (
                <CheckIcon color={MONO.white} size={15} />
              ) : (
                <ChevronRightIcon color={MONO.textMuted} size={15} />
              )}
            </View>
          </Pressable>

          <MonoDivider inset={16} />

          <Pressable
            style={({ pressed }) => [
              styles.row,
              microphoneGranted && styles.rowDone,
              pressed && styles.rowPressed,
            ]}
            onPress={() => void handleMicPress()}
            disabled={requestingMic}
          >
            <View style={[styles.iconWrap, microphoneGranted && styles.iconWrapDone]}>
              <MicIcon
                color={microphoneGranted ? MONO.black : MONO.white}
                size={16}
              />
            </View>
            <Text style={styles.rowLabel}>Microphone</Text>
            <View style={styles.rowRight}>
              {requestingMic ? (
                <ActivityIndicator size="small" color={MONO.white} />
              ) : microphoneGranted ? (
                <CheckIcon color={MONO.white} size={15} />
              ) : (
                <ChevronRightIcon color={MONO.textMuted} size={15} />
              )}
            </View>
          </Pressable>
          </MonoSectionCard>
        </View>
      </FadeSlideView>

      <View style={styles.footer}>
        {!providerConfigured ? (
          <View style={styles.footerStack}>
            {clipboardKey ? (
              <MonoPressable
                style={styles.primaryPill}
                onPress={() => void handleConnectCopiedKey()}
                disabled={savingClipboardKey}
              >
                {savingClipboardKey ? (
                  <ActivityIndicator size="small" color={MONO.black} />
                ) : (
                  <>
                    <KeyIcon color={MONO.black} size={16} />
                    <Text style={styles.primaryPillText}>
                      Use {clipboardKey.label} Key
                    </Text>
                  </>
                )}
              </MonoPressable>
            ) : (
              <MonoPressable
                style={styles.primaryPill}
                onPress={() => void handleOneTapConnect()}
                disabled={launchingOAuth}
              >
                {launchingOAuth ? (
                  <ActivityIndicator size="small" color={MONO.black} />
                ) : (
                  <>
                    <SparkIcon color={MONO.black} size={16} />
                    <Text style={styles.primaryPillText}>Quick Connect</Text>
                  </>
                )}
              </MonoPressable>
            )}

            <View style={styles.secondaryFooterRow}>
              <MonoPressable
                style={styles.secondaryPill}
                onPress={() => void openFreeGeminiKeyPage()}
              >
                <KeyIcon color={MONO.textSecondary} size={14} />
                <Text style={styles.secondaryPillText}>Free Gemini Key</Text>
              </MonoPressable>

              <MonoPressable
                style={styles.secondaryPill}
                onPress={onScanPcQr}
              >
                <QrIcon color={MONO.textSecondary} size={14} />
                <Text style={styles.secondaryPillText}>Scan PC QR</Text>
              </MonoPressable>
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MONO.bg,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  topBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spacer: { width: 38, height: 38 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  dormantAuraWrap: {
    opacity: 0.5,
  },
  title: {
    ...TYPE.title,
    color: MONO.textPrimary,
  },
  checklistWrap: {
    width: '100%',
    maxWidth: 320,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    height: 60,
  },
  rowDone: {
    opacity: 0.6,
  },
  rowPressed: {
    backgroundColor: MONO.surfaceElevated,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: MONO.surfaceElevated,
    borderWidth: 1,
    borderColor: MONO.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapDone: {
    backgroundColor: MONO.white,
    borderColor: MONO.white,
  },
  rowLabel: {
    ...TYPE.bodyMedium,
    flex: 1,
    color: MONO.textPrimary,
  },
  rowRight: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerStack: {
    width: '100%',
    maxWidth: 320,
    gap: 10,
    alignItems: 'center',
  },
  secondaryFooterRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
  },
  secondaryPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: RADIUS.pill,
  },
  secondaryPillText: {
    ...TYPE.label,
    color: MONO.textPrimary,
  },
  primaryPill: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: MONO.white,
    height: 48,
    borderRadius: RADIUS.pill,
  },
  primaryPillText: {
    ...TYPE.button,
    color: MONO.black,
  },
});
