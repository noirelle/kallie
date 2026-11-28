import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CloseIcon } from '../../../components/MonoIcons';
import { MONO, RADIUS, TYPE } from '../../../theme/monoTheme';
import { UpdateBannerState } from '../hooks/useAutoUpdate';

interface AppUpdateBannerProps {
  state: UpdateBannerState;
  onApply: () => void;
  onDismiss: () => void;
}

export function AppUpdateBanner({ state, onApply, onDismiss }: AppUpdateBannerProps) {
  if (state.kind === 'idle') {
    return null;
  }

  const isDownloading = state.kind === 'ota_downloading';
  const title =
    state.kind === 'ota_downloading'
      ? 'Updating'
      : state.kind === 'ota_ready'
        ? 'Ready'
        : `Update ${state.version}`;

  const actionLabel = state.kind === 'ota_ready' ? 'Restart' : 'Get';

  return (
    <View style={styles.wrapper}>
      <View style={styles.banner}>
        <Text style={styles.title}>{title}</Text>

        {isDownloading ? (
          <ActivityIndicator color={MONO.white} size="small" />
        ) : (
          <View style={styles.actions}>
            <Pressable style={styles.applyBtn} onPress={onApply}>
              <Text style={styles.applyText}>{actionLabel}</Text>
            </Pressable>
            <Pressable
              style={styles.dismissBtn}
              onPress={onDismiss}
              hitSlop={8}
              accessibilityLabel="Dismiss"
            >
              <CloseIcon color={MONO.textSecondary} size={14} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 52,
    left: 20,
    right: 20,
    zIndex: 60,
    alignItems: 'center',
  },
  banner: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.borderStrong,
    borderRadius: RADIUS.pill,
    paddingLeft: 18,
    paddingRight: 10,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    ...TYPE.label,
    color: MONO.white,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dismissBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyBtn: {
    backgroundColor: MONO.white,
    paddingHorizontal: 14,
    height: 30,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyText: {
    ...TYPE.button,
    fontSize: 12,
    color: MONO.black,
  },
});
