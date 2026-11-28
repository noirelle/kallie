import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  requireNativeComponent,
  StyleSheet,
  UIManager,
  View,
  ViewStyle,
} from 'react-native';
import {
  AuraAgentState,
  AuraColorPalette,
  AuraConnectionStatus,
  resolveAuraPalette,
} from './auraTheme';
import { useAudioLevel } from '../features/calling/lib/audioLevelStore';

interface NativeSolarAuraProps {
  state: string;
  connectionStatus: string;
  audioLevel: number;
  style?: ViewStyle;
}

const HAS_NATIVE_SOLAR_AURA =
  Platform.OS === 'android' &&
  Boolean(UIManager.getViewManagerConfig?.('KallieSolarAuraView'));

const NativeSolarAuraView = HAS_NATIVE_SOLAR_AURA
  ? requireNativeComponent<NativeSolarAuraProps>('KallieSolarAuraView')
  : null;

export type AuraSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AgentAudioVisualizerAuraProps {
  size?: AuraSize;
  color?: string;
  colorShift?: number;
  state?: AuraAgentState;
  connectionStatus?: AuraConnectionStatus;
  audioLevel?: number;
  liveAudio?: boolean;
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
 * Lightweight Android wrapper that renders the native Kotlin KallieSolarAuraView directly
 * with zero JS Animated.loop or unnecessary useAudioLevel subscriptions.
 */
const NativeSolarAuraWrapper = memo(function NativeSolarAuraWrapper({
  size = 'xl',
  state = 'listening',
  connectionStatus = 'idle',
  audioLevel: explicitAudioLevel,
  liveAudio = false,
  style,
}: AgentAudioVisualizerAuraProps) {
  const subscribedLevel = useAudioLevel(liveAudio);
  const audioLevel = liveAudio ? subscribedLevel : (explicitAudioLevel ?? 0.16);
  const ringSize = RING_DIAMETERS[size];
  const canvasSize = Math.round(ringSize * 1.24) + 32;

  if (!NativeSolarAuraView) return null;

  return (
    <View
      style={[styles.root, { width: canvasSize, height: canvasSize }, style]}
      pointerEvents="none"
    >
      <NativeSolarAuraView
        state={state}
        connectionStatus={connectionStatus}
        audioLevel={audioLevel}
        style={{ width: canvasSize, height: canvasSize }}
      />
    </View>
  );
});

const FallbackSculptedAura = memo(function FallbackSculptedAura({
  size = 'xl',
  color = '#FFFFFF',
  colorShift = 0.3,
  state = 'listening',
  connectionStatus,
  audioLevel: explicitAudioLevel,
  liveAudio = false,
  style,
}: AgentAudioVisualizerAuraProps) {
  const subscribedLevel = useAudioLevel(liveAudio);
  const audioLevel = liveAudio ? subscribedLevel : (explicitAudioLevel ?? 0.16);

  const targetPalette: AuraColorPalette = resolveAuraPalette(connectionStatus, color);

  const [activePalette, setActivePalette] = useState<AuraColorPalette>(targetPalette);
  const [exitingPalette, setExitingPalette] = useState<AuraColorPalette | null>(null);
  const fadeProgress = useRef(new Animated.Value(1)).current;
  const activePaletteRef = useRef<AuraColorPalette>(targetPalette);

  useEffect(() => {
    if (targetPalette.primary === activePaletteRef.current.primary) {
      return;
    }
    const prevPalette = activePaletteRef.current;
    activePaletteRef.current = targetPalette;
    setExitingPalette(prevPalette);
    setActivePalette(targetPalette);
    fadeProgress.stopAnimation();
    fadeProgress.setValue(0);

    let cancelled = false;
    const anim = Animated.timing(fadeProgress, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished && !cancelled) {
        setExitingPalette(null);
      }
    });
    return () => {
      cancelled = true;
      anim.stop();
    };
  }, [fadeProgress, targetPalette]);

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

  useEffect(() => {
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
  }, [energy, masterOpacity, state, targetAlpha, targetEnergy]);

  const {
    spinCW,
    spinCCW,
    spinFastCW,
    haloScale,
    sphereScale,
    corePulseScale,
    corePulseOpacity,
    haloOpacity,
    exitingOpacity,
  } = useMemo(() => {
    return {
      spinCW: rotA.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
      }),
      spinCCW: rotB.interpolate({
        inputRange: [0, 1],
        outputRange: ['360deg', '0deg'],
      }),
      spinFastCW: rotC.interpolate({
        inputRange: [0, 1],
        outputRange: ['60deg', '420deg'],
      }),
      haloScale: Animated.add(
        breathe.interpolate({
          inputRange: [0, 1],
          outputRange: [0.96, 1.05],
        }),
        energy.interpolate({
          inputRange: [0, 1],
          outputRange: [0, 0.14],
        }),
      ),
      sphereScale: Animated.add(
        breathe.interpolate({
          inputRange: [0, 1],
          outputRange: [0.985, 1.022],
        }),
        energy.interpolate({
          inputRange: [0, 1],
          outputRange: [0, 0.065],
        }),
      ),
      corePulseScale: Animated.add(
        breathe.interpolate({
          inputRange: [0, 1],
          outputRange: [0.9, 1.04],
        }),
        energy.interpolate({
          inputRange: [0, 1],
          outputRange: [0, 0.22],
        }),
      ),
      corePulseOpacity: energy.interpolate({
        inputRange: [0, 1],
        outputRange: [0.28, 0.78],
      }),
      haloOpacity: energy.interpolate({
        inputRange: [0, 1],
        outputRange: [0.34, 0.88],
      }),
      exitingOpacity: fadeProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
      }),
    };
  }, [breathe, energy, fadeProgress, rotA, rotB, rotC]);

  const ringSize = RING_DIAMETERS[size];
  const sphereSize = Math.round(ringSize * 0.92);
  const outerHaloWide = Math.round(ringSize * 1.24);
  const outerHaloMid = Math.round(ringSize * 1.11);
  const outerHaloNear = Math.round(ringSize * 1.02);
  const orbitalOuter = Math.round(ringSize * 0.99);
  const orbitalInner = Math.round(ringSize * 0.95);
  const stroke = size === 'xs' ? 1.1 : size === 'sm' ? 1.5 : size === 'md' ? 2.0 : 2.4;
  const shiftIntensity = Math.max(0.1, Math.min(0.6, colorShift));
  const canvasSize = outerHaloWide + 32;

  const renderSculptedAura = (palette: AuraColorPalette) => (
    <>
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
              width: outerHaloWide,
              height: outerHaloWide,
              borderRadius: outerHaloWide / 2,
              backgroundColor: palette.coreGlow,
              opacity: 0.055,
            },
          ]}
        />
        <View
          style={[
            styles.circle,
            {
              width: outerHaloMid,
              height: outerHaloMid,
              borderRadius: outerHaloMid / 2,
              backgroundColor: palette.coreGlow,
              opacity: 0.1,
            },
          ]}
        />
        <View
          style={[
            styles.circle,
            {
              width: outerHaloNear,
              height: outerHaloNear,
              borderRadius: outerHaloNear / 2,
              backgroundColor: palette.primary,
              opacity: 0.14,
            },
          ]}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.sphereShell,
          {
            width: sphereSize,
            height: sphereSize,
            borderRadius: sphereSize / 2,
            backgroundColor: palette.coreBase,
            borderWidth: Math.max(1, stroke * 0.65),
            borderColor: palette.rimRgba,
            transform: [{ scale: sphereScale }],
          },
        ]}
      >
        <View
          style={[
            styles.circle,
            {
              width: sphereSize * 0.94,
              height: sphereSize * 0.94,
              borderRadius: (sphereSize * 0.94) / 2,
              backgroundColor: palette.coreMid,
              opacity: 0.34,
              transform: [
                { translateX: -sphereSize * 0.06 },
                { translateY: -sphereSize * 0.07 },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.motionLayer,
            {
              opacity: 0.38 + shiftIntensity * 0.35,
              transform: [{ rotate: spinCCW }],
            },
          ]}
        >
          <View
            style={[
              styles.circle,
              {
                width: sphereSize * 0.84,
                height: sphereSize * 0.68,
                borderRadius: sphereSize * 0.42,
                backgroundColor: palette.secondary,
                transform: [
                  { translateX: sphereSize * 0.12 },
                  { translateY: sphereSize * 0.12 },
                ],
              },
            ]}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.motionLayer,
            { opacity: 0.56, transform: [{ rotate: spinCW }] },
          ]}
        >
          <View
            style={[
              styles.circle,
              {
                width: sphereSize * 0.82,
                height: sphereSize * 0.66,
                borderRadius: sphereSize * 0.41,
                backgroundColor: palette.primary,
                transform: [
                  { translateX: -sphereSize * 0.12 },
                  { translateY: -sphereSize * 0.13 },
                ],
              },
            ]}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.motionLayer,
            {
              opacity: corePulseOpacity,
              transform: [{ rotate: spinFastCW }, { scale: corePulseScale }],
            },
          ]}
        >
          <View
            style={[
              styles.circle,
              {
                width: sphereSize * 0.64,
                height: sphereSize * 0.5,
                borderRadius: sphereSize * 0.32,
                backgroundColor: palette.highlight,
                opacity: 0.54,
                transform: [
                  { translateX: -sphereSize * 0.08 },
                  { translateY: -sphereSize * 0.09 },
                ],
              },
            ]}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.motionLayer,
            { opacity: corePulseOpacity, transform: [{ scale: corePulseScale }] },
          ]}
        >
          <View
            style={[
              styles.circle,
              {
                width: sphereSize * 0.56,
                height: sphereSize * 0.56,
                borderRadius: (sphereSize * 0.56) / 2,
                backgroundColor: palette.highlight,
                opacity: 0.48,
              },
            ]}
          />
        </Animated.View>
        <View
          style={[
            styles.circle,
            {
              width: sphereSize - Math.max(4, stroke * 2),
              height: sphereSize - Math.max(4, stroke * 2),
              borderRadius: (sphereSize - Math.max(4, stroke * 2)) / 2,
              borderWidth: Math.max(1, stroke * 0.5),
              borderColor: palette.rimRgba,
              opacity: 0.55,
            },
          ]}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.motionLayer,
          {
            opacity: 0.42 + shiftIntensity * 0.4,
            transform: [
              { rotate: spinCCW },
              { scaleX: 1.032 },
              { scaleY: 0.968 },
              { scale: sphereScale },
            ],
          },
        ]}
      >
        <View
          style={[
            styles.circle,
            {
              width: orbitalOuter,
              height: orbitalOuter,
              borderRadius: orbitalOuter / 2,
              borderWidth: Math.max(1, stroke * 0.75),
              borderColor: palette.secondary,
            },
          ]}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.motionLayer,
          {
            opacity: 0.72,
            transform: [
              { rotate: spinCW },
              { scaleX: 0.972 },
              { scaleY: 1.028 },
              { scale: sphereScale },
            ],
          },
        ]}
      >
        <View
          style={[
            styles.circle,
            {
              width: orbitalInner,
              height: orbitalInner,
              borderRadius: orbitalInner / 2,
              borderWidth: Math.max(1, stroke * 0.65),
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
          {renderSculptedAura(exitingPalette)}
        </Animated.View>
      ) : null}
      <Animated.View style={[styles.motionLayer, { opacity: fadeProgress }]}>
        {renderSculptedAura(activePalette)}
      </Animated.View>
    </Animated.View>
  );
});

export const AgentAudioVisualizerAura = memo(function AgentAudioVisualizerAura(
  props: AgentAudioVisualizerAuraProps,
) {
  if (NativeSolarAuraView) {
    return <NativeSolarAuraWrapper {...props} />;
  }
  return <FallbackSculptedAura {...props} />;
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
  sphereShell: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  circle: {
    position: 'absolute',
  },
});
