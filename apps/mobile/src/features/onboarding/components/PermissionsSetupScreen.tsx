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
  index: string;
  title: string;
  description: string;
  enabled: boolean;
  busy: boolean;
  onPress: () => void;
}

function PermissionToggleRow({
  index,
  title,
  description,
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
      <View style={styles.rowBody}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowIndex}>{index}</Text>
          <Text style={[styles.rowStatus, enabled && styles.rowStatusEnabled]}>
            {enabled ? 'ALLOWED' : 'OFF'}
          </Text>
        </View>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDescription}>{description}</Text>
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
      <View style={styles.topMark}>
        <Image
          source={require('../../../../assets/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>

      <View style={styles.main}>
        <Text style={styles.eyebrow}>BEFORE YOU START</Text>
        <Text style={styles.heading}>Enable call permissions.</Text>
        <Text style={styles.subtitle}>
          Turn on notifications and microphone so Kallie can ring your device on schedule and hear
          you immediately.
        </Text>

        <View style={styles.list}>
          <PermissionToggleRow
            index="01 / ALERTS"
            title="Notifications"
            description="Required to wake your phone for scheduled callbacks and reminders."
            enabled={permissions.notifications}
            busy={busyKey === 'notifications'}
            onPress={onToggleNotifications}
          />

          <PermissionToggleRow
            index="02 / VOICE"
            title="Microphone"
            description="Required for real-time voice conversations with Kallie."
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
            {ready ? 'START USING KALLIE' : 'CONTINUE'}
          </Text>
        </Pressable>

        {!ready ? (
          <Text style={styles.hint}>
            You can enable these anytime from Android Settings.
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 18,
    paddingBottom: 24,
  },
  topMark: {
    alignItems: 'flex-start',
  },
  logo: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  main: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  eyebrow: {
    color: '#71717A',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.4,
    marginBottom: 10,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.7,
    lineHeight: 38,
  },
  subtitle: {
    color: '#A1A1AA',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 12,
    marginBottom: 28,
  },
  list: {
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    backgroundColor: '#050505',
    padding: 18,
  },
  rowEnabled: {
    borderColor: 'rgba(255, 255, 255, 0.5)',
    backgroundColor: '#0A0A0A',
  },
  rowPressed: {
    backgroundColor: '#111111',
  },
  rowBody: {
    flex: 1,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  rowIndex: {
    color: '#71717A',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.6,
  },
  rowStatus: {
    color: '#52525B',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  rowStatusEnabled: {
    color: '#FFFFFF',
  },
  rowTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  rowDescription: {
    color: '#A1A1AA',
    fontSize: 12,
    lineHeight: 17,
  },
  switchTrack: {
    width: 48,
    height: 26,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    backgroundColor: '#000000',
    padding: 3,
    justifyContent: 'center',
  },
  switchTrackOn: {
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
  },
  switchThumb: {
    width: 18,
    height: 18,
    backgroundColor: '#52525B',
    alignSelf: 'flex-start',
  },
  switchThumbOn: {
    backgroundColor: '#000000',
    alignSelf: 'flex-end',
  },
  footer: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    gap: 12,
  },
  continueBtn: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnPressed: {
    backgroundColor: '#E4E4E7',
  },
  continueBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  hint: {
    color: '#52525B',
    fontSize: 11,
    textAlign: 'center',
  },
});
