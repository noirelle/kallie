import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  FadeSlideView,
  MonoDivider,
  MonoHeader,
  MonoPressable,
  MonoSectionCard,
  MonoStatusDot,
  MonoSwitch,
} from '../../../components/MonoUi';
import { MONO, RADIUS, TYPE } from '../../../theme/monoTheme';
import { usePermissions } from '../hooks/usePermissions';

export type PermissionRedirectReason =
  | 'call_microphone'
  | 'incoming_call'
  | 'revoked'
  | 'settings';

interface PermissionManagerScreenProps {
  reason?: PermissionRedirectReason;
  onClose: () => void;
}

export function PermissionManagerScreen({ onClose }: PermissionManagerScreenProps) {
  const {
    statuses,
    busyKey,
    requiredDescriptors,
    optionalDescriptors,
    allRequiredGranted,
    togglePermission,
    openSettings,
  } = usePermissions({ syncOnResume: true });

  const allItems = [...requiredDescriptors, ...optionalDescriptors];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <MonoHeader title="Access" onBack={onClose} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <FadeSlideView>
          <MonoSectionCard eyebrow="Permissions">
            {allItems.map((descriptor, idx) => {
              const granted = statuses[descriptor.id] === 'granted';
              const busy = busyKey === descriptor.id;
              return (
                <React.Fragment key={descriptor.id}>
                  {idx > 0 ? <MonoDivider inset={16} /> : null}
                  <View style={styles.row}>
                    <View style={styles.rowLeft}>
                      <MonoStatusDot active={granted} />
                      <Text style={styles.rowTitle}>{descriptor.title}</Text>
                    </View>
                    <MonoSwitch
                      value={granted}
                      disabled={busy}
                      onValueChange={() => void togglePermission(descriptor.id)}
                    />
                  </View>
                </React.Fragment>
              );
            })}
          </MonoSectionCard>
        </FadeSlideView>
      </ScrollView>

      <View style={styles.footer}>
        <MonoPressable style={styles.primaryBtn} onPress={onClose}>
          <Text style={styles.primaryBtnText}>
            {allRequiredGranted ? 'Done' : 'Back'}
          </Text>
        </MonoPressable>

        <Pressable
          style={styles.secondaryLink}
          onPress={() => void openSettings()}
          hitSlop={10}
        >
          <Text style={styles.secondaryLinkText}>System Settings</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MONO.bg,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 58,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowTitle: {
    ...TYPE.bodyMedium,
    color: MONO.textPrimary,
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: MONO.white,
    borderRadius: RADIUS.pill,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    ...TYPE.button,
    color: MONO.black,
  },
  secondaryLink: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  secondaryLinkText: {
    ...TYPE.label,
    color: MONO.textMuted,
  },
});
