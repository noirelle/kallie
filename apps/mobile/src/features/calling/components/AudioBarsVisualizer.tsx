import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { CallConnectionState } from '../hooks/useLiveKitCall';

interface AudioBarsVisualizerProps {
  status: CallConnectionState;
  audioLevel: number;
}

const BAR_WEIGHTS = [0.45, 0.78, 1.0, 0.78, 0.45];

export function AudioBarsVisualizer({ status, audioLevel }: AudioBarsVisualizerProps) {
  const animValues = useRef(BAR_WEIGHTS.map(() => new Animated.Value(16))).current;

  useEffect(() => {
    let running = true;

    const tick = () => {
      if (!running) return;
      const isSpeaking = status === 'agent_speaking';
      const isConnecting = status === 'connecting';

      const animations = animValues.map((val, idx) => {
        const weight = BAR_WEIGHTS[idx];
        const targetHeight = isSpeaking
          ? Math.max(18, Math.min(116, (28 + audioLevel * 88) * weight * (0.75 + Math.random() * 0.45)))
          : isConnecting
            ? 16 + ((idx % 2 === 0 ? 18 : 8) * (0.6 + Math.random() * 0.4))
            : 14 + weight * 12;

        return Animated.timing(val, {
          toValue: targetHeight,
          duration: isSpeaking ? 130 : 320,
          useNativeDriver: false,
        });
      });

      Animated.parallel(animations).start(() => {
        if (running) {
          tick();
        }
      });
    };

    tick();

    return () => {
      running = false;
      animValues.forEach((val) => val.stopAnimation());
    };
  }, [animValues, audioLevel, status]);

  const activeColor = status === 'agent_speaking' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.38)';

  return (
    <View style={styles.container}>
      {animValues.map((height, idx) => (
        <Animated.View
          key={idx}
          style={[
            styles.bar,
            {
              height,
              backgroundColor: activeColor,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 140,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  bar: {
    width: 10,
    borderRadius: 999,
  },
});
