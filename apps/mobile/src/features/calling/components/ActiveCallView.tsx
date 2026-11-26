import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDynamicIsland } from '../../../components/DynamicIslandBar';
import {
  AgentVisualizerState,
  CallChatMessage,
  CallConnectionState,
} from '../hooks/useLiveKitCall';
import { AgentAuraVisualizer } from './AgentAuraVisualizer';
import { AgentChatTranscript } from './AgentChatTranscript';
import { ChatIcon, HangupIcon, MicIcon, SendIcon, SpeakerIcon } from './CallIcons';

interface ActiveCallViewProps {
  status: CallConnectionState;
  agentState: AgentVisualizerState;
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
  agentState,
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
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const { setCallInfo } = useDynamicIsland();

  const resolvedState: AgentVisualizerState =
    status === 'connecting' ? 'connecting' : agentState;

  useEffect(() => {
    setCallInfo({
      active: true,
      timer: formatDuration(elapsedSeconds),
      agentState: resolvedState,
      audioLevel,
    });
  }, [audioLevel, elapsedSeconds, resolvedState, setCallInfo]);

  useEffect(() => {
    return () => {
      setCallInfo({ active: false });
    };
  }, [setCallInfo]);

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setDraft('');
    try {
      await onSendMessage(trimmed);
    } finally {
      setSending(false);
    }
  };

  const canSend = Boolean(draft.trim()) && !sending;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {/* Top clearance for the Dynamic Island pill (scaled-down Aura + timer) */}
        <View style={styles.topClearance} />

        {/* Main Stage: Pure centered Aura OR borderless live transcript */}
        {chatOpen ? (
          <View style={styles.transcriptStage}>
            <AgentChatTranscript messages={messages} agentState={resolvedState} />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        ) : (
          <View style={styles.auraStage}>
            <AgentAuraVisualizer
              state={resolvedState}
              audioLevel={audioLevel}
              size="lg"
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        )}

        {/* Minimalist floating Control Bar */}
        <View style={styles.controlDock}>
          {chatOpen ? (
            <View style={styles.composerRow}>
              <TextInput
                style={styles.composerInput}
                value={draft}
                onChangeText={setDraft}
                placeholder="Type something..."
                placeholderTextColor="#71717A"
                returnKeyType="send"
                onSubmitEditing={handleSend}
                editable={!sending}
              />
              <Pressable
                style={({ pressed }) => [
                  styles.sendBtn,
                  canSend && styles.sendBtnReady,
                  pressed && canSend && styles.sendBtnPressed,
                ]}
                onPress={handleSend}
                disabled={!canSend}
                accessibilityLabel="Send message"
              >
                <SendIcon color={canSend ? '#000000' : '#71717A'} />
              </Pressable>
            </View>
          ) : null}

          <View style={styles.controlActions}>
            <View style={styles.leftActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.actionBtn,
                  isMuted && styles.actionBtnMuted,
                  pressed && styles.actionBtnPressed,
                ]}
                onPress={onToggleMute}
                accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                <MicIcon color={isMuted ? '#F87171' : '#FAFAFA'} muted={isMuted} />
              </Pressable>

              {Platform.OS !== 'web' ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    isSpeakerOn && styles.actionBtnSpeakerOn,
                    pressed && styles.actionBtnPressed,
                  ]}
                  onPress={onToggleSpeaker}
                  accessibilityLabel={isSpeakerOn ? 'Switch to earpiece' : 'Switch to speaker'}
                >
                  <SpeakerIcon color="#FAFAFA" active={isSpeakerOn} />
                </Pressable>
              ) : null}

              <Pressable
                style={({ pressed }) => [
                  styles.actionBtn,
                  chatOpen && styles.actionBtnChatOpen,
                  pressed && styles.actionBtnPressed,
                ]}
                onPress={() => setChatOpen((prev) => !prev)}
                accessibilityLabel={chatOpen ? 'Hide transcript' : 'Show transcript'}
              >
                <ChatIcon color={chatOpen ? '#1FD5F9' : '#FAFAFA'} />
              </Pressable>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.endBtn,
                pressed && styles.endBtnPressed,
              ]}
              onPress={onEndCall}
              accessibilityLabel="End call"
            >
              <HangupIcon color="#F87171" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  flex: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  topClearance: {
    height: 54,
  },
  auraStage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  transcriptStage: {
    flex: 1,
    width: '100%',
    paddingBottom: 10,
  },
  errorText: {
    color: '#F87171',
    fontSize: 13,
    marginTop: 18,
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 19,
  },
  controlDock: {
    width: '100%',
    backgroundColor: '#0A0A0C',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 28,
    padding: 10,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
    marginBottom: 10,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  composerInput: {
    flex: 1,
    color: '#FAFAFA',
    fontSize: 15,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1C1C20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnReady: {
    backgroundColor: '#1FD5F9',
  },
  sendBtnPressed: {
    backgroundColor: '#67E8F9',
  },
  controlActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnPressed: {
    opacity: 0.8,
  },
  actionBtnMuted: {
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  actionBtnSpeakerOn: {
    backgroundColor: '#222226',
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  actionBtnChatOpen: {
    backgroundColor: 'rgba(31, 213, 249, 0.16)',
    borderColor: 'rgba(31, 213, 249, 0.42)',
  },
  endBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  endBtnPressed: {
    backgroundColor: 'rgba(239, 68, 68, 0.32)',
  },
});
