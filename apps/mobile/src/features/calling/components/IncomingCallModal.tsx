import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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
    <Modal visible={Boolean(session)} animationType="fade" transparent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.pulseOuter}>
            <View style={styles.pulseDot} />
          </View>

          <Text style={styles.incomingLabel}>KALLIE IS CALLING</Text>
          <Text style={styles.title}>{session?.title || 'Scheduled Callback'}</Text>
          <Text style={styles.prompt} numberOfLines={3}>
            {session?.ai_prompt}
          </Text>

          <View style={styles.actions}>
            <Pressable
              style={[styles.btn, styles.declineBtn]}
              onPress={onDecline}
              disabled={processing}
            >
              <Text style={styles.btnText}>DECLINE</Text>
            </Pressable>

            <Pressable
              style={[styles.btn, styles.acceptBtn]}
              onPress={onAccept}
              disabled={processing}
            >
              {processing ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.btnText}>ANSWER</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#0A0A0A',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  pulseOuter: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  pulseDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#34D399',
  },
  incomingLabel: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  title: {
    color: '#FAFAFA',
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  prompt: {
    color: '#A1A1AA',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 24,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
  },
  declineBtn: {
    backgroundColor: '#DC2626',
  },
  acceptBtn: {
    backgroundColor: '#059669',
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
