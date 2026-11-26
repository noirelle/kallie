import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CallConnectionState } from '../hooks/useLiveKitCall';
import { AudioBarsVisualizer } from './AudioBarsVisualizer';

interface ActiveCallViewProps {
  status: CallConnectionState;
  audioLevel: number;
  isMuted: boolean;
  error: string | null;
  onToggleMute: () => void;
  onEndCall: () => void;
}

export function ActiveCallView({
  status,
  audioLevel,
  isMuted,
  error,
  onToggleMute,
  onEndCall,
}: ActiveCallViewProps) {
  return (
    <View style={styles.container}>
      <View style={styles.center}>
        <AudioBarsVisualizer status={status} audioLevel={audioLevel} />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      <View style={styles.controlBar}>
        <Pressable
          style={[styles.iconBtn, isMuted && styles.iconBtnMuted]}
          onPress={onToggleMute}
          accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          <Ionicons
            name={isMuted ? 'mic-off' : 'mic'}
            size={22}
            color={isMuted ? '#000000' : '#FAFAFA'}
          />
        </Pressable>

        <Pressable
          style={styles.endBtn}
          onPress={onEndCall}
          accessibilityLabel="End call"
        >
          <Ionicons name="call" size={20} color="#FFFFFF" style={styles.hangupIcon} />
          <Text style={styles.endBtnText}>END CALL</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 44,
    paddingTop: 48,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  errorText: {
    color: '#F87171',
    fontSize: 13,
    marginTop: 20,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  controlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#161616',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtnMuted: {
    backgroundColor: '#FAFAFA',
  },
  endBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    paddingHorizontal: 22,
    height: 48,
    borderRadius: 999,
  },
  hangupIcon: {
    transform: [{ rotate: '135deg' }],
  },
  endBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
