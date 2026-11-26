import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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
      ? 'Updating Kallie...'
      : state.kind === 'ota_ready'
        ? 'Update downloaded'
        : `Update available (${state.version})`;

  const subtitle =
    state.kind === 'ota_downloading'
      ? 'Downloading the latest update automatically.'
      : state.kind === 'ota_ready'
        ? 'Tap restart to apply the latest version.'
        : 'A newer Android build is available on GitHub.';

  const actionLabel = state.kind === 'ota_ready' ? 'Restart' : 'Download';

  return (
    <View style={styles.wrapper}>
      <View style={styles.banner}>
        <View style={styles.textBlock}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        {isDownloading ? (
          <ActivityIndicator color="#1FD5F9" size="small" />
        ) : (
          <View style={styles.actions}>
            <Pressable style={styles.dismissBtn} onPress={onDismiss}>
              <Text style={styles.dismissText}>Later</Text>
            </Pressable>
            <Pressable style={styles.applyBtn} onPress={onApply}>
              <Text style={styles.applyText}>{actionLabel}</Text>
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
    left: 16,
    right: 16,
    zIndex: 60,
    alignItems: 'center',
  },
  banner: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  textBlock: {
    flex: 1,
  },
  title: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '700',
  },
  subtitle: {
    color: '#A1A1AA',
    fontSize: 12,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dismissBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  dismissText: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '600',
  },
  applyBtn: {
    backgroundColor: '#1FD5F9',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  applyText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '700',
  },
});
