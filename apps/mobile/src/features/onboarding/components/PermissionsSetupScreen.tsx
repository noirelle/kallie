import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PermissionStates } from '../hooks/useOnboardingPermissions';

interface PermissionsSetupScreenProps {
  permissions: PermissionStates;
  busyKey: 'notifications' | 'microphone' | null;
  onToggleNotifications: () => void;
  onToggleMicrophone: () => void;
  onContinue: () => void;
}

interface PermissionRowProps {
  title: string;
  subtitle: string;
  enabled: boolean;
  busy: boolean;
  onPress: () => void;
}

function PermissionRow({ title, subtitle, enabled, busy, onPress }: PermissionRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      disabled={busy}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>

      <View style={[styles.switchTrack, enabled && styles.switchTrackOn]}>
        <View style={[styles.switchThumb, enabled && styles.switchThumbOn]} />
      </View>
    </Pressable>
  );
}

export function PermissionsSetupScreen({
  permissions,
  busyKey,
  onToggleNotifications,
  onToggleMicrophone,
  onContinue,
}: PermissionsSetupScreenProps) {
  const ready = permissions.notifications && permissions.microphone;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.main}>
        <View style={styles.logoFrame}>
          <Image
            source={require('../../../../assets/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <Text style={styles.heading}>Permissions</Text>
        <Text style={styles.subtitle}>Enable alerts and voice to get started</Text>

        <View style={styles.groupCard}>
          <PermissionRow
            title="Notifications"
            subtitle="Incoming calls and reminders"
            enabled={permissions.notifications}
            busy={busyKey === 'notifications'}
            onPress={onToggleNotifications}
          />
          <View style={styles.separator} />
          <PermissionRow
            title="Microphone"
            subtitle="Live voice conversations"
            enabled={permissions.microphone}
            busy={busyKey === 'microphone'}
            onPress={onToggleMicrophone}
          />
        </View>
      </View>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.continueBtn,
            pressed && styles.continueBtnPressed,
          ]}
          onPress={onContinue}
        >
          <Text style={styles.continueBtnText}>
            {ready ? 'Get started' : 'Continue'}
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
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 20,
  },
  main: {
    flex: 1,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    paddingBottom: 24,
  },
  logoFrame: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#0B0B0B',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 22,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    color: '#71717A',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 28,
  },
  groupCard: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 24,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  rowPressed: {
    backgroundColor: '#141414',
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginHorizontal: 20,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  rowSubtitle: {
    color: '#71717A',
    fontSize: 13,
  },
  switchTrack: {
    width: 50,
    height: 30,
    borderRadius: 999,
    backgroundColor: '#242428',
    padding: 3,
    justifyContent: 'center',
  },
  switchTrackOn: {
    backgroundColor: '#FFFFFF',
  },
  switchThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#A1A1AA',
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
  },
  continueBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnPressed: {
    backgroundColor: '#E4E4E7',
    transform: [{ scale: 0.99 }],
  },
  continueBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
  },
});
