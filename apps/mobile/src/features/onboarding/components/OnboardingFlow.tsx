import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AgentAudioVisualizerAura } from '../../../components/AgentAudioVisualizerAura';
import { QrIcon, SparkIcon } from '../../../components/MonoIcons';
import { FadeSlideView, MonoPressable } from '../../../components/MonoUi';
import { MONO, RADIUS, TYPE } from '../../../theme/monoTheme';

export type OnboardingIntent =
  | 'openrouter_oauth'
  | 'pair_desktop'
  | 'setup_provider'
  | 'enter_app';

interface OnboardingFlowProps {
  onComplete: (intent: OnboardingIntent) => void;
}

/**
 * Pure monochrome first-launch screen — zero paragraphs, clear icon actions.
 */
export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <FadeSlideView style={styles.center}>
        <AgentAudioVisualizerAura
          size="lg"
          connectionStatus="idle"
          state="idle"
          audioLevel={0.14}
          colorShift={0.3}
        />
        <Text style={styles.title}>Kallie</Text>
      </FadeSlideView>

      <View style={styles.actions}>
        <MonoPressable
          style={styles.primaryBtn}
          onPress={() => onComplete('openrouter_oauth')}
        >
          <SparkIcon color={MONO.black} size={16} />
          <Text style={styles.primaryBtnText}>Quick Connect</Text>
        </MonoPressable>

        <MonoPressable
          style={styles.secondaryBtn}
          onPress={() => onComplete('pair_desktop')}
        >
          <QrIcon color={MONO.white} size={16} />
          <Text style={styles.secondaryBtnText}>Scan PC QR</Text>
        </MonoPressable>

        <View style={styles.footerRow}>
          <Pressable
            style={({ pressed }) => [styles.linkBtn, pressed && styles.linkPressed]}
            onPress={() => onComplete('setup_provider')}
          >
            <Text style={styles.linkBtnText}>API Key</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.linkBtn, pressed && styles.linkPressed]}
            onPress={() => onComplete('enter_app')}
          >
            <Text style={styles.linkBtnText}>Skip</Text>
          </Pressable>
        </View>
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
    justifyContent: 'space-between',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...TYPE.display,
    marginTop: 24,
    color: MONO.white,
  },
  actions: {
    gap: 10,
  },
  primaryBtn: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: MONO.white,
    borderRadius: RADIUS.pill,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    ...TYPE.button,
    color: MONO.black,
  },
  secondaryBtn: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    borderRadius: RADIUS.pill,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    ...TYPE.label,
    fontSize: 14,
    color: MONO.white,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  linkBtn: {
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  linkPressed: {
    opacity: 0.6,
  },
  linkBtnText: {
    ...TYPE.label,
    color: MONO.textMuted,
  },
});
