import React from 'react';
import { StyleSheet, View } from 'react-native';

interface MonoIconProps {
  color?: string;
  size?: number;
}

function scaleStyle(size: number) {
  return size === 20 ? undefined : { transform: [{ scale: size / 20 }] };
}

export function ChevronLeftIcon({ color = '#FFFFFF', size = 20 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.chevronLeft, { borderColor: color }]} />
    </View>
  );
}

export function ChevronRightIcon({ color = '#8E8E93', size = 18 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.chevronRight, { borderColor: color }]} />
    </View>
  );
}

export function CloseIcon({ color = '#FFFFFF', size = 18 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.crossA, { backgroundColor: color }]} />
      <View style={[styles.crossB, { backgroundColor: color }]} />
    </View>
  );
}

export function CheckIcon({ color = '#FFFFFF', size = 18 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.checkMark, { borderColor: color }]} />
    </View>
  );
}

export function SparkIcon({ color = '#FFFFFF', size = 20 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.sparkV, { backgroundColor: color }]} />
      <View style={[styles.sparkH, { backgroundColor: color }]} />
      <View style={[styles.sparkCore, { backgroundColor: color }]} />
    </View>
  );
}

export function MonitorIcon({ color = '#FFFFFF', size = 20 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.monitorScreen, { borderColor: color }]} />
      <View style={[styles.monitorNeck, { backgroundColor: color }]} />
      <View style={[styles.monitorBase, { backgroundColor: color }]} />
    </View>
  );
}

export function QrIcon({ color = '#FFFFFF', size = 20 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.qrSquare, styles.qrTL, { borderColor: color }]} />
      <View style={[styles.qrSquare, styles.qrTR, { borderColor: color }]} />
      <View style={[styles.qrSquare, styles.qrBL, { borderColor: color }]} />
      <View style={[styles.qrDotA, { backgroundColor: color }]} />
      <View style={[styles.qrDotB, { backgroundColor: color }]} />
    </View>
  );
}

export function SlidersIcon({ color = '#FFFFFF', size = 20 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.sliderTrackTop, { backgroundColor: color }]} />
      <View style={[styles.sliderKnobTop, { backgroundColor: color }]} />
      <View style={[styles.sliderTrackMid, { backgroundColor: color }]} />
      <View style={[styles.sliderKnobMid, { backgroundColor: color }]} />
      <View style={[styles.sliderTrackBot, { backgroundColor: color }]} />
      <View style={[styles.sliderKnobBot, { backgroundColor: color }]} />
    </View>
  );
}

export function ShieldIcon({ color = '#FFFFFF', size = 20 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.shieldBody, { borderColor: color }]} />
      <View style={[styles.shieldDot, { backgroundColor: color }]} />
    </View>
  );
}

export function BrainIcon({ color = '#FFFFFF', size = 20 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.nodeRing, { borderColor: color }]} />
      <View style={[styles.nodeInner, { backgroundColor: color }]} />
      <View style={[styles.nodeTop, { backgroundColor: color }]} />
      <View style={[styles.nodeBot, { backgroundColor: color }]} />
      <View style={[styles.nodeLeft, { backgroundColor: color }]} />
      <View style={[styles.nodeRight, { backgroundColor: color }]} />
    </View>
  );
}

export function RefreshIcon({ color = '#FFFFFF', size = 18 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.refreshArc, { borderColor: color }]} />
      <View style={[styles.refreshTip, { borderColor: color }]} />
    </View>
  );
}

export function KeyIcon({ color = '#FFFFFF', size = 18 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.keyHead, { borderColor: color }]} />
      <View style={[styles.keyShaft, { backgroundColor: color }]} />
      <View style={[styles.keyTooth, { backgroundColor: color }]} />
    </View>
  );
}

export function FlashIcon({ color = '#FFFFFF', size = 18 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.flashTop, { borderBottomColor: color }]} />
      <View style={[styles.flashBot, { borderTopColor: color }]} />
    </View>
  );
}

export function TrashIcon({ color = '#FFFFFF', size = 18 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.trashLid, { backgroundColor: color }]} />
      <View style={[styles.trashCan, { borderColor: color }]} />
    </View>
  );
}

export function PinIcon({ color = '#FFFFFF', size = 16, filled = false }: MonoIconProps & { filled?: boolean }) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View
        style={[
          styles.pinHead,
          { borderColor: color, backgroundColor: filled ? color : 'transparent' },
        ]}
      />
      <View style={[styles.pinStem, { backgroundColor: color }]} />
    </View>
  );
}

export function LinkIcon({ color = '#FFFFFF', size = 18 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.linkLoopA, { borderColor: color }]} />
      <View style={[styles.linkLoopB, { borderColor: color }]} />
    </View>
  );
}

export function SearchIcon({ color = '#9898A0', size = 17 }: MonoIconProps) {
  return (
    <View style={[styles.box, scaleStyle(size)]}>
      <View style={[styles.searchLens, { borderColor: color }]} />
      <View style={[styles.searchHandle, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronLeft: {
    width: 8,
    height: 8,
    borderLeftWidth: 1.8,
    borderBottomWidth: 1.8,
    transform: [{ rotate: '45deg' }],
    marginLeft: 3,
  },
  chevronRight: {
    width: 7,
    height: 7,
    borderRightWidth: 1.8,
    borderTopWidth: 1.8,
    transform: [{ rotate: '45deg' }],
    marginRight: 2,
  },
  crossA: {
    position: 'absolute',
    width: 14,
    height: 1.7,
    borderRadius: 1,
    transform: [{ rotate: '45deg' }],
  },
  crossB: {
    position: 'absolute',
    width: 14,
    height: 1.7,
    borderRadius: 1,
    transform: [{ rotate: '-45deg' }],
  },
  checkMark: {
    width: 10,
    height: 5.5,
    borderLeftWidth: 1.9,
    borderBottomWidth: 1.9,
    transform: [{ rotate: '-45deg' }],
    marginBottom: 2,
  },
  sparkV: {
    position: 'absolute',
    width: 1.8,
    height: 14,
    borderRadius: 1,
  },
  sparkH: {
    position: 'absolute',
    width: 14,
    height: 1.8,
    borderRadius: 1,
  },
  sparkCore: {
    width: 5,
    height: 5,
    transform: [{ rotate: '45deg' }],
  },
  monitorScreen: {
    width: 16,
    height: 11,
    borderWidth: 1.6,
    borderRadius: 2.5,
    position: 'absolute',
    top: 2.5,
  },
  monitorNeck: {
    width: 2,
    height: 3,
    position: 'absolute',
    top: 13.5,
  },
  monitorBase: {
    width: 9,
    height: 1.7,
    borderRadius: 1,
    position: 'absolute',
    bottom: 2,
  },
  qrSquare: {
    position: 'absolute',
    width: 6.5,
    height: 6.5,
    borderWidth: 1.6,
    borderRadius: 1.5,
  },
  qrTL: { top: 2, left: 2 },
  qrTR: { top: 2, right: 2 },
  qrBL: { bottom: 2, left: 2 },
  qrDotA: {
    position: 'absolute',
    width: 2.5,
    height: 2.5,
    bottom: 5.5,
    right: 5.5,
  },
  qrDotB: {
    position: 'absolute',
    width: 2.5,
    height: 2.5,
    bottom: 2,
    right: 2,
  },
  sliderTrackTop: {
    position: 'absolute',
    top: 4.5,
    width: 15,
    height: 1.5,
    borderRadius: 1,
  },
  sliderKnobTop: {
    position: 'absolute',
    top: 2.8,
    left: 5,
    width: 4.5,
    height: 4.5,
    borderRadius: 2.5,
  },
  sliderTrackMid: {
    position: 'absolute',
    top: 9.5,
    width: 15,
    height: 1.5,
    borderRadius: 1,
  },
  sliderKnobMid: {
    position: 'absolute',
    top: 7.8,
    right: 5,
    width: 4.5,
    height: 4.5,
    borderRadius: 2.5,
  },
  sliderTrackBot: {
    position: 'absolute',
    top: 14.5,
    width: 15,
    height: 1.5,
    borderRadius: 1,
  },
  sliderKnobBot: {
    position: 'absolute',
    top: 12.8,
    left: 8,
    width: 4.5,
    height: 4.5,
    borderRadius: 2.5,
  },
  shieldBody: {
    width: 13,
    height: 15,
    borderWidth: 1.7,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  shieldDot: {
    position: 'absolute',
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
  },
  nodeRing: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 1.6,
  },
  nodeInner: {
    position: 'absolute',
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
  },
  nodeTop: { position: 'absolute', top: 1.5, width: 1.6, height: 3 },
  nodeBot: { position: 'absolute', bottom: 1.5, width: 1.6, height: 3 },
  nodeLeft: { position: 'absolute', left: 1.5, width: 3, height: 1.6 },
  nodeRight: { position: 'absolute', right: 1.5, width: 3, height: 1.6 },
  refreshArc: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.7,
    borderRightColor: 'transparent',
  },
  refreshTip: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 4.5,
    height: 4.5,
    borderTopWidth: 1.7,
    borderRightWidth: 1.7,
  },
  keyHead: {
    position: 'absolute',
    left: 2,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    borderWidth: 1.7,
  },
  keyShaft: {
    position: 'absolute',
    right: 2.5,
    width: 9,
    height: 1.7,
    borderRadius: 1,
  },
  keyTooth: {
    position: 'absolute',
    right: 4,
    bottom: 6.5,
    width: 1.7,
    height: 3,
  },
  flashTop: {
    width: 0,
    height: 0,
    borderLeftWidth: 4.5,
    borderRightWidth: 1.5,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginBottom: -1,
    marginRight: 2,
  },
  flashBot: {
    width: 0,
    height: 0,
    borderLeftWidth: 1.5,
    borderRightWidth: 4.5,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
    marginLeft: 2,
  },
  trashLid: {
    position: 'absolute',
    top: 3,
    width: 14,
    height: 1.7,
    borderRadius: 1,
  },
  trashCan: {
    position: 'absolute',
    top: 5.5,
    width: 11,
    height: 11.5,
    borderWidth: 1.6,
    borderTopWidth: 0,
    borderBottomLeftRadius: 2.5,
    borderBottomRightRadius: 2.5,
  },
  pinHead: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.6,
    marginBottom: 4,
  },
  pinStem: {
    position: 'absolute',
    bottom: 2,
    width: 1.6,
    height: 6,
  },
  linkLoopA: {
    position: 'absolute',
    left: 2,
    width: 9,
    height: 6,
    borderRadius: 3,
    borderWidth: 1.6,
    transform: [{ rotate: '-35deg' }],
  },
  linkLoopB: {
    position: 'absolute',
    right: 2,
    width: 9,
    height: 6,
    borderRadius: 3,
    borderWidth: 1.6,
    transform: [{ rotate: '-35deg' }],
  },
  searchLens: {
    position: 'absolute',
    top: 2.5,
    left: 2.5,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 1.65,
  },
  searchHandle: {
    position: 'absolute',
    bottom: 2.5,
    right: 3.5,
    width: 1.65,
    height: 6.2,
    borderRadius: 1,
    transform: [{ rotate: '-45deg' }],
  },
});
