import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { AgentVisualizerState } from '../hooks/useLiveKitCall';

interface AgentAuraVisualizerProps {
  state: AgentVisualizerState;
  audioLevel: number;
  size?: 'xs' | 'sm' | 'lg';
  color?: string;
}

const DEFAULT_AURA_COLOR = '#1FD5F9';
const SECONDARY_AZURE = '#3B82F6';
const HIGHLIGHT_CYAN = '#A5F3FC';

const BASE_SIZES = {
  xs: 20,
  sm: 56,
  lg: 224,
} as const;

/**
 * 60fps GPU-optimized Aura visualizer.
 * - Single ambient halo carries the soft blur glow (never rotated, zero blur re-raster lag).
 * - Counter-rotating ribbons run continuously without resetting on state changes,
 *   eliminating stutter/snaps when switching between idle, connecting, listening, and speaking.
 */
export const AgentAuraVisualizer = memo(function AgentAuraVisualizer({
  state,
  audioLevel,
  size = 'lg',
  color = DEFAULT_AURA_COLOR,
}: AgentAuraVisualizerProps) {
  const rotA = useRef(new Animated.Value(0)).current;
  const rotB = useRef(new Animated.Value(0)).current;
  const rotC = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const energy = useRef(new Animated.Value(0.1)).current;
  const activeOpacity = useRef(new Animated.Value(0.65)).current;

  const isMicro = size === 'xs';
  const isCompact = size === 'sm';
  const baseSize = BASE_SIZES[size];

  // Continuous unbroken native GPU rotation loops (never restarted on state change)
  useEffect(() => {
    const loopA = Animated.loop(
      Animated.timing(rotA, {
        toValue: 1,
        duration: 5200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    const loopB = Animated.loop(
      Animated.timing(rotB, {
        toValue: 1,
        duration: 7400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    const loopC = Animated.loop(
      Animated.timing(rotC, {
        toValue: 1,
        duration: 3900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    loopA.start();
    loopB.start();
    loopC.start();

    return () => {
      loopA.stop();
      loopB.stop();
      loopC.stop();
    };
  }, [rotA, rotB, rotC]);

  // Smooth state-driven breathing rhythm
  useEffect(() => {
    const halfCycle =
      state === 'speaking'
        ? 520
        : state === 'connecting'
          ? 700
          : state === 'thinking'
            ? 820
            : state === 'listening'
              ? 1650
              : 2400;

    const breatheLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: halfCycle,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: halfCycle,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    breatheLoop.start();
    return () => breatheLoop.stop();
  }, [breathe, state]);

  // Smooth audio-level & state-driven radial energy + luminosity
  useEffect(() => {
    const targetEnergy =
      state === 'speaking'
        ? Math.max(0.55, Math.min(1, audioLevel || 0.78))
        : state === 'thinking'
          ? 0.5
          : state === 'connecting'
            ? 0.4
            : state === 'listening'
              ? 0.24
              : 0.08;

    const targetOpacity =
      state === 'speaking'
        ? 1
        : state === 'connecting' || state === 'thinking'
          ? 0.92
          : state === 'listening'
            ? 0.84
            : 0.68;

    Animated.parallel([
      Animated.timing(energy, {
        toValue: targetEnergy,
        duration: state === 'speaking' ? 140 : 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(activeOpacity, {
        toValue: targetOpacity,
        duration: 360,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [activeOpacity, audioLevel, energy, state]);

  const spinCW = rotA.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const spinCCW = rotB.interpolate({
    inputRange: [0, 1],
    outputRange: ['360deg', '0deg'],
  });

  const spinFastCW = rotC.interpolate({
    inputRange: [0, 1],
    outputRange: ['60deg', '420deg'],
  });

  const haloScale = Animated.add(
    breathe.interpolate({
      inputRange: [0, 1],
      outputRange: [0.95, 1.07],
    }),
    energy.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.14],
    }),
  );

  const ribbonScale = Animated.add(
    breathe.interpolate({
      inputRange: [0, 1],
      outputRange: [0.97, 1.04],
    }),
    energy.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.1],
    }),
  );

  const haloOpacity = energy.interpolate({
    inputRange: [0, 1],
    outputRange: [0.28, 0.85],
  });

  const outerCanvas = Math.round(baseSize * (isMicro ? 1.3 : 1.24));
  const ringA = Math.round(baseSize * 0.96);
  const ringB = Math.round(baseSize * 0.91);
  const ringC = Math.round(baseSize * 0.86);

  const glowBlur = isMicro ? 5 : isCompact ? 10 : 28;
  const strokeThick = isMicro ? 1.5 : isCompact ? 2.4 : 5.5;
  const strokeThin = isMicro ? 0.8 : isCompact ? 1.2 : 2.4;

  return (
    <Animated.View
      style={[
        styles.root,
        { width: outerCanvas, height: outerCanvas, opacity: activeOpacity },
      ]}
      renderToHardwareTextureAndroid
    >
      {/* Single static-orientation GPU glow halo (fast — never rotated) */}
      <Animated.View
        style={[
          styles.layer,
          {
            width: baseSize,
            height: baseSize,
            borderRadius: baseSize / 2,
            borderWidth: isMicro ? 1 : isCompact ? 2 : 4,
            borderColor: 'rgba(31, 213, 249, 0.25)',
            boxShadow: `0 0 ${glowBlur}px ${isMicro ? 1 : isCompact ? 2 : 5}px rgba(31, 213, 249, 0.55)`,
            opacity: haloOpacity,
            transform: [{ scale: haloScale }],
          },
        ]}
      />

      {/* Deep azure organic ribbon (pure GPU transform, zero per-frame blur cost) */}
      <Animated.View
        style={[
          styles.layer,
          {
            width: ringA,
            height: ringA,
            borderRadius: ringA / 2,
            borderTopWidth: strokeThick * 1.25,
            borderBottomWidth: strokeThick * 0.95,
            borderLeftWidth: strokeThin,
            borderRightWidth: strokeThin,
            borderColor: SECONDARY_AZURE,
            opacity: 0.78,
            transform: [
              { rotate: spinCCW },
              { scaleX: 1.07 },
              { scaleY: 0.93 },
              { scale: ribbonScale },
            ],
          },
        ]}
      />

      {/* Primary electric-cyan ribbon */}
      <Animated.View
        style={[
          styles.layer,
          {
            width: ringB,
            height: ringB,
            borderRadius: ringB / 2,
            borderTopWidth: strokeThin,
            borderBottomWidth: strokeThick * 1.15,
            borderLeftWidth: strokeThick * 1.15,
            borderRightWidth: strokeThin * 1.2,
            borderColor: color,
            opacity: 0.94,
            transform: [
              { rotate: spinCW },
              { scaleX: 0.94 },
              { scaleY: 1.07 },
              { scale: ribbonScale },
            ],
          },
        ]}
      />

      {/* Luminous ice-cyan core wave */}
      <Animated.View
        style={[
          styles.layer,
          {
            width: ringC,
            height: ringC,
            borderRadius: ringC / 2,
            borderTopWidth: strokeThick * 0.75,
            borderRightWidth: strokeThick * 0.85,
            borderBottomWidth: strokeThin * 0.9,
            borderLeftWidth: strokeThin * 0.9,
            borderColor: HIGHLIGHT_CYAN,
            opacity: 0.72,
            transform: [
              { rotate: spinFastCW },
              { scaleX: 1.05 },
              { scaleY: 0.96 },
              { scale: ribbonScale },
            ],
          },
        ]}
      />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  layer: {
    position: 'absolute',
  },
});
