import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AgentAudioVisualizerAura } from '../../../components/AgentAudioVisualizerAura';
import { CallSession } from '../../../types/database';

interface IncomingCallModalProps {
  session: CallSession | null;
  processing: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function IncomingCallModal({
  session,
  processing,
  onAccept,
  onDecline,
}: IncomingCallModalProps) {
  return (
    <Modal
      visible={Boolean(session)}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={onDecline}
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
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
              pressed && styles.endButtonPressed,
              processing && styles.buttonDisabled,
            ]}
            onPress={onDecline}
            disabled={processing}
            accessibilityRole="button"
            accessibilityLabel="End"
          >
            <Text style={styles.buttonText}>End</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.answerButton,
              pressed && styles.answerButtonPressed,
              processing && styles.buttonDisabled,
            ]}
            onPress={onAccept}
            disabled={processing}
            accessibilityRole="button"
            accessibilityLabel="Answer"
          >
            {processing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>Answer</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingBottom: 40,
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
    gap: 16,
    width: '100%',
    maxWidth: 340,
  },
  button: {
    flex: 1,
    height: 56,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endButton: {
    backgroundColor: '#DC2626',
  },
  endButtonPressed: {
    backgroundColor: '#B91C1C',
  },
  answerButton: {
    backgroundColor: '#10B981',
  },
  answerButtonPressed: {
    backgroundColor: '#059669',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
