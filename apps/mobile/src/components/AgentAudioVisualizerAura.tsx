import React, { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import {
  AURA_DEMO_SEQUENCE,
  AURA_STATUS_PALETTES,
  AuraAgentState,
  AuraColorPalette,
  AuraConnectionStatus,
  resolveAuraPalette,
} from './auraTheme';

export type AuraSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AgentAudioVisualizerAuraProps {
  size?: AuraSize;
  color?: string;
  colorShift?: number;
  state?: AuraAgentState;
  connectionStatus?: AuraConnectionStatus;
  audioLevel?: number;
  themeMode?: 'dark' | 'light';
  cycleDemoColors?: boolean;
  style?: ViewStyle;
}

const RING_DIAMETERS: Record<AuraSize, number> = {
  xs: 22,
  sm: 64,
  md: 132,
  lg: 204,
  xl: 228,
};

/**
 * LiveKit Agents UI-compatible `AgentAudioVisualizerAura` adapted for React Native.
 * - Zero-flicker color transitions: smoothly interpolates RGB border/glow colors
 *   directly on a single persistent set of rings (no layer mount/unmount or alpha dips).
 * - Continuous unbroken 60fps native GPU transforms (rotation + breathing) isolated
 *   on parent Animated.Views so color transitions never interrupt or stutter motion.
 * - Uniform 360° borderWidth inside an unclipped canvas for seamless glow in all directions.
 */
export const AgentAudioVisualizerAura = memo(function AgentAudioVisualizerAura({
  size = 'xl',
  color = '#1FD5F9',
  colorShift = 0.3,
  state = 'listening',
  connectionStatus,
  audioLevel = 0.16,
  cycleDemoColors = false,
  style,
}: AgentAudioVisualizerAuraProps) {
  const [demoIndex, setDemoIndex] = useState(0);

  useEffect(() => {
    if (!cycleDemoColors) return;
    const timer = setInterval(() => {
      setDemoIndex((prev) => (prev + 1) % AURA_DEMO_SEQUENCE.length);
    }, 2400);
    return () => clearInterval(timer);
  }, [cycleDemoColors]);

  const targetPalette: AuraColorPalette = cycleDemoColors
    ? AURA_STATUS_PALETTES[AURA_DEMO_SEQUENCE[demoIndex]]
    : resolveAuraPalette(connectionStatus, color);

  // Pure-GPU (useNativeDriver: true) palette cross-fade so status color shifts
  // never block the JS thread during Aura tap or WebRTC signaling.
  const [activePalette, setActivePalette] = useState<AuraColorPalette>(targetPalette);
  const [exitingPalette, setExitingPalette] = useState<AuraColorPalette | null>(null);
  const fadeProgress = useRef(new Animated.Value(1)).current;
  const activePrimaryRef = useRef<string>(targetPalette.primary);

  useEffect(() => {
    if (targetPalette.primary === activePrimaryRef.current) {
      return;
    }
    const prevPalette = activePalette;
    activePrimaryRef.current = targetPalette.primary;
    setExitingPalette(prevPalette);
    setActivePalette(targetPalette);
    fadeProgress.stopAnimation();
    fadeProgress.setValue(0);

    Animated.timing(fadeProgress, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setExitingPalette(null);
      }
    });
  }, [activePalette, fadeProgress, targetPalette]);

  // Continuous unbroken native GPU rotation loops
  const rotA = useRef(new Animated.Value(0)).current;
  const rotB = useRef(new Animated.Value(0)).current;
  const rotC = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const energy = useRef(new Animated.Value(0.14)).current;
  const masterOpacity = useRef(new Animated.Value(0.84)).current;

  useEffect(() => {
    const loopA = Animated.loop(
      Animated.timing(rotA, {
        toValue: 1,
        duration: 5400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const loopB = Animated.loop(
      Animated.timing(rotB, {
        toValue: 1,
        duration: 7800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const loopC = Animated.loop(
      Animated.timing(rotC, {
        toValue: 1,
        duration: 4200,
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

  useEffect(() => {
    const halfCycle =
      state === 'speaking'
        ? 520
        : state === 'connecting'
          ? 700
          : state === 'thinking'
            ? 840
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

  useEffect(() => {
    const targetEnergy =
      state === 'speaking'
        ? Math.max(0.55, Math.min(1, audioLevel || 0.78))
        : state === 'thinking'
          ? 0.5
          : state === 'connecting'
            ? 0.42
            : state === 'listening'
              ? 0.24
              : 0.1;

    const targetAlpha =
      state === 'speaking'
        ? 1
        : state === 'connecting' || state === 'thinking'
          ? 0.94
          : state === 'listening'
            ? 0.88
            : 0.78;

    Animated.parallel([
      Animated.timing(energy, {
        toValue: targetEnergy,
        duration: state === 'speaking' ? 140 : 340,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(masterOpacity, {
        toValue: targetAlpha,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [audioLevel, energy, masterOpacity, state]);

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
      outputRange: [0.95, 1.06],
    }),
    energy.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.12],
    }),
  );

  const ribbonScale = Animated.add(
    breathe.interpolate({
      inputRange: [0, 1],
      outputRange: [0.975, 1.035],
    }),
    energy.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.09],
    }),
  );

  const haloOpacity = energy.interpolate({
    inputRange: [0, 1],
    outputRange: [0.32, 0.85],
  });

  // Pure-GPU opacity cross-fade channels (zero JS-thread frames)
  const exitingOpacity = fadeProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  const ringSize = RING_DIAMETERS[size];
  const outerRing = Math.round(ringSize * 0.99);
  const midRing = Math.round(ringSize * 0.95);
  const innerRing = Math.round(ringSize * 0.91);
  const haloOuter = Math.round(ringSize * 1.14);
  const haloMid = Math.round(ringSize * 1.06);

  const stroke =
    size === 'xs' ? 1.5 : size === 'sm' ? 2.4 : size === 'md' ? 3.4 : 4.4;
  const shiftIntensity = Math.max(0.1, Math.min(0.6, colorShift));
  // Generous unclipped margin on every side so glow never hits a container edge
  const canvasSize = haloOuter + 36;

  const renderPaletteRings = (palette: AuraColorPalette) => (
    <>
      {/* Layered soft 360° ambient glow rings */}
      <Animated.View
        style={[
          styles.motionLayer,
          { opacity: haloOpacity, transform: [{ scale: haloScale }] },
        ]}
      >
        <View
          style={[
            styles.circle,
            {
              width: haloOuter,
              height: haloOuter,
              borderRadius: haloOuter / 2,
              borderWidth: Math.max(4, stroke * 3.2),
              borderColor: palette.glowRgba,
              opacity: 0.14,
            },
          ]}
        />
        <View
          style={[
            styles.circle,
            {
              width: haloMid,
              height: haloMid,
              borderRadius: haloMid / 2,
              borderWidth: Math.max(3, stroke * 2.0),
              borderColor: palette.glowRgba,
              opacity: 0.28,
            },
          ]}
        />
      </Animated.View>

      {/* Secondary shifted organic elliptical ring */}
      <Animated.View
        style={[
          styles.motionLayer,
          {
            opacity: 0.48 + shiftIntensity * 0.65,
            transform: [
              { rotate: spinCCW },
              { scaleX: 1.045 },
              { scaleY: 0.955 },
              { scale: ribbonScale },
            ],
          },
        ]}
      >
        <View
          style={[
            styles.circle,
            {
              width: outerRing,
              height: outerRing,
              borderRadius: outerRing / 2,
              borderWidth: stroke * 1.15,
              borderColor: palette.secondary,
            },
          ]}
        />
      </Animated.View>

      {/* Primary luminous undulating energy ring */}
      <Animated.View
        style={[
          styles.motionLayer,
          {
            opacity: 0.94,
            transform: [
              { rotate: spinCW },
              { scaleX: 0.96 },
              { scaleY: 1.04 },
              { scale: ribbonScale },
            ],
          },
        ]}
      >
        <View
          style={[
            styles.circle,
            {
              width: midRing,
              height: midRing,
              borderRadius: midRing / 2,
              borderWidth: stroke,
              borderColor: palette.primary,
            },
          ]}
        />
      </Animated.View>

      {/* Bright inner core shimmer ring */}
      <Animated.View
        style={[
          styles.motionLayer,
          {
            opacity: 0.65,
            transform: [
              { rotate: spinFastCW },
              { scaleX: 1.028 },
              { scaleY: 0.972 },
              { scale: ribbonScale },
            ],
          },
        ]}
      >
        <View
          style={[
            styles.circle,
            {
              width: innerRing,
              height: innerRing,
              borderRadius: innerRing / 2,
              borderWidth: Math.max(1, stroke * 0.55),
              borderColor: palette.highlight,
            },
          ]}
        />
      </Animated.View>
    </>
  );

  return (
    <Animated.View
      style={[
        styles.root,
        { width: canvasSize, height: canvasSize, opacity: masterOpacity },
        style,
      ]}
      pointerEvents="none"
    >
      {exitingPalette ? (
        <Animated.View style={[styles.motionLayer, { opacity: exitingOpacity }]}>
          {renderPaletteRings(exitingPalette)}
        </Animated.View>
      ) : null}
      <Animated.View style={[styles.motionLayer, { opacity: fadeProgress }]}>
        {renderPaletteRings(activePalette)}
      </Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  motionLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    position: 'absolute',
  },
});
