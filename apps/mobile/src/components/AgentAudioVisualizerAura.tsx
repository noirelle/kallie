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

interface AuraRibbonSetProps {
  palette: AuraColorPalette;
  ringSize: number;
  glowBlur: number;
  stroke: number;
  colorShift: number;
  spinCW: Animated.AnimatedInterpolation<string>;
  spinCCW: Animated.AnimatedInterpolation<string>;
  spinFastCW: Animated.AnimatedInterpolation<string>;
  haloScale: Animated.AnimatedAddition;
  ribbonScale: Animated.AnimatedAddition;
  haloOpacity: Animated.AnimatedInterpolation<number>;
}

/**
 * Seamless 360° continuous ribbon set:
 * Uses uniform borderWidth on every ring (eliminating Android miter seams or
 * "two halves" artifacts) and renders inside an unclipped canvas so the outer
 * glow never clips horizontally or vertically.
 */
const AuraRibbonSet = memo(function AuraRibbonSet({
  palette,
  ringSize,
  glowBlur,
  stroke,
  colorShift,
  spinCW,
  spinCCW,
  spinFastCW,
  haloScale,
  ribbonScale,
  haloOpacity,
}: AuraRibbonSetProps) {
  const outerRing = Math.round(ringSize * 0.99);
  const midRing = Math.round(ringSize * 0.95);
  const innerRing = Math.round(ringSize * 0.91);
  const shiftIntensity = Math.max(0.1, Math.min(0.6, colorShift));

  return (
    <View style={styles.ribbonLayer} pointerEvents="none">
      {/* Continuous ambient 360° halo glow (non-rotating for silky 60fps GPU perf) */}
      <Animated.View
        style={[
          styles.circle,
          {
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderWidth: Math.max(1.5, stroke * 0.75),
            borderColor: palette.glowRgba,
            boxShadow: `0 0 ${glowBlur}px ${Math.max(2, Math.round(glowBlur * 0.22))}px ${palette.glowRgba}`,
            opacity: haloOpacity,
            transform: [{ scale: haloScale }],
          },
        ]}
      />

      {/* Secondary shifted organic elliptical ring (uniform stroke, zero seams) */}
      <Animated.View
        style={[
          styles.circle,
          {
            width: outerRing,
            height: outerRing,
            borderRadius: outerRing / 2,
            borderWidth: stroke * 1.15,
            borderColor: palette.secondary,
            opacity: 0.45 + shiftIntensity * 0.7,
            transform: [
              { rotate: spinCCW },
              { scaleX: 1.045 },
              { scaleY: 0.955 },
              { scale: ribbonScale },
            ],
          },
        ]}
      />

      {/* Primary luminous undulating energy ring */}
      <Animated.View
        style={[
          styles.circle,
          {
            width: midRing,
            height: midRing,
            borderRadius: midRing / 2,
            borderWidth: stroke,
            borderColor: palette.primary,
            opacity: 0.92,
            transform: [
              { rotate: spinCW },
              { scaleX: 0.96 },
              { scaleY: 1.04 },
              { scale: ribbonScale },
            ],
          },
        ]}
      />

      {/* Bright inner core shimmer ring */}
      <Animated.View
        style={[
          styles.circle,
          {
            width: innerRing,
            height: innerRing,
            borderRadius: innerRing / 2,
            borderWidth: Math.max(1, stroke * 0.55),
            borderColor: palette.highlight,
            opacity: 0.62,
            transform: [
              { rotate: spinFastCW },
              { scaleX: 1.028 },
              { scaleY: 0.972 },
              { scale: ribbonScale },
            ],
          },
        ]}
      />
    </View>
  );
});

/**
 * LiveKit Agents UI-compatible `AgentAudioVisualizerAura` adapted for React Native.
 * - Supports real connection status colors (Green, Blue, Yellow, Red) with smooth
 *   60fps GPU cross-fade transitions.
 * - Optional `cycleDemoColors` mode smoothly showcases all connection colors on
 *   onboarding and sign-up screens.
 * - Renders perfectly centered with generous unclipped glow bounds in all directions.
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

  // Smooth GPU cross-fade whenever the active palette changes
  const [displayedPalette, setDisplayedPalette] = useState<AuraColorPalette>(targetPalette);
  const [previousPalette, setPreviousPalette] = useState<AuraColorPalette | null>(null);
  const crossfade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (targetPalette.primary === displayedPalette.primary) {
      return;
    }
    setPreviousPalette(displayedPalette);
    setDisplayedPalette(targetPalette);
    crossfade.setValue(0);
    Animated.timing(crossfade, {
      toValue: 1,
      duration: 620,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setPreviousPalette(null);
      }
    });
  }, [crossfade, displayedPalette, targetPalette]);

  // Continuous unbroken GPU rotation loops (never snap on state change)
  const rotA = useRef(new Animated.Value(0)).current;
  const rotB = useRef(new Animated.Value(0)).current;
  const rotC = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const energy = useRef(new Animated.Value(0.14)).current;
  const masterOpacity = useRef(new Animated.Value(0.82)).current;

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
            : 0.76;

    Animated.parallel([
      Animated.timing(energy, {
        toValue: targetEnergy,
        duration: state === 'speaking' ? 140 : 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(masterOpacity, {
        toValue: targetAlpha,
        duration: 360,
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
    outputRange: [0.34, 0.9],
  });

  const prevOpacity = crossfade.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  const ringSize = RING_DIAMETERS[size];
  const glowBlur =
    size === 'xs' ? 6 : size === 'sm' ? 14 : size === 'md' ? 22 : 32;
  const stroke =
    size === 'xs' ? 1.5 : size === 'sm' ? 2.4 : size === 'md' ? 3.4 : 4.4;
  // Generous unclipped margin on every side so glow never hits a container edge
  const canvasSize = ringSize + glowBlur * 2 + 20;

  return (
    <Animated.View
      style={[
        styles.root,
        { width: canvasSize, height: canvasSize, opacity: masterOpacity },
        style,
      ]}
    >
      {previousPalette ? (
        <Animated.View style={[styles.fadeWrap, { opacity: prevOpacity }]}>
          <AuraRibbonSet
            palette={previousPalette}
            ringSize={ringSize}
            glowBlur={glowBlur}
            stroke={stroke}
            colorShift={colorShift}
            spinCW={spinCW}
            spinCCW={spinCCW}
            spinFastCW={spinFastCW}
            haloScale={haloScale}
            ribbonScale={ribbonScale}
            haloOpacity={haloOpacity}
          />
        </Animated.View>
      ) : null}

      <Animated.View style={[styles.fadeWrap, { opacity: crossfade }]}>
        <AuraRibbonSet
          palette={displayedPalette}
          ringSize={ringSize}
          glowBlur={glowBlur}
          stroke={stroke}
          colorShift={colorShift}
          spinCW={spinCW}
          spinCCW={spinCCW}
          spinFastCW={spinFastCW}
          haloScale={haloScale}
          ribbonScale={ribbonScale}
          haloOpacity={haloOpacity}
        />
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
  fadeWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ribbonLayer: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    position: 'absolute',
  },
});
