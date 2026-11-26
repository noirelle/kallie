import React from 'react';
import { StyleSheet, View } from 'react-native';

interface IconProps {
  color: string;
  size?: number;
}

/**
 * Lightweight pure React Native icons used in ActiveCallView.
 * Replaces @expo/vector-icons to avoid bundling ~3.7 MB of unused icon font families.
 */
export function MicIcon({ color, muted = false }: IconProps & { muted?: boolean }) {
  return (
    <View style={styles.box}>
      <View style={[styles.micCapsule, { borderColor: color, backgroundColor: color }]} />
      <View style={[styles.micCup, { borderColor: color }]} />
      <View style={[styles.micStem, { backgroundColor: color }]} />
      <View style={[styles.micBase, { backgroundColor: color }]} />
      {muted ? <View style={[styles.slash, { backgroundColor: color }]} /> : null}
    </View>
  );
}

export function SpeakerIcon({ color, active = true }: IconProps & { active?: boolean }) {
  return (
    <View style={styles.box}>
      <View style={[styles.speakerBody, { backgroundColor: color }]} />
      <View style={[styles.speakerCone, { borderRightColor: color }]} />
      {active ? (
        <>
          <View style={[styles.waveInner, { borderColor: color }]} />
          <View style={[styles.waveOuter, { borderColor: color }]} />
        </>
      ) : (
        <View style={[styles.waveInner, { borderColor: color, opacity: 0.45 }]} />
      )}
    </View>
  );
}

export function HangupIcon({ color }: IconProps) {
  return (
    <View style={styles.hangupBox}>
      <View style={[styles.hangupBar, { backgroundColor: color }]} />
      <View style={[styles.hangupLeftEar, { backgroundColor: color }]} />
      <View style={[styles.hangupRightEar, { backgroundColor: color }]} />
    </View>
  );
}

export function ChatIcon({ color }: IconProps) {
  return (
    <View style={styles.box}>
      <View style={[styles.chatBubble, { borderColor: color }]}>
        <View style={[styles.chatLineLong, { backgroundColor: color }]} />
        <View style={[styles.chatLineShort, { backgroundColor: color }]} />
      </View>
      <View style={[styles.chatTail, { borderTopColor: color }]} />
    </View>
  );
}

export function SendIcon({ color }: IconProps) {
  return (
    <View style={styles.box}>
      <View style={[styles.sendArrow, { borderLeftColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micCapsule: {
    width: 7,
    height: 11,
    borderRadius: 4,
    borderWidth: 1.5,
    position: 'absolute',
    top: 2,
  },
  micCup: {
    width: 13,
    height: 8,
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
    borderLeftWidth: 1.8,
    borderRightWidth: 1.8,
    borderBottomWidth: 1.8,
    position: 'absolute',
    top: 8,
  },
  micStem: {
    width: 1.8,
    height: 3.5,
    position: 'absolute',
    top: 15.5,
  },
  micBase: {
    width: 8,
    height: 1.8,
    borderRadius: 1,
    position: 'absolute',
    top: 18.5,
  },
  slash: {
    width: 20,
    height: 2,
    borderRadius: 1,
    position: 'absolute',
    transform: [{ rotate: '-45deg' }],
  },
  speakerBody: {
    width: 5,
    height: 7,
    borderRadius: 1,
    position: 'absolute',
    left: 2,
  },
  speakerCone: {
    width: 0,
    height: 0,
    borderTopWidth: 6.5,
    borderBottomWidth: 6.5,
    borderRightWidth: 7,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    position: 'absolute',
    left: 5,
  },
  waveInner: {
    width: 6,
    height: 9,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
    borderTopWidth: 1.6,
    borderRightWidth: 1.6,
    borderBottomWidth: 1.6,
    position: 'absolute',
    right: 4,
  },
  waveOuter: {
    width: 8,
    height: 14,
    borderTopRightRadius: 9,
    borderBottomRightRadius: 9,
    borderTopWidth: 1.6,
    borderRightWidth: 1.6,
    borderBottomWidth: 1.6,
    position: 'absolute',
    right: 1,
  },
  hangupBox: {
    width: 20,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hangupBar: {
    width: 18,
    height: 4,
    borderRadius: 2,
    position: 'absolute',
    top: 2,
  },
  hangupLeftEar: {
    width: 5,
    height: 5,
    borderRadius: 1.5,
    position: 'absolute',
    left: 1,
    bottom: 1,
  },
  hangupRightEar: {
    width: 5,
    height: 5,
    borderRadius: 1.5,
    position: 'absolute',
    right: 1,
    bottom: 1,
  },
  chatBubble: {
    width: 17,
    height: 13,
    borderWidth: 1.7,
    borderRadius: 2,
    paddingHorizontal: 3,
    justifyContent: 'center',
    gap: 2.5,
    marginBottom: 2,
  },
  chatLineLong: {
    width: 9,
    height: 1.5,
  },
  chatLineShort: {
    width: 6,
    height: 1.5,
  },
  chatTail: {
    width: 0,
    height: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderRightColor: 'transparent',
    position: 'absolute',
    bottom: 1,
    left: 4,
  },
  sendArrow: {
    width: 0,
    height: 0,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 10,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    marginLeft: 2,
  },
});
