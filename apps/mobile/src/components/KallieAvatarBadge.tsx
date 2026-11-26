import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

interface KallieAvatarBadgeProps {
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: { avatar: 88, badge: 30, barScale: 0.62, offset: 2 },
  md: { avatar: 112, badge: 36, barScale: 0.75, offset: 2 },
  lg: { avatar: 184, badge: 48, barScale: 1, offset: 4 },
} as const;

const BAR_HEIGHTS = [8, 16, 12, 20, 10];

export function KallieAvatarBadge({ size = 'lg' }: KallieAvatarBadgeProps) {
  const cfg = SIZES[size];
  const barWidth = Math.max(1.8, 2.5 * cfg.barScale);
  const barGap = Math.max(1.8, 2.5 * cfg.barScale);

  return (
    <View style={{ width: cfg.avatar, height: cfg.avatar, position: 'relative' }}>
      <Image
        source={require('../../assets/kallie-welcome.jpg')}
        style={[
          styles.avatar,
          {
            width: cfg.avatar,
            height: cfg.avatar,
            borderRadius: cfg.avatar / 2,
          },
        ]}
        resizeMode="cover"
      />
      <View
        style={[
          styles.waveBadge,
          {
            width: cfg.badge,
            height: cfg.badge,
            borderRadius: cfg.badge / 2,
            right: cfg.offset,
            bottom: cfg.offset,
          },
        ]}
      >
        <View style={[styles.waveRow, { gap: barGap }]}>
          {BAR_HEIGHTS.map((h, i) => (
            <View
              key={i}
              style={[
                styles.waveBar,
                {
                  width: barWidth,
                  height: Math.round(h * cfg.barScale),
                },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  waveBadge: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#000000',
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  waveBar: {
    backgroundColor: '#000000',
    borderRadius: 2,
  },
});
