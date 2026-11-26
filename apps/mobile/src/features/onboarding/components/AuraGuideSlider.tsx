import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AgentAudioVisualizerAura } from '../../../components/AgentAudioVisualizerAura';
import {
  AURA_DEMO_SEQUENCE,
  AURA_STATUS_PALETTES,
  AuraConnectionStatus,
} from '../../../components/auraTheme';

interface AuraGuideSliderProps {
  onComplete: () => void;
}

type DemoStateKey = Exclude<AuraConnectionStatus, 'idle'>;

const STATE_EXPLANATIONS: Record<
  DemoStateKey,
  { title: string; subtitle: string; auraState: 'connecting' | 'listening' | 'speaking' }
> = {
  connecting: {
    title: 'Connecting',
    subtitle: 'Green means Aura is establishing your live connection.',
    auraState: 'connecting',
  },
  connected: {
    title: 'Connected',
    subtitle: 'Blue means Kallie is ready. Tap Aura anytime to talk.',
    auraState: 'speaking',
  },
  weak: {
    title: 'Weak connection',
    subtitle: 'Yellow means your internet signal is unstable.',
    auraState: 'listening',
  },
  disconnected: {
    title: 'Disconnected',
    subtitle: 'Red means the connection was lost. Tap to reconnect.',
    auraState: 'listening',
  },
};

/**
 * Single centered Aura onboarding explanation:
 * - Reuses ONE Aura visual at the center and smoothly shifts its color through
 *   all 4 live connection states (Green -> Blue -> Yellow -> Red).
 * - Disables Continue until the user has viewed every state (no immediate skip).
 */
export function AuraGuideSlider({ onComplete }: AuraGuideSliderProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewedKeys, setViewedKeys] = useState<DemoStateKey[]>(['connecting']);
  const [manualOverride, setManualOverride] = useState(false);

  const activeKey = AURA_DEMO_SEQUENCE[activeIndex];
  const palette = AURA_STATUS_PALETTES[activeKey];
  const copy = STATE_EXPLANATIONS[activeKey];
  const allViewed = viewedKeys.length >= AURA_DEMO_SEQUENCE.length;

  const selectIndex = (idx: number, isManual = false) => {
    const key = AURA_DEMO_SEQUENCE[idx];
    setActiveIndex(idx);
    if (isManual) {
      setManualOverride(true);
    }
    setViewedKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
  };

  // Gently step through all 4 states automatically unless the user takes manual control
  useEffect(() => {
    if (manualOverride || allViewed) return;
    const timer = setTimeout(() => {
      const nextIdx = activeIndex + 1;
      if (nextIdx < AURA_DEMO_SEQUENCE.length) {
        selectIndex(nextIdx, false);
      }
    }, 2400);
    return () => clearTimeout(timer);
  }, [activeIndex, allViewed, manualOverride]);

  const handleAdvanceOrContinue = () => {
    if (allViewed) {
      onComplete();
      return;
    }
    const nextUnseenIdx = AURA_DEMO_SEQUENCE.findIndex(
      (k) => !viewedKeys.includes(k),
    );
    if (nextUnseenIdx >= 0) {
      selectIndex(nextUnseenIdx, true);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.stage}>
        <Pressable
          onPress={() => selectIndex((activeIndex + 1) % AURA_DEMO_SEQUENCE.length, true)}
          style={styles.auraSlot}
          accessibilityLabel="Preview next Aura color state"
        >
          <AgentAudioVisualizerAura
            size="xl"
            connectionStatus={activeKey}
            state={copy.auraState}
            audioLevel={activeKey === 'connected' ? 0.52 : 0.25}
          />
        </Pressable>

        <View style={styles.textBlock}>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.subtitle}>{copy.subtitle}</Text>
        </View>
      </View>

      <View style={styles.footer}>
        {/* Minimal interactive color dots representing all 4 states */}
        <View style={styles.dotsRow}>
          {AURA_DEMO_SEQUENCE.map((key, idx) => {
            const item = AURA_STATUS_PALETTES[key];
            const isActive = idx === activeIndex;
            const isViewed = viewedKeys.includes(key);
            return (
              <Pressable
                key={key}
                onPress={() => selectIndex(idx, true)}
                hitSlop={10}
                style={[
                  styles.colorDot,
                  {
                    backgroundColor: item.primary,
                    opacity: isActive ? 1 : isViewed ? 0.55 : 0.24,
                  },
                  isActive && styles.colorDotActive,
                ]}
                accessibilityLabel={`${item.label}: ${STATE_EXPLANATIONS[key].title}`}
              />
            );
          })}
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.continueBtn,
            !allViewed && styles.continueBtnDisabled,
            pressed && allViewed && styles.continueBtnPressed,
          ]}
          onPress={handleAdvanceOrContinue}
          disabled={!allViewed}
          accessibilityState={{ disabled: !allViewed }}
        >
          <Text
            style={[
              styles.continueBtnText,
              !allViewed && styles.continueBtnTextDisabled,
            ]}
          >
            Continue
          </Text>
        </Pressable>

        <View style={styles.hintRow}>
          <Text style={styles.hintText}>
            {allViewed
              ? 'Tap any color above to review'
              : `${viewedKeys.length} of ${AURA_DEMO_SEQUENCE.length} states`}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
  },
  auraSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: {
    alignItems: 'center',
    marginTop: 18,
    minHeight: 84,
    paddingHorizontal: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  subtitle: {
    color: '#71717A',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
    textAlign: 'center',
  },
  footer: {
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    gap: 16,
    paddingTop: 8,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  colorDotActive: {
    width: 24,
    borderRadius: 5,
  },
  continueBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnDisabled: {
    backgroundColor: '#18181B',
  },
  continueBtnPressed: {
    backgroundColor: '#E4E4E7',
  },
  continueBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
  },
  continueBtnTextDisabled: {
    color: '#52525B',
  },
  hintRow: {
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintText: {
    color: '#52525B',
    fontSize: 12,
  },
});
