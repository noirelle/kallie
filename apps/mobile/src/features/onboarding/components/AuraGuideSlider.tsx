import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AgentAudioVisualizerAura } from '../../../components/AgentAudioVisualizerAura';
import {
  AURA_DEMO_SEQUENCE,
  AURA_STATUS_PALETTES,
  AuraConnectionStatus,
} from '../../../components/auraTheme';
import { BackArrowIcon } from './OnboardingIcons';

interface AuraGuideSliderProps {
  onComplete: () => void;
}

const TOTAL_SLIDES = 3;

function SlideDots({ current }: { current: number }) {
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
        <View key={i} style={[styles.dot, i === current && styles.dotActive]} />
      ))}
    </View>
  );
}

/**
 * Post-login interactive Aura guide matching the dark minimal onboarding style:
 * 1. How Aura works
 * 2. Live interactive color legend (Green, Blue, Yellow, Red)
 * 3. How to tap Aura to start/end calls and open chat
 */
export function AuraGuideSlider({ onComplete }: AuraGuideSliderProps) {
  const [slide, setSlide] = useState<0 | 1 | 2>(0);
  const [selectedStatus, setSelectedStatus] =
    useState<Exclude<AuraConnectionStatus, 'idle'>>('connecting');
  const [userPickedColor, setUserPickedColor] = useState(false);

  // Gently cycle through the 4 status colors on Slide 2 until the user taps one
  useEffect(() => {
    if (slide !== 1 || userPickedColor) return;
    const timer = setInterval(() => {
      setSelectedStatus((prev) => {
        const idx = AURA_DEMO_SEQUENCE.indexOf(prev);
        return AURA_DEMO_SEQUENCE[(idx + 1) % AURA_DEMO_SEQUENCE.length];
      });
    }, 2200);
    return () => clearInterval(timer);
  }, [slide, userPickedColor]);

  const goBack = () => {
    setSlide((prev) => (prev > 0 ? ((prev - 1) as 0 | 1 | 2) : 0));
  };

  const goNext = () => {
    if (slide < 2) {
      setSlide((slide + 1) as 0 | 1 | 2);
    } else {
      onComplete();
    }
  };

  const activePalette = AURA_STATUS_PALETTES[selectedStatus];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        {slide > 0 ? (
          <Pressable
            onPress={goBack}
            hitSlop={10}
            style={({ pressed }) => [
              styles.backCircle,
              pressed && styles.surfacePressed,
            ]}
            accessibilityLabel="Previous tip"
          >
            <BackArrowIcon color="#FFFFFF" />
          </Pressable>
        ) : (
          <View style={styles.topSpacer} />
        )}
      </View>

      {slide === 0 ? (
        <View style={styles.stage}>
          <View style={styles.auraSlot}>
            <AgentAudioVisualizerAura
              size="lg"
              connectionStatus="connected"
              state="speaking"
              audioLevel={0.62}
            />
          </View>
          <Text style={styles.title}>Meet Aura</Text>
          <Text style={styles.subtitle}>
            {'Your live voice link to Kallie.\nIt pulses as she listens, thinks, and speaks.'}
          </Text>
        </View>
      ) : null}

      {slide === 1 ? (
        <View style={styles.stage}>
          <View style={styles.auraSlotCompact}>
            <AgentAudioVisualizerAura
              size="md"
              connectionStatus={selectedStatus}
              state={selectedStatus === 'connecting' ? 'connecting' : 'listening'}
              audioLevel={0.35}
            />
          </View>

          <Text style={styles.title}>Connection colors</Text>
          <Text style={styles.subtitle}>
            {`${activePalette.label} — ${activePalette.description}`}
          </Text>

          <View style={styles.legendGrid}>
            {AURA_DEMO_SEQUENCE.map((statusKey) => {
              const item = AURA_STATUS_PALETTES[statusKey];
              const isSelected = selectedStatus === statusKey;
              return (
                <Pressable
                  key={statusKey}
                  style={({ pressed }) => [
                    styles.legendPill,
                    isSelected && {
                      borderColor: item.primary,
                      backgroundColor: '#16161A',
                    },
                    pressed && styles.surfacePressed,
                  ]}
                  onPress={() => {
                    setUserPickedColor(true);
                    setSelectedStatus(statusKey);
                  }}
                >
                  <View
                    style={[styles.colorDot, { backgroundColor: item.primary }]}
                  />
                  <View style={styles.legendTextWrap}>
                    <Text style={styles.legendLabel}>{item.label}</Text>
                    <Text style={styles.legendDesc} numberOfLines={1}>
                      {item.description}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {slide === 2 ? (
        <View style={styles.stage}>
          <View style={styles.auraSlot}>
            <AgentAudioVisualizerAura
              size="lg"
              connectionStatus="connected"
              state="idle"
              audioLevel={0.14}
            />
          </View>
          <Text style={styles.title}>Tap Aura to talk</Text>
          <Text style={styles.subtitle}>
            {'Tap once to connect, speak naturally,\nor open chat anytime during a call.'}
          </Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        <SlideDots current={slide} />

        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            pressed && styles.primaryBtnPressed,
          ]}
          onPress={goNext}
        >
          <Text style={styles.primaryBtnText}>
            {slide === 2 ? 'Start talking' : 'Continue'}
          </Text>
        </Pressable>

        <Pressable
          style={styles.skipRow}
          onPress={onComplete}
          hitSlop={10}
        >
          <Text style={styles.skipText}>
            {slide === 2 ? ' ' : 'Skip'}
          </Text>
        </Pressable>
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
  topBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 6,
  },
  topSpacer: {
    width: 40,
    height: 40,
  },
  backCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  surfacePressed: {
    backgroundColor: '#18181B',
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
  },
  auraSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  auraSlotCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 31,
    fontWeight: '700',
    letterSpacing: -0.7,
    lineHeight: 37,
    textAlign: 'center',
  },
  subtitle: {
    color: '#71717A',
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 21,
  },
  legendGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
    marginTop: 24,
  },
  legendPill: {
    width: '48.4%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendTextWrap: {
    flex: 1,
    gap: 1,
  },
  legendLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  legendDesc: {
    color: '#71717A',
    fontSize: 11,
  },
  footer: {
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    gap: 16,
    paddingTop: 12,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#27272A',
  },
  dotActive: {
    width: 18,
    backgroundColor: '#FFFFFF',
  },
  primaryBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnPressed: {
    backgroundColor: '#E4E4E7',
  },
  primaryBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
  },
  skipRow: {
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    color: '#71717A',
    fontSize: 13,
  },
});
