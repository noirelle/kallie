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

interface PermissionToggleRowProps {
  title: string;
  subtitle: string;
  enabled: boolean;
  busy: boolean;
  onPress: () => void;
}

function PermissionToggleRow({
  title,
  subtitle,
  enabled,
  busy,
  onPress,
}: PermissionToggleRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        enabled && styles.rowEnabled,
        pressed && styles.rowPressed,
      ]}
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
        <Image
          source={require('../../../../assets/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        <Text style={styles.heading}>Allow permissions</Text>
        <Text style={styles.subtitle}>So Kallie can call and hear you.</Text>

        <View style={styles.list}>
          <PermissionToggleRow
            title="Notifications"
            subtitle="Incoming calls and reminders"
            enabled={permissions.notifications}
            busy={busyKey === 'notifications'}
            onPress={onToggleNotifications}
          />

          <PermissionToggleRow
            title="Microphone"
            subtitle="Live voice calls"
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
    paddingTop: 32,
    paddingBottom: 24,
  },
  main: {
    flex: 1,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignSelf: 'center',
    marginBottom: 22,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  subtitle: {
    color: '#71717A',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 28,
  },
  list: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  rowEnabled: {
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: '#151515',
  },
  rowPressed: {
    backgroundColor: '#1A1A1A',
  },
  rowText: {
    flex: 1,
    gap: 2,
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
  },
  continueBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnPressed: {
    backgroundColor: '#E4E4E7',
  },
  continueBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
  },
});
