import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AgentAudioVisualizerAura } from '../../../components/AgentAudioVisualizerAura';
import { MONO, RADIUS, TYPE } from '../../../theme/monoTheme';
import { CallSession } from '../../../types/database';

interface IncomingCallModalProps {
  session: CallSession | null;
  processing: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * Full-screen in-window incoming call overlay.
 * Avoids RN <Modal> (which spawns a separate Android Dialog window without
 * showWhenLocked), eliminating lock-screen flicker/blink on Android 14–16.
 */
export function IncomingCallModal({
  session,
  processing,
  onAccept,
  onDecline,
}: IncomingCallModalProps) {
  const visible = Boolean(session);
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (!visible) {
      opacity.setValue(0);
      return;
    }
    Animated.timing(opacity, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [opacity, visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!processing) {
        onDecline();
      }
      return true;
    });
    return () => sub.remove();
  }, [onDecline, processing, visible]);

  if (!session) {
    return null;
  }

  const subtitle =
    session.title && session.title !== 'Kallie' ? session.title : 'Incoming voice call';

  return (
    <Animated.View style={[styles.overlay, { opacity }]} pointerEvents="auto">
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.callerName}>Kallie</Text>
          <Text style={styles.callerSubtitle} numberOfLines={2}>
            {processing ? 'Connecting…' : subtitle}
          </Text>
        </View>

        <View style={styles.auraStage}>
          <AgentAudioVisualizerAura
            size="xl"
            connectionStatus={processing ? 'connected' : 'connecting'}
            state="speaking"
            audioLevel={processing ? 0.54 : 0.38}
          />
        </View>

        <View style={styles.actionsRow}>
          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.endButton,
              pressed && styles.pressed,
              processing && styles.buttonDisabled,
            ]}
            onPress={onDecline}
            disabled={processing}
            accessibilityRole="button"
            accessibilityLabel="Decline"
          >
            <Text style={styles.endText}>Decline</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.answerButton,
              pressed && styles.pressed,
              processing && styles.buttonDisabled,
            ]}
            onPress={onAccept}
            disabled={processing}
            accessibilityRole="button"
            accessibilityLabel="Answer"
          >
            {processing ? (
              <ActivityIndicator size="small" color={MONO.black} />
            ) : (
              <Text style={styles.answerText}>Answer</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: MONO.bg,
    zIndex: 200,
    elevation: 200,
  },
  container: {
    flex: 1,
    backgroundColor: MONO.bg,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 48,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    gap: 6,
  },
  callerName: {
    color: MONO.white,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  callerSubtitle: {
    color: MONO.textSecondary,
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  auraStage: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    width: '100%',
    maxWidth: 340,
  },
  button: {
    flex: 1,
    height: 54,
    borderRadius: RADIUS.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endButton: {
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.borderStrong,
  },
  answerButton: {
    backgroundColor: MONO.white,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  endText: {
    ...TYPE.label,
    fontSize: 15,
    color: MONO.white,
  },
  answerText: {
    ...TYPE.button,
    fontSize: 15,
    color: MONO.black,
  },
});
