import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackArrowIcon } from '../../onboarding/components/OnboardingIcons';
import { usePermissions } from '../hooks/usePermissions';
import {
  PermissionDescriptor,
  PermissionId,
  PermissionMeta,
  PermissionStatus,
} from '../lib/permissionManager';

export type PermissionRedirectReason =
  | 'call_microphone'
  | 'incoming_call'
  | 'revoked'
  | 'settings';

interface PermissionManagerScreenProps {
  reason?: PermissionRedirectReason;
  onClose: () => void;
}

function getReasonBanner(
  reason: PermissionRedirectReason | undefined,
  allRequiredGranted: boolean,
  hasRevoked: boolean,
): { title: string; body: string } | null {
  if (allRequiredGranted && reason && reason !== 'settings') {
    return {
      title: 'All required permissions are enabled',
      body: 'You are ready to talk with Kallie.',
    };
  }
  if (reason === 'call_microphone' || reason === 'incoming_call') {
    return {
      title: 'Microphone access required',
      body: 'Enable Microphone below so Kallie can hear you and keep calls running smoothly.',
    };
  }
  if (reason === 'revoked' || hasRevoked) {
    return {
      title: 'A permission was turned off',
      body: 'Some access was revoked in device settings. Re-enable it below to restore full functionality.',
    };
  }
  return null;
}

function getStatusBadge(
  status: PermissionStatus,
  meta: PermissionMeta,
  required: boolean,
): { label: string; tone: 'ok' | 'warn' | 'muted' } {
  if (status === 'granted') {
    return { label: 'Allowed', tone: 'ok' };
  }
  if (meta.revoked) {
    return { label: 'Revoked', tone: 'warn' };
  }
  if (status === 'blocked' || meta.blocked) {
    return { label: 'Open Settings', tone: 'warn' };
  }
  if (required) {
    return { label: 'Required', tone: 'warn' };
  }
  return { label: 'Off', tone: 'muted' };
}

interface PermissionRowProps {
  descriptor: PermissionDescriptor;
  status: PermissionStatus;
  meta: PermissionMeta;
  busy: boolean;
  onPress: (id: PermissionId) => void;
}

function PermissionRow({
  descriptor,
  status,
  meta,
  busy,
  onPress,
}: PermissionRowProps) {
  const granted = status === 'granted';
  const badge = getStatusBadge(status, meta, descriptor.required);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        granted && styles.cardGranted,
        !granted && descriptor.required && styles.cardNeedsAction,
        pressed && styles.cardPressed,
      ]}
      onPress={() => onPress(descriptor.id)}
      disabled={busy}
      accessibilityRole="switch"
      accessibilityState={{ checked: granted, disabled: busy }}
      accessibilityLabel={`${descriptor.title} permission`}
    >
      <View style={styles.cardBody}>
        <View style={styles.titleRow}>
          <Text style={styles.cardTitle}>{descriptor.title}</Text>
          <View
            style={[
              styles.badge,
              badge.tone === 'ok' && styles.badgeOk,
              badge.tone === 'warn' && styles.badgeWarn,
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                badge.tone === 'ok' && styles.badgeTextOk,
                badge.tone === 'warn' && styles.badgeTextWarn,
              ]}
            >
              {badge.label}
            </Text>
          </View>
        </View>
        <Text style={styles.cardDesc}>{descriptor.description}</Text>
        {!granted && (meta.blocked || meta.revoked) ? (
          <Text style={styles.cardHint}>
            Tap to open Android Settings and allow access.
          </Text>
        ) : null}
      </View>

      <View style={[styles.switchTrack, granted && styles.switchTrackOn]}>
        <View style={[styles.switchThumb, granted && styles.switchThumbOn]} />
      </View>
    </Pressable>
  );
}

export function PermissionManagerScreen({
  reason,
  onClose,
}: PermissionManagerScreenProps) {
  const {
    statuses,
    meta,
    busyKey,
    requiredDescriptors,
    optionalDescriptors,
    allRequiredGranted,
    revokedPermissions,
    togglePermission,
    openSettings,
  } = usePermissions({ syncOnResume: true });

  const banner = useMemo(
    () =>
      getReasonBanner(
        reason,
        allRequiredGranted,
        revokedPermissions.length > 0,
      ),
    [allRequiredGranted, reason, revokedPermissions.length],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={({ pressed }) => [
            styles.backCircle,
            pressed && styles.surfacePressed,
          ]}
          accessibilityLabel="Go back"
        >
          <BackArrowIcon color="#FFFFFF" />
        </Pressable>
        <Text style={styles.topTitle}>Permissions</Text>
        <View style={styles.topSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerBlock}>
          <Text style={styles.displayTitle}>App access</Text>
          <Text style={styles.subtitle}>
            Manage the permissions Kallie needs for voice calls and reminders.
          </Text>
        </View>

        {banner ? (
          <View
            style={[
              styles.banner,
              allRequiredGranted ? styles.bannerOk : styles.bannerWarn,
            ]}
          >
            <Text style={styles.bannerTitle}>{banner.title}</Text>
            <Text style={styles.bannerBody}>{banner.body}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>REQUIRED FOR VOICE CALLS</Text>
          <View style={styles.cardList}>
            {requiredDescriptors.map((descriptor) => (
              <PermissionRow
                key={descriptor.id}
                descriptor={descriptor}
                status={statuses[descriptor.id]}
                meta={meta[descriptor.id]}
                busy={busyKey === descriptor.id}
                onPress={(id) => void togglePermission(id)}
              />
            ))}
          </View>
        </View>

        {optionalDescriptors.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>OPTIONAL FEATURES</Text>
            <View style={styles.cardList}>
              {optionalDescriptors.map((descriptor) => (
                <PermissionRow
                  key={descriptor.id}
                  descriptor={descriptor}
                  status={statuses[descriptor.id]}
                  meta={meta[descriptor.id]}
                  busy={busyKey === descriptor.id}
                  onPress={(id) => void togglePermission(id)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            pressed && styles.primaryBtnPressed,
          ]}
          onPress={onClose}
        >
          <Text style={styles.primaryBtnText}>
            {allRequiredGranted ? 'Continue to Kallie' : 'Back to Home'}
          </Text>
        </Pressable>

        <Pressable
          style={styles.secondaryLink}
          onPress={() => void openSettings()}
          hitSlop={10}
        >
          <Text style={styles.secondaryLinkText}>Open system app settings</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    paddingHorizontal: 22,
    paddingBottom: 20,
  },
  topBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
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
  topTitle: {
    color: '#A1A1AA',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  topSpacer: {
    width: 40,
    height: 40,
  },
  surfacePressed: {
    backgroundColor: '#18181B',
  },
  scrollContent: {
    paddingTop: 14,
    paddingBottom: 24,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    gap: 22,
  },
  headerBlock: {
    gap: 8,
  },
  displayTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  subtitle: {
    color: '#71717A',
    fontSize: 14,
    lineHeight: 20,
  },
  banner: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    gap: 4,
  },
  bannerWarn: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: 'rgba(245, 158, 11, 0.32)',
  },
  bannerOk: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.32)',
  },
  bannerTitle: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '600',
  },
  bannerBody: {
    color: '#A1A1AA',
    fontSize: 13,
    lineHeight: 18,
  },
  section: {
    gap: 10,
  },
  sectionLabel: {
    color: '#71717A',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    paddingHorizontal: 4,
  },
  cardList: {
    gap: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  cardGranted: {
    borderColor: 'rgba(255, 255, 255, 0.24)',
    backgroundColor: '#141416',
  },
  cardNeedsAction: {
    borderColor: 'rgba(245, 158, 11, 0.34)',
  },
  cardPressed: {
    backgroundColor: '#18181B',
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  cardDesc: {
    color: '#A1A1AA',
    fontSize: 12.5,
    lineHeight: 18,
  },
  cardHint: {
    color: '#FBBF24',
    fontSize: 11.5,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
  },
  badgeOk: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
  },
  badgeWarn: {
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
  },
  badgeText: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '600',
  },
  badgeTextOk: {
    color: '#34D399',
  },
  badgeTextWarn: {
    color: '#FBBF24',
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
    maxWidth: 420,
    alignSelf: 'center',
    gap: 14,
    paddingTop: 12,
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
  secondaryLink: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  secondaryLinkText: {
    color: '#71717A',
    fontSize: 13,
    fontWeight: '500',
  },
});
