import React, { useState } from 'react';
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
import {
  AgentVisualizerState,
  CallChatMessage,
  CallConnectionState,
} from '../hooks/useLiveKitCall';
import { AgentAuraVisualizer } from './AgentAuraVisualizer';
import { AgentChatTranscript } from './AgentChatTranscript';
import {
  CameraIcon,
  ChatIcon,
  HangupIcon,
  MicIcon,
  ScreenShareIcon,
  SendIcon,
} from './CallIcons';

export interface AgentControlBarControls {
  leave?: boolean;
  microphone?: boolean;
  screenShare?: boolean;
  camera?: boolean;
  chat?: boolean;
}

interface ActiveCallViewProps {
  status: CallConnectionState;
  agentState: AgentVisualizerState;
  audioLevel: number;
  elapsedSeconds: number;
  isMuted: boolean;
  isCameraOn: boolean;
  isScreenShareOn: boolean;
  error: string | null;
  messages: CallChatMessage[];
  controls?: AgentControlBarControls;
  onSendMessage: (text: string) => Promise<void>;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onEndCall: () => void;
}

const DEFAULT_CONTROLS: Required<AgentControlBarControls> = {
  leave: true,
  microphone: true,
  screenShare: true,
  camera: true,
  chat: true,
};

export function ActiveCallView({
  status,
  agentState,
  audioLevel,
  isMuted,
  isCameraOn,
  isScreenShareOn,
  error,
  messages,
  controls = DEFAULT_CONTROLS,
  onSendMessage,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  onEndCall,
}: ActiveCallViewProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const activeControls = { ...DEFAULT_CONTROLS, ...controls };
  const resolvedState: AgentVisualizerState =
    status === 'connecting' ? 'connecting' : agentState;
  const isConnected = status === 'connected' || status === 'agent_speaking';

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

  const canSend = Boolean(draft.trim()) && !sending && isConnected;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {/* Main Stage: Centered Aura rises cleanly to the top when chat opens */}
        {chatOpen ? (
          <View style={styles.transcriptStage}>
            <View style={styles.raisedAuraHeader}>
              <AgentAuraVisualizer
                state={resolvedState}
                audioLevel={audioLevel}
                size="sm"
              />
            </View>

            <View style={styles.transcriptBody}>
              <AgentChatTranscript messages={messages} agentState={resolvedState} />
            </View>
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

        {/* LiveKit AgentControlBar (variant="livekit"): mic, camera, screenShare, chat, leave */}
        <View style={styles.controlDock}>
          {chatOpen && activeControls.chat ? (
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
              {activeControls.microphone ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    isMuted && styles.actionBtnDanger,
                    pressed && styles.actionBtnPressed,
                  ]}
                  onPress={onToggleMute}
                  accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                >
                  <MicIcon color={isMuted ? '#F87171' : '#FAFAFA'} muted={isMuted} />
                </Pressable>
              ) : null}

              {activeControls.camera ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    isCameraOn && styles.actionBtnActive,
                    pressed && styles.actionBtnPressed,
                  ]}
                  onPress={onToggleCamera}
                  accessibilityLabel={isCameraOn ? 'Turn off camera' : 'Turn on camera'}
                >
                  <CameraIcon
                    color={isCameraOn ? '#1FD5F9' : '#FAFAFA'}
                    enabled={isCameraOn}
                  />
                </Pressable>
              ) : null}

              {activeControls.screenShare ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    isScreenShareOn && styles.actionBtnActive,
                    pressed && styles.actionBtnPressed,
                  ]}
                  onPress={onToggleScreenShare}
                  accessibilityLabel={
                    isScreenShareOn ? 'Stop screen share' : 'Share screen'
                  }
                >
                  <ScreenShareIcon
                    color={isScreenShareOn ? '#1FD5F9' : '#FAFAFA'}
                  />
                </Pressable>
              ) : null}

              {activeControls.chat ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    chatOpen && styles.actionBtnActive,
                    pressed && styles.actionBtnPressed,
                  ]}
                  onPress={() => setChatOpen((prev) => !prev)}
                  accessibilityLabel={chatOpen ? 'Hide transcript' : 'Show transcript'}
                >
                  <ChatIcon color={chatOpen ? '#1FD5F9' : '#FAFAFA'} />
                </Pressable>
              ) : null}
            </View>

            {activeControls.leave ? (
              <Pressable
                style={({ pressed }) => [
                  styles.endBtn,
                  pressed && styles.endBtnPressed,
                ]}
                onPress={onEndCall}
                accessibilityLabel="Leave call"
              >
                <HangupIcon color="#F87171" />
              </Pressable>
            ) : null}
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
    paddingTop: 12,
    paddingBottom: 20,
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
  raisedAuraHeader: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  transcriptBody: {
    flex: 1,
    width: '100%',
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
    backgroundColor: '#0A0A0D',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 31,
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
    gap: 8,
  },
  actionBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnPressed: {
    opacity: 0.8,
  },
  actionBtnDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  actionBtnActive: {
    backgroundColor: 'rgba(31, 213, 249, 0.16)',
    borderColor: 'rgba(31, 213, 249, 0.42)',
  },
  endBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
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
