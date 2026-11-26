import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { AgentVisualizerState } from '../hooks/useLiveKitCall';

interface AgentAuraVisualizerProps {
  state: AgentVisualizerState;
  audioLevel: number;
  size?: 'sm' | 'lg';
  color?: string;
}

const DEFAULT_AURA_COLOR = '#1FD5F9';
const SECONDARY_AZURE = '#3B82F6';
const HIGHLIGHT_CYAN = '#A5F3FC';

/**
 * LiveKit Agents UI-inspired luminous Aura visualizer in pure React Native.
 * Uses GPU-accelerated native transforms + luminous boxShadow bloom across
 * counter-rotating organic wave ribbons for a fluid shader-like energy field.
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

  const isCompact = size === 'sm';
  const baseSize = isCompact ? 56 : 210;

  // Continuous counter-rotating ribbon loops tuned by agent state
  useEffect(() => {
    const speedMultiplier =
      state === 'speaking'
        ? 0.55
        : state === 'thinking'
          ? 0.42
          : state === 'connecting'
            ? 0.8
            : 1.25;

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
          duration: state === 'speaking' ? 620 : state === 'thinking' ? 880 : 1850,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: state === 'speaking' ? 620 : state === 'thinking' ? 880 : 1850,
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
        ? Math.max(0.45, Math.min(1, audioLevel || 0.75))
        : state === 'thinking'
          ? 0.45
          : state === 'connecting'
            ? 0.28
            : 0.16;

    Animated.timing(energy, {
      toValue: target,
      duration: state === 'speaking' ? 120 : 320,
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
      outputRange: [0.98, 1.04],
    }),
    energy.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.1],
    }),
  );

  const haloOpacity = energy.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.85],
  });

  const outerCanvas = Math.round(baseSize * 1.24);
  const ringA = Math.round(baseSize * 0.96);
  const ringB = Math.round(baseSize * 0.91);
  const ringC = Math.round(baseSize * 0.86);
  const glowBlur = isCompact ? 10 : 28;
  const innerBlur = isCompact ? 6 : 18;
  const strokeThick = isCompact ? 2.4 : 6;
  const strokeThin = isCompact ? 1.2 : 2.6;

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
            borderWidth: isCompact ? 2 : 5,
            borderColor: 'rgba(31, 213, 249, 0.28)',
            boxShadow: `0 0 ${glowBlur}px ${isCompact ? 2 : 6}px rgba(31, 213, 249, 0.42), inset 0 0 ${innerBlur}px ${isCompact ? 1 : 4}px rgba(59, 130, 246, 0.35)`,
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
            boxShadow: `0 0 ${isCompact ? 8 : 22}px ${isCompact ? 1 : 3}px rgba(59, 130, 246, 0.65), inset 0 0 ${isCompact ? 5 : 14}px 0px rgba(59, 130, 246, 0.45)`,
            opacity: state === 'listening' ? 0.65 : 0.88,
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
            boxShadow: `0 0 ${isCompact ? 8 : 20}px ${isCompact ? 1 : 2}px rgba(31, 213, 249, 0.78), inset 0 0 ${isCompact ? 4 : 12}px 0px rgba(31, 213, 249, 0.5)`,
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
            boxShadow: `0 0 ${isCompact ? 6 : 14}px 0px rgba(165, 243, 252, 0.75)`,
            opacity: state === 'speaking' ? 0.95 : state === 'thinking' ? 0.82 : 0.62,
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
