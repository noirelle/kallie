import React, { useEffect, useRef } from 'react';
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
 * LiveKit Agents UI-inspired luminous Aura visualizer in pure React Native.
 * Animation speed, radial breathing, and glow intensity map directly to live
 * states (idle, connecting, listening, thinking, speaking) + audioLevel so the
 * Aura ring serves as the sole visual status indicator.
 */
export function AgentAuraVisualizer({
  state,
  audioLevel,
  size = 'lg',
  color = DEFAULT_AURA_COLOR,
}: AgentAuraVisualizerProps) {
  const rotA = useRef(new Animated.Value(0)).current;
  const rotB = useRef(new Animated.Value(0)).current;
  const rotC = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const energy = useRef(new Animated.Value(0)).current;

  const isMicro = size === 'xs';
  const isCompact = size === 'sm';
  const baseSize = BASE_SIZES[size];

  // Continuous counter-rotating ribbon loops tuned cleanly per state
  useEffect(() => {
    const speedMultiplier =
      state === 'speaking'
        ? 0.5
        : state === 'thinking'
          ? 0.4
          : state === 'connecting'
            ? 0.65
            : state === 'listening'
              ? 1.15
              : 1.85; // idle: calm, serene drift

    const breatheDuration =
      state === 'speaking'
        ? 560
        : state === 'connecting'
          ? 760
          : state === 'thinking'
            ? 840
            : state === 'listening'
              ? 1750
              : 2600; // idle: slow deep breath

    rotA.setValue(0);
    rotB.setValue(0);
    rotC.setValue(0);

    const loopA = Animated.loop(
      Animated.timing(rotA, {
        toValue: 1,
        duration: Math.round(5400 * speedMultiplier),
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    const loopB = Animated.loop(
      Animated.timing(rotB, {
        toValue: 1,
        duration: Math.round(7600 * speedMultiplier),
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    const loopC = Animated.loop(
      Animated.timing(rotC, {
        toValue: 1,
        duration: Math.round(4100 * speedMultiplier),
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    const breatheLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: breatheDuration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: breatheDuration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    loopA.start();
    loopB.start();
    loopC.start();
    breatheLoop.start();

    return () => {
      loopA.stop();
      loopB.stop();
      loopC.stop();
      breatheLoop.stop();
    };
  }, [breathe, rotA, rotB, rotC, state]);

  // Audio-level & state-driven radial energy response
  useEffect(() => {
    const target =
      state === 'speaking'
        ? Math.max(0.5, Math.min(1, audioLevel || 0.78))
        : state === 'thinking'
          ? 0.48
          : state === 'connecting'
            ? 0.36
            : state === 'listening'
              ? 0.22
              : 0.08; // idle

    Animated.timing(energy, {
      toValue: target,
      duration: state === 'speaking' ? 110 : 340,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [audioLevel, energy, state]);

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
      outputRange: state === 'connecting' ? [0.88, 1.08] : [0.95, 1.07],
    }),
    energy.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.14],
    }),
  );

  const ribbonScale = Animated.add(
    breathe.interpolate({
      inputRange: [0, 1],
      outputRange: state === 'connecting' ? [0.92, 1.06] : [0.98, 1.04],
    }),
    energy.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.1],
    }),
  );

  const haloOpacity = energy.interpolate({
    inputRange: [0, 1],
    outputRange: state === 'idle' ? [0.22, 0.45] : [0.38, 0.88],
  });

  const outerCanvas = Math.round(baseSize * (isMicro ? 1.3 : 1.24));
  const ringA = Math.round(baseSize * 0.96);
  const ringB = Math.round(baseSize * 0.91);
  const ringC = Math.round(baseSize * 0.86);

  const glowBlur = isMicro ? 5 : isCompact ? 10 : 30;
  const innerBlur = isMicro ? 3 : isCompact ? 6 : 18;
  const strokeThick = isMicro ? 1.5 : isCompact ? 2.4 : 6;
  const strokeThin = isMicro ? 0.8 : isCompact ? 1.2 : 2.6;

  return (
    <View style={[styles.root, { width: outerCanvas, height: outerCanvas }]}>
      {/* Wide ambient azure/cyan halo bloom */}
      <Animated.View
        style={[
          styles.layer,
          {
            width: baseSize,
            height: baseSize,
            borderRadius: baseSize / 2,
            borderWidth: isMicro ? 1 : isCompact ? 2 : 5,
            borderColor: 'rgba(31, 213, 249, 0.28)',
            boxShadow: `0 0 ${glowBlur}px ${isMicro ? 1 : isCompact ? 2 : 6}px rgba(31, 213, 249, 0.45), inset 0 0 ${innerBlur}px ${isMicro ? 0 : isCompact ? 1 : 4}px rgba(59, 130, 246, 0.35)`,
            opacity: haloOpacity,
            transform: [{ scale: haloScale }],
          },
        ]}
      />

      {/* Deep cobalt/azure organic ribbon (counter-clockwise) */}
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
            boxShadow: `0 0 ${isMicro ? 4 : isCompact ? 8 : 22}px ${isMicro ? 0 : isCompact ? 1 : 3}px rgba(59, 130, 246, 0.65), inset 0 0 ${isMicro ? 2 : isCompact ? 5 : 14}px 0px rgba(59, 130, 246, 0.45)`,
            opacity: state === 'idle' ? 0.5 : state === 'listening' ? 0.7 : 0.9,
            transform: [
              { rotate: spinCCW },
              { scaleX: 1.07 },
              { scaleY: 0.93 },
              { scale: ribbonScale },
            ],
          },
        ]}
      />

      {/* Primary electric-cyan undulating ribbon (clockwise) */}
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
            boxShadow: `0 0 ${isMicro ? 4 : isCompact ? 8 : 20}px ${isMicro ? 0 : isCompact ? 1 : 2}px rgba(31, 213, 249, 0.78), inset 0 0 ${isMicro ? 2 : isCompact ? 4 : 12}px 0px rgba(31, 213, 249, 0.5)`,
            opacity: state === 'idle' ? 0.75 : 0.95,
            transform: [
              { rotate: spinCW },
              { scaleX: 0.94 },
              { scaleY: 1.07 },
              { scale: ribbonScale },
            ],
          },
        ]}
      />

      {/* Bright cyan core energy wave (fast clockwise) */}
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
            boxShadow: `0 0 ${isMicro ? 3 : isCompact ? 6 : 14}px 0px rgba(165, 243, 252, 0.75)`,
            opacity:
              state === 'speaking'
                ? 0.98
                : state === 'thinking' || state === 'connecting'
                  ? 0.85
                  : state === 'listening'
                    ? 0.65
                    : 0.42,
            transform: [
              { rotate: spinFastCW },
              { scaleX: 1.05 },
              { scaleY: 0.96 },
              { scale: ribbonScale },
            ],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  layer: {
    position: 'absolute',
  },
});
