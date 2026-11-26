import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PermissionStates } from '../hooks/useOnboardingPermissions';
import {
  BackArrowIcon,
  TopicGlyph,
  TopicIconKind,
  WaveformBadgeIcon,
} from './OnboardingIcons';

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

  if (step === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.welcomeBody}>
          <View style={styles.avatarWrap}>
            <Image
              source={require('../../../../assets/kallie-welcome.jpg')}
              style={styles.avatar}
              resizeMode="cover"
            />
            <View style={styles.waveBadge}>
              <WaveformBadgeIcon color="#000000" />
            </View>
          </View>

          <Text style={styles.welcomeTitle}>{'The AI that\ncalls you back'}</Text>
          <Text style={styles.welcomeSubtitle}>Voice companion on your schedule</Text>
        </View>

        <View style={styles.footer}>
          <StepDots current={0} />

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && styles.primaryBtnPressed,
            ]}
            onPress={() => setStep(1)}
          >
            <Text style={styles.primaryBtnText}>Get started</Text>
          </Pressable>

          <Pressable
            style={styles.loginRow}
            onPress={() => onComplete('login')}
            hitSlop={10}
          >
            <Text style={styles.loginMuted}>Already have an account? </Text>
            <Text style={styles.loginLink}>Log in</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.backBtn}>
          <BackArrowIcon color="#FFFFFF" />
        </Pressable>
        <StepDots current={step} />
        <View style={styles.backBtn} />
      </View>

      {step === 1 ? (
        <>
          <ScrollView
            contentContainerStyle={styles.stepContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.stepTitle}>Where did you{'\n'}discover Kallie?</Text>

            <View style={styles.optionStack}>
              {DISCOVERY_OPTIONS.map((option) => {
                const selected = discoverySource === option;
                return (
                  <Pressable
                    key={option}
                    style={({ pressed }) => [
                      styles.optionCard,
                      selected && styles.optionCardSelected,
                      pressed && !selected && styles.optionCardPressed,
                    ]}
                    onPress={() => onSelectDiscovery(option)}
                  >
                    <Text
                      style={[
                        styles.optionCardText,
                        selected && styles.optionCardTextSelected,
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.primaryBtnPressed,
              ]}
              onPress={() => setStep(2)}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <ScrollView
            contentContainerStyle={styles.stepContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.stepTitle}>How will you{'\n'}use Kallie?</Text>
            <Text style={styles.stepSubtitle}>Pick a few to tailor your calls</Text>

            <View style={styles.grid}>
              {TOPIC_OPTIONS.map((topic) => {
                const selected = interests.includes(topic.id);
                return (
                  <Pressable
                    key={topic.id}
                    style={({ pressed }) => [
                      styles.gridTile,
                      selected && styles.gridTileSelected,
                      pressed && !selected && styles.optionCardPressed,
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

          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.primaryBtnPressed,
              ]}
              onPress={() => setStep(3)}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <View style={styles.stepContentCentered}>
            <Text style={styles.stepTitle}>Allow permissions</Text>
            <Text style={styles.stepSubtitle}>So Kallie can call and hear you</Text>

            <View style={styles.optionStack}>
              <Pressable
                style={({ pressed }) => [
                  styles.permRow,
                  permissions.notifications && styles.permRowEnabled,
                  pressed && styles.optionCardPressed,
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
                  styles.permRow,
                  permissions.microphone && styles.permRowEnabled,
                  pressed && styles.optionCardPressed,
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

          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.primaryBtnPressed,
              ]}
              onPress={() => onComplete('signup')}
            >
              <Text style={styles.primaryBtnText}>
                {permissions.notifications && permissions.microphone
                  ? 'Continue'
                  : 'Skip for now'}
              </Text>
            </Pressable>
          </View>
        </>
      ) : null}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  welcomeBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  avatarWrap: {
    width: 184,
    height: 184,
    marginBottom: 34,
    position: 'relative',
  },
  avatar: {
    width: 184,
    height: 184,
    borderRadius: 92,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  waveBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#000000',
  },
  welcomeTitle: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.7,
    lineHeight: 38,
    textAlign: 'center',
  },
  welcomeSubtitle: {
    color: '#71717A',
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center',
  },
  stepContent: {
    flexGrow: 1,
    paddingTop: 16,
    paddingBottom: 20,
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
  },
  stepContentCentered: {
    flex: 1,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
  },
  stepTitle: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 32,
    textAlign: 'center',
    marginBottom: 10,
  },
  stepSubtitle: {
    color: '#71717A',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 28,
  },
  optionStack: {
    gap: 12,
    marginTop: 18,
  },
  optionCard: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  optionCardSelected: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  optionCardPressed: {
    backgroundColor: '#18181B',
  },
  optionCardText: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '500',
  },
  optionCardTextSelected: {
    color: '#000000',
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  gridTile: {
    width: '31.2%',
    aspectRatio: 1,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 18,
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
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  permRowEnabled: {
    borderColor: 'rgba(255, 255, 255, 0.35)',
    backgroundColor: '#151515',
  },
  permText: {
    flex: 1,
    gap: 3,
  },
  permTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  permSub: {
    color: '#71717A',
    fontSize: 13,
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
  footer: {
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    gap: 16,
    paddingTop: 8,
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
  loginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginMuted: {
    color: '#71717A',
    fontSize: 13,
  },
  loginLink: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
