import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AgentAudioVisualizerAura } from '../../../components/AgentAudioVisualizerAura';
import { PermissionStates } from '../hooks/useOnboardingPermissions';
import { BackArrowIcon, TopicGlyph, TopicIconKind } from './OnboardingIcons';

interface OnboardingFlowProps {
  discoverySource: string | null;
  onSelectDiscovery: (source: string) => void;
  interests: string[];
  onToggleInterest: (id: string) => void;
  permissions: PermissionStates;
  busyKey: 'notifications' | 'microphone' | null;
  onToggleNotifications: () => void;
  onToggleMicrophone: () => void;
  onComplete: (intent: 'signup' | 'login') => void;
}

const DISCOVERY_OPTIONS = [
  'TikTok',
  'X (Twitter)',
  'YouTube',
  'Friend or referral',
  'GitHub',
  'Other',
];

const TOPIC_OPTIONS: Array<{ id: TopicIconKind; label: string }> = [
  { id: 'wakeups', label: 'Wake-ups' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'checkins', label: 'Check-ins' },
  { id: 'focus', label: 'Focus' },
  { id: 'study', label: 'Study' },
  { id: 'chat', label: 'Daily chat' },
  { id: 'workout', label: 'Workout' },
  { id: 'goals', label: 'Goals' },
  { id: 'habits', label: 'Habits' },
];

const TOTAL_STEPS = 4;

function StepDots({ current }: { current: number }) {
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <View key={i} style={[styles.dot, i === current && styles.dotActive]} />
      ))}
    </View>
  );
}

export function OnboardingFlow({
  discoverySource,
  onSelectDiscovery,
  interests,
  onToggleInterest,
  permissions,
  busyKey,
  onToggleNotifications,
  onToggleMicrophone,
  onComplete,
}: OnboardingFlowProps) {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);

  const goBack = () => {
    setStep((prev) => (prev > 0 ? ((prev - 1) as 0 | 1 | 2 | 3) : 0));
  };

  const goNext = () => {
    if (step < 3) {
      setStep((step + 1) as 0 | 1 | 2 | 3);
    } else {
      onComplete('signup');
    }
  };

  const allPermissionsGranted = permissions.notifications && permissions.microphone;

  const primaryLabel =
    step === 0
      ? 'Get started'
      : step === 3
        ? allPermissionsGranted
          ? 'Continue'
          : 'Continue'
        : 'Continue';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Consistent quiet top bar (hidden on Step 1) */}
      <View style={styles.topBar}>
        {step > 0 ? (
          <Pressable
            onPress={goBack}
            hitSlop={10}
            style={({ pressed }) => [
              styles.backCircle,
              pressed && styles.surfacePressed,
            ]}
            accessibilityLabel="Go back"
          >
            <BackArrowIcon color="#FFFFFF" />
          </Pressable>
        ) : (
          <View style={styles.topSpacer} />
        )}
      </View>

      {/* Step 0 — Welcome Hero with animated cycling Aura */}
      {step === 0 ? (
        <View style={styles.centeredStage}>
          <View style={styles.heroWrap}>
            <AgentAudioVisualizerAura
              size="lg"
              state="speaking"
              audioLevel={0.48}
              cycleDemoColors
            />
          </View>
          <Text style={styles.displayTitle}>{'The AI that\ncalls you back'}</Text>
          <Text style={styles.subtitle}>Voice companion on your schedule</Text>
        </View>
      ) : null}

      {/* Step 1 — Where did you discover Kallie? */}
      {step === 1 ? (
        <ScrollView
          contentContainerStyle={styles.scrollStage}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerBlock}>
            <Text style={styles.displayTitle}>{'Where did you\ndiscover Kallie?'}</Text>
            <Text style={styles.subtitle}>Pick one to help us grow</Text>
          </View>

          <View style={styles.pillStack}>
            {DISCOVERY_OPTIONS.map((option) => {
              const selected = discoverySource === option;
              return (
                <Pressable
                  key={option}
                  style={({ pressed }) => [
                    styles.pillOption,
                    selected && styles.pillOptionSelected,
                    pressed && !selected && styles.surfacePressed,
                  ]}
                  onPress={() => onSelectDiscovery(option)}
                >
                  <Text
                    style={[
                      styles.pillOptionText,
                      selected && styles.pillOptionTextSelected,
                    ]}
                  >
                    {option}
                  </Text>
                  <View
                    style={[
                      styles.radioCircle,
                      selected && styles.radioCircleSelected,
                    ]}
                  >
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      ) : null}

      {/* Step 2 — How will you use Kallie? */}
      {step === 2 ? (
        <ScrollView
          contentContainerStyle={styles.scrollStage}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerBlock}>
            <Text style={styles.displayTitle}>{'How will you\nuse Kallie?'}</Text>
            <Text style={styles.subtitle}>Pick a few to tailor your calls</Text>
          </View>

          <View style={styles.grid}>
            {TOPIC_OPTIONS.map((topic) => {
              const selected = interests.includes(topic.id);
              return (
                <Pressable
                  key={topic.id}
                  style={({ pressed }) => [
                    styles.gridTile,
                    selected && styles.gridTileSelected,
                    pressed && !selected && styles.surfacePressed,
                  ]}
                  onPress={() => onToggleInterest(topic.id)}
                >
                  <TopicGlyph
                    kind={topic.id}
                    color={selected ? '#000000' : '#FAFAFA'}
                  />
                  <Text
                    style={[
                      styles.gridLabel,
                      selected && styles.gridLabelSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {topic.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      ) : null}

      {/* Step 3 — Permissions */}
      {step === 3 ? (
        <View style={styles.centeredStage}>
          <View style={styles.compactHeroWrap}>
            <AgentAudioVisualizerAura
              size="md"
              state="listening"
              audioLevel={0.32}
              cycleDemoColors
            />
          </View>

          <View style={styles.headerBlock}>
            <Text style={styles.displayTitle}>Allow permissions</Text>
            <Text style={styles.subtitle}>So Kallie can call and hear you</Text>
          </View>

          <View style={styles.pillStack}>
            <Pressable
              style={({ pressed }) => [
                styles.permPill,
                permissions.notifications && styles.permPillEnabled,
                pressed && styles.surfacePressed,
              ]}
              onPress={onToggleNotifications}
              disabled={busyKey === 'notifications'}
            >
              <View style={styles.permText}>
                <Text style={styles.permTitle}>Notifications</Text>
                <Text style={styles.permSub}>Incoming calls and reminders</Text>
              </View>
              <View
                style={[
                  styles.switchTrack,
                  permissions.notifications && styles.switchTrackOn,
                ]}
              >
                <View
                  style={[
                    styles.switchThumb,
                    permissions.notifications && styles.switchThumbOn,
                  ]}
                />
              </View>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.permPill,
                permissions.microphone && styles.permPillEnabled,
                pressed && styles.surfacePressed,
              ]}
              onPress={onToggleMicrophone}
              disabled={busyKey === 'microphone'}
            >
              <View style={styles.permText}>
                <Text style={styles.permTitle}>Microphone</Text>
                <Text style={styles.permSub}>Live voice conversations</Text>
              </View>
              <View
                style={[
                  styles.switchTrack,
                  permissions.microphone && styles.switchTrackOn,
                ]}
              >
                <View
                  style={[
                    styles.switchThumb,
                    permissions.microphone && styles.switchThumbOn,
                  ]}
                />
              </View>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Unified Step-1 Footer anchored across all 4 steps */}
      <View style={styles.footer}>
        <StepDots current={step} />

        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            pressed && styles.primaryBtnPressed,
          ]}
          onPress={goNext}
        >
          <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
        </Pressable>

        {step === 0 ? (
          <Pressable
            style={styles.footerLinkRow}
            onPress={() => onComplete('login')}
            hitSlop={10}
          >
            <Text style={styles.footerMuted}>Already have an account? </Text>
            <Text style={styles.footerAccent}>Log in</Text>
          </Pressable>
        ) : step === 3 ? (
          <Pressable
            style={styles.footerLinkRow}
            onPress={() => onComplete('signup')}
            hitSlop={10}
          >
            <Text style={styles.footerMuted}>
              {allPermissionsGranted ? 'Ready to create your account' : 'Skip for now'}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.footerLinkRow}
            onPress={goNext}
            hitSlop={10}
          >
            <Text style={styles.footerMuted}>Skip for now</Text>
          </Pressable>
        )}
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
  centeredStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
  },
  scrollStage: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 12,
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
  },
  heroWrap: {
    marginBottom: 14,
  },
  compactHeroWrap: {
    marginBottom: 6,
  },
  headerBlock: {
    alignItems: 'center',
    marginBottom: 28,
  },
  displayTitle: {
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
    lineHeight: 20,
  },
  pillStack: {
    width: '100%',
    gap: 11,
  },
  pillOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 999,
    height: 52,
    paddingHorizontal: 20,
  },
  pillOptionSelected: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  pillOptionText: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '500',
  },
  pillOptionTextSelected: {
    color: '#000000',
    fontWeight: '600',
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleSelected: {
    borderColor: '#000000',
    backgroundColor: '#000000',
  },
  radioDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FFFFFF',
  },
  surfacePressed: {
    backgroundColor: '#18181B',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
    width: '100%',
  },
  gridTile: {
    width: '31.2%',
    aspectRatio: 1,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 6,
  },
  gridTileSelected: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  gridLabel: {
    color: '#E4E4E7',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  gridLabelSelected: {
    color: '#000000',
    fontWeight: '600',
  },
  permPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 999,
    paddingLeft: 22,
    paddingRight: 16,
    paddingVertical: 15,
  },
  permPillEnabled: {
    borderColor: 'rgba(255, 255, 255, 0.32)',
    backgroundColor: '#151517',
  },
  permText: {
    flex: 1,
    gap: 2,
  },
  permTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  permSub: {
    color: '#71717A',
    fontSize: 12,
  },
  switchTrack: {
    width: 48,
    height: 28,
    borderRadius: 999,
    backgroundColor: '#27272A',
    padding: 3,
    justifyContent: 'center',
  },
  switchTrackOn: {
    backgroundColor: '#FFFFFF',
  },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#71717A',
    alignSelf: 'flex-start',
  },
  switchThumbOn: {
    backgroundColor: '#000000',
    alignSelf: 'flex-end',
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
  footerLinkRow: {
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerMuted: {
    color: '#71717A',
    fontSize: 13,
  },
  footerAccent: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
