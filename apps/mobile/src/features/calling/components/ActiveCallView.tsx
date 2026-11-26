import React, { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CallChatMessage, CallConnectionState } from '../hooks/useLiveKitCall';
import { AudioBarsVisualizer } from './AudioBarsVisualizer';
import { CallChatDrawer } from './CallChatDrawer';
import { ChatIcon, HangupIcon, MicIcon, SpeakerIcon } from './CallIcons';

interface ActiveCallViewProps {
  status: CallConnectionState;
  audioLevel: number;
  elapsedSeconds: number;
  isMuted: boolean;
  isSpeakerOn: boolean;
  error: string | null;
  messages: CallChatMessage[];
  onSendMessage: (text: string) => Promise<void>;
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
  messages,
  onSendMessage,
  onToggleMute,
  onToggleSpeaker,
  onEndCall,
}: ActiveCallViewProps) {
  const [chatOpen, setChatOpen] = useState(false);

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
        {chatOpen ? (
          <CallChatDrawer messages={messages} onSend={onSendMessage} />
        ) : (
          <AudioBarsVisualizer status={status} audioLevel={audioLevel} />
        )}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      <View style={styles.controlBar}>
        <Pressable
          style={[styles.iconBtn, isMuted && styles.iconBtnActive]}
          onPress={onToggleMute}
          accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          <MicIcon color={isMuted ? '#000000' : '#FAFAFA'} muted={isMuted} />
        </Pressable>

        {Platform.OS !== 'web' ? (
          <Pressable
            style={[styles.iconBtn, isSpeakerOn && styles.iconBtnActive]}
            onPress={onToggleSpeaker}
            accessibilityLabel={isSpeakerOn ? 'Switch to earpiece' : 'Switch to speaker'}
          >
            <SpeakerIcon color={isSpeakerOn ? '#000000' : '#FAFAFA'} active={isSpeakerOn} />
          </Pressable>
        ) : null}

        <Pressable
          style={[styles.iconBtn, chatOpen && styles.iconBtnActive]}
          onPress={() => setChatOpen((prev) => !prev)}
          accessibilityLabel={chatOpen ? 'Hide live chat' : 'Show live chat'}
        >
          <ChatIcon color={chatOpen ? '#000000' : '#FAFAFA'} />
        </Pressable>

        <Pressable
          style={styles.endBtn}
          onPress={onEndCall}
          accessibilityLabel="End call"
        >
          <HangupIcon color="#FFFFFF" />
          <Text style={styles.endBtnText}>END</Text>
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
  endBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
