import React from 'react';
import { StyleSheet, View } from 'react-native';

interface IconProps {
  color: string;
}

/**
 * Lightweight zero-dependency geometric icons for the onboarding flow
 * (keeps APK free of multi-megabyte icon font packs).
 */
export function BackArrowIcon({ color }: IconProps) {
  return (
    <View style={styles.arrowBox}>
      <View style={[styles.arrowHead, { borderColor: color }]} />
      <View style={[styles.arrowShaft, { backgroundColor: color }]} />
    </View>
  );
}

export function WaveformBadgeIcon({ color }: IconProps) {
  const heights = [8, 16, 12, 20, 10];
  return (
    <View style={styles.waveRow}>
      {heights.map((h, i) => (
        <View key={i} style={[styles.waveBar, { height: h, backgroundColor: color }]} />
      ))}
    </View>
  );
}

export type TopicIconKind =
  | 'wakeups'
  | 'reminders'
  | 'checkins'
  | 'focus'
  | 'study'
  | 'chat'
  | 'workout'
  | 'goals'
  | 'habits';

export function TopicGlyph({ kind, color }: { kind: TopicIconKind; color: string }) {
  switch (kind) {
    case 'wakeups':
      return (
        <View style={styles.glyphBox}>
          <View style={[styles.sunCore, { borderColor: color }]} />
          <View style={[styles.sunRayTop, { backgroundColor: color }]} />
          <View style={[styles.sunRayLeft, { backgroundColor: color }]} />
          <View style={[styles.sunRayRight, { backgroundColor: color }]} />
        </View>
      );
    case 'reminders':
      return (
        <View style={styles.glyphBox}>
          <View style={[styles.bellBody, { borderColor: color }]} />
          <View style={[styles.bellBase, { backgroundColor: color }]} />
          <View style={[styles.bellDot, { backgroundColor: color }]} />
        </View>
      );
    case 'checkins':
      return (
        <View style={styles.glyphBox}>
          <View style={[styles.circleRing, { borderColor: color }]} />
          <View style={[styles.clockHandV, { backgroundColor: color }]} />
          <View style={[styles.clockHandH, { backgroundColor: color }]} />
        </View>
      );
    case 'focus':
      return (
        <View style={styles.glyphBox}>
          <View style={[styles.circleRing, { borderColor: color }]} />
          <View style={[styles.targetDot, { backgroundColor: color }]} />
        </View>
      );
    case 'study':
      return (
        <View style={styles.glyphBox}>
          <View style={[styles.bookLeft, { borderColor: color }]} />
          <View style={[styles.bookRight, { borderColor: color }]} />
        </View>
      );
    case 'chat':
      return (
        <View style={styles.glyphBox}>
          <View style={[styles.bubbleRect, { borderColor: color }]}>
            <View style={[styles.bubbleLine, { backgroundColor: color }]} />
            <View style={[styles.bubbleLineShort, { backgroundColor: color }]} />
          </View>
        </View>
      );
    case 'workout':
      return (
        <View style={styles.glyphBox}>
          <View style={[styles.barbellBar, { backgroundColor: color }]} />
          <View style={[styles.barbellLeft, { backgroundColor: color }]} />
          <View style={[styles.barbellRight, { backgroundColor: color }]} />
        </View>
      );
    case 'goals':
      return (
        <View style={styles.glyphBox}>
          <View style={[styles.flagPole, { backgroundColor: color }]} />
          <View style={[styles.flagBody, { borderColor: color }]} />
        </View>
      );
    case 'habits':
      return (
        <View style={styles.glyphBox}>
          <View style={[styles.checkBox, { borderColor: color }]}>
            <View style={[styles.checkMark, { borderColor: color }]} />
          </View>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  arrowBox: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowHead: {
    width: 9,
    height: 9,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    transform: [{ rotate: '45deg' }],
    position: 'absolute',
    left: 5,
  },
  arrowShaft: {
    width: 14,
    height: 2,
    borderRadius: 1,
    position: 'absolute',
    left: 6,
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2.5,
  },
  waveBar: {
    width: 2.5,
    borderRadius: 2,
  },
  glyphBox: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sunCore: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.8,
  },
  sunRayTop: {
    width: 2,
    height: 4,
    borderRadius: 1,
    position: 'absolute',
    top: 1,
  },
  sunRayLeft: {
    width: 4,
    height: 2,
    borderRadius: 1,
    position: 'absolute',
    left: 1,
  },
  sunRayRight: {
    width: 4,
    height: 2,
    borderRadius: 1,
    position: 'absolute',
    right: 1,
  },
  bellBody: {
    width: 14,
    height: 13,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    borderWidth: 1.8,
    borderBottomWidth: 0,
    position: 'absolute',
    top: 4,
  },
  bellBase: {
    width: 18,
    height: 2,
    borderRadius: 1,
    position: 'absolute',
    bottom: 7,
  },
  bellDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    position: 'absolute',
    bottom: 2,
  },
  circleRing: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.8,
  },
  clockHandV: {
    width: 1.8,
    height: 5,
    position: 'absolute',
    top: 8,
  },
  clockHandH: {
    width: 4.5,
    height: 1.8,
    position: 'absolute',
    right: 9,
    top: 12.2,
  },
  targetDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    position: 'absolute',
  },
  bookLeft: {
    width: 9,
    height: 14,
    borderWidth: 1.8,
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2,
    position: 'absolute',
    left: 4,
  },
  bookRight: {
    width: 9,
    height: 14,
    borderWidth: 1.8,
    borderLeftWidth: 0,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    position: 'absolute',
    right: 4,
  },
  bubbleRect: {
    width: 18,
    height: 14,
    borderWidth: 1.8,
    borderRadius: 4,
    justifyContent: 'center',
    paddingHorizontal: 3,
    gap: 2.5,
  },
  bubbleLine: {
    width: 9,
    height: 1.6,
    borderRadius: 1,
  },
  bubbleLineShort: {
    width: 6,
    height: 1.6,
    borderRadius: 1,
  },
  barbellBar: {
    width: 18,
    height: 2,
    borderRadius: 1,
  },
  barbellLeft: {
    width: 3.5,
    height: 12,
    borderRadius: 1.5,
    position: 'absolute',
    left: 4,
  },
  barbellRight: {
    width: 3.5,
    height: 12,
    borderRadius: 1.5,
    position: 'absolute',
    right: 4,
  },
  flagPole: {
    width: 2,
    height: 18,
    borderRadius: 1,
    position: 'absolute',
    left: 6,
  },
  flagBody: {
    width: 11,
    height: 8,
    borderWidth: 1.8,
    borderLeftWidth: 0,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    position: 'absolute',
    left: 7.5,
    top: 5,
  },
  checkBox: {
    width: 18,
    height: 18,
    borderWidth: 1.8,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    width: 8,
    height: 4.5,
    borderLeftWidth: 1.8,
    borderBottomWidth: 1.8,
    transform: [{ rotate: '-45deg' }],
    marginBottom: 1.5,
  },
});
