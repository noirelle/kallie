import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CallConnectionState } from '../hooks/useLiveKitCall';
import { AudioBarsVisualizer } from './AudioBarsVisualizer';

interface ActiveCallViewProps {
  status: CallConnectionState;
  audioLevel: number;
  elapsedSeconds: number;
  isMuted: boolean;
  isSpeakerOn: boolean;
  error: string | null;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onEndCall: () => void;
}

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function ActiveCallView({
  status,
  audioLevel,
  elapsedSeconds,
  isMuted,
  isSpeakerOn,
  error,
  onToggleMute,
  onToggleSpeaker,
  onEndCall,
}: ActiveCallViewProps) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Image
          source={require('../../../../assets/icon.png')}
          style={styles.topLogo}
          resizeMode="contain"
        />
        <Text style={styles.timer}>
          {status === 'connecting' ? 'CONNECTING' : formatDuration(elapsedSeconds)}
        </Text>
      </View>

      <View style={styles.center}>
        <AudioBarsVisualizer status={status} audioLevel={audioLevel} />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      <View style={styles.controlBar}>
        <Pressable
          style={[styles.iconBtn, isMuted && styles.iconBtnActive]}
          onPress={onToggleMute}
          accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          <Ionicons
            name={isMuted ? 'mic-off' : 'mic'}
            size={22}
            color={isMuted ? '#000000' : '#FAFAFA'}
          />
        </Pressable>

        {Platform.OS !== 'web' ? (
          <Pressable
            style={[styles.iconBtn, isSpeakerOn && styles.iconBtnActive]}
            onPress={onToggleSpeaker}
            accessibilityLabel={isSpeakerOn ? 'Switch to earpiece' : 'Switch to speaker'}
          >
            <Ionicons
              name={isSpeakerOn ? 'volume-high' : 'volume-low'}
              size={22}
              color={isSpeakerOn ? '#000000' : '#FAFAFA'}
            />
          </Pressable>
        ) : null}

        <Pressable
          style={styles.endBtn}
          onPress={onEndCall}
          accessibilityLabel="End call"
        >
          <Ionicons name="call" size={20} color="#FFFFFF" style={styles.hangupIcon} />
          <Text style={styles.endBtnText}>END CALL</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 12,
  },
  topBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  topLogo: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  timer: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    fontVariant: ['tabular-nums'],
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
    lineHeight: 19,
  },
  controlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
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
  iconBtnActive: {
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
