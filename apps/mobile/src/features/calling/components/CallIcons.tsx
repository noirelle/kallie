import React from 'react';
import { StyleSheet, View } from 'react-native';

interface IconProps {
  color: string;
  size?: number;
}

function scaleStyle(size: number, base = 22) {
  return size === base ? undefined : { transform: [{ scale: size / base }] };
}

/**
 * Lightweight pure React Native icons used in ActiveCallView & Settings.
 * Replaces @expo/vector-icons to avoid bundling ~3.7 MB of unused icon font families.
 */
export function MicIcon({
  color,
  size = 20,
  muted = false,
}: IconProps & { muted?: boolean }) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.micCapsule, { borderColor: color, backgroundColor: color }]} />
      <View style={[styles.micCup, { borderColor: color }]} />
      <View style={[styles.micStem, { backgroundColor: color }]} />
      <View style={[styles.micBase, { backgroundColor: color }]} />
      {muted ? <View style={[styles.slash, { backgroundColor: color }]} /> : null}
    </View>
  );
}

export function SpeakerIcon({
  color,
  size = 20,
  active = true,
}: IconProps & { active?: boolean }) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.speakerBody, { backgroundColor: color }]} />
      <View style={[styles.speakerCone, { borderRightColor: color }]} />
      {active ? (
        <>
          <View style={[styles.waveInner, { borderColor: color }]} />
          <View style={[styles.waveOuter, { borderColor: color }]} />
        </>
      ) : (
        <View style={[styles.waveInner, { borderColor: color, opacity: 0.4 }]} />
      )}
    </View>
  );
}

export function HangupIcon({ color, size = 21 }: IconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.phoneArc, { borderColor: color }]} />
      <View style={[styles.phoneEarLeft, { backgroundColor: color }]} />
      <View style={[styles.phoneEarRight, { backgroundColor: color }]} />
      <View style={[styles.phoneSlash, { backgroundColor: color }]} />
    </View>
  );
}

/**
 * Modern Minimalist Message Icon:
 * Continuous asymmetric-corner squircle contour (no detached triangle seam)
 * paired with three optically balanced center dots.
 */
export function ChatIcon({ color, size = 20 }: IconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.messageShell, { borderColor: color }]}>
        <View style={styles.messageDotsRow}>
          <View style={[styles.messageDot, { backgroundColor: color }]} />
          <View style={[styles.messageDot, { backgroundColor: color }]} />
          <View style={[styles.messageDot, { backgroundColor: color }]} />
        </View>
      </View>
    </View>
  );
}

/**
 * Minimalist Upward Arrow Send Icon (modern AI composer standard).
 */
export function SendIcon({ color, size = 20 }: IconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.sendHead, { borderColor: color }]} />
      <View style={[styles.sendShaft, { backgroundColor: color }]} />
    </View>
  );
}

export function CameraIcon({
  color,
  size = 20,
  enabled = false,
}: IconProps & { enabled?: boolean }) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.camBody, { borderColor: color }]} />
      <View style={[styles.camLens, { borderRightColor: color }]} />
      {!enabled ? <View style={[styles.slash, { backgroundColor: color }]} /> : null}
    </View>
  );
}

export function ScreenShareIcon({ color, size = 20 }: IconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.screenFrame, { borderColor: color }]}>
        <View style={[styles.screenArrowHead, { borderColor: color }]} />
        <View style={[styles.screenArrowStem, { backgroundColor: color }]} />
      </View>
      <View style={[styles.screenStand, { backgroundColor: color }]} />
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
    width: 6.5,
    height: 10.5,
    borderRadius: 3.5,
    borderWidth: 1.5,
    position: 'absolute',
    top: 2.5,
  },
  micCup: {
    width: 12.5,
    height: 7.5,
    borderBottomLeftRadius: 6.5,
    borderBottomRightRadius: 6.5,
    borderLeftWidth: 1.65,
    borderRightWidth: 1.65,
    borderBottomWidth: 1.65,
    position: 'absolute',
    top: 8.5,
  },
  micStem: {
    width: 1.65,
    height: 3.2,
    position: 'absolute',
    top: 15.8,
  },
  micBase: {
    width: 7.5,
    height: 1.65,
    borderRadius: 1,
    position: 'absolute',
    top: 18.6,
  },
  slash: {
    width: 19,
    height: 1.75,
    borderRadius: 1,
    position: 'absolute',
    transform: [{ rotate: '-45deg' }],
  },
  speakerBody: {
    width: 4.5,
    height: 6.5,
    borderRadius: 1.2,
    position: 'absolute',
    left: 2.5,
  },
  speakerCone: {
    width: 0,
    height: 0,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderRightWidth: 6.5,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    position: 'absolute',
    left: 5.2,
  },
  waveInner: {
    width: 5.5,
    height: 8.5,
    borderTopRightRadius: 5.5,
    borderBottomRightRadius: 5.5,
    borderTopWidth: 1.6,
    borderRightWidth: 1.6,
    borderBottomWidth: 1.6,
    position: 'absolute',
    right: 4.2,
  },
  waveOuter: {
    width: 7.5,
    height: 13.5,
    borderTopRightRadius: 8.5,
    borderBottomRightRadius: 8.5,
    borderTopWidth: 1.6,
    borderRightWidth: 1.6,
    borderBottomWidth: 1.6,
    position: 'absolute',
    right: 1.2,
  },
  phoneArc: {
    width: 16.5,
    height: 9.5,
    borderTopLeftRadius: 8.5,
    borderTopRightRadius: 8.5,
    borderTopWidth: 1.9,
    borderLeftWidth: 1.9,
    borderRightWidth: 1.9,
    position: 'absolute',
    top: 7.2,
  },
  phoneEarLeft: {
    width: 4.2,
    height: 4.2,
    borderRadius: 1.5,
    position: 'absolute',
    left: 1.8,
    top: 12.6,
  },
  phoneEarRight: {
    width: 4.2,
    height: 4.2,
    borderRadius: 1.5,
    position: 'absolute',
    right: 1.8,
    top: 12.6,
  },
  phoneSlash: {
    width: 20,
    height: 1.75,
    borderRadius: 1,
    position: 'absolute',
    transform: [{ rotate: '-45deg' }],
  },
  messageShell: {
    width: 17.5,
    height: 15.5,
    borderWidth: 1.65,
    borderTopLeftRadius: 6.5,
    borderTopRightRadius: 6.5,
    borderBottomRightRadius: 6.5,
    borderBottomLeftRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2.4,
  },
  messageDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
  },
  sendHead: {
    width: 7.5,
    height: 7.5,
    borderTopWidth: 1.85,
    borderLeftWidth: 1.85,
    borderTopLeftRadius: 1,
    transform: [{ rotate: '45deg' }],
    position: 'absolute',
    top: 5.5,
  },
  sendShaft: {
    width: 1.85,
    height: 11.5,
    borderRadius: 1,
    position: 'absolute',
    top: 5.5,
  },
  camBody: {
    width: 13,
    height: 10.5,
    borderWidth: 1.65,
    borderRadius: 3,
    position: 'absolute',
    left: 2,
  },
  camLens: {
    width: 0,
    height: 0,
    borderTopWidth: 4.2,
    borderBottomWidth: 4.2,
    borderRightWidth: 5.2,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    position: 'absolute',
    right: 2,
  },
  screenFrame: {
    width: 17.5,
    height: 12.5,
    borderWidth: 1.65,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    top: 3.2,
  },
  screenArrowHead: {
    width: 5,
    height: 5,
    borderTopWidth: 1.6,
    borderLeftWidth: 1.6,
    transform: [{ rotate: '45deg' }],
    marginBottom: -3,
  },
  screenArrowStem: {
    width: 1.6,
    height: 6,
    borderRadius: 1,
  },
  screenStand: {
    width: 8,
    height: 1.65,
    borderRadius: 1,
    position: 'absolute',
    bottom: 2.5,
  },
});
