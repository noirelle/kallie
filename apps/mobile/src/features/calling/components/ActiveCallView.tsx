import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
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

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface AgentControlBarControls {
  leave?: boolean;
  microphone?: boolean;
  screenShare?: boolean;
  camera?: boolean;
  chat?: boolean;
}

interface ActiveCallViewProps {
  isSessionActive?: boolean;
  isCallReady?: boolean;
  status: CallConnectionState;
  agentState: AgentVisualizerState;
  audioLevel: number;
  elapsedSeconds: number;
  isMuted: boolean;
  isCameraOn?: boolean;
  isScreenShareOn?: boolean;
  error: string | null;
  messages: CallChatMessage[];
  controls?: AgentControlBarControls;
  onStartCall?: () => void;
  onSendMessage: (text: string) => Promise<void>;
  onToggleMute: () => void;
  onToggleCamera?: () => void;
  onToggleScreenShare?: () => void;
  onEndCall: () => void;
}

const DEFAULT_CONTROLS: Required<AgentControlBarControls> = {
  leave: true,
  microphone: true,
  screenShare: false,
  camera: false,
  chat: true,
};

export function ActiveCallView({
  isSessionActive = true,
  isCallReady = true,
  status,
  agentState,
  audioLevel,
  isMuted,
  isCameraOn = false,
  isScreenShareOn = false,
  error,
  messages,
  controls = DEFAULT_CONTROLS,
  onStartCall,
  onSendMessage,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  onEndCall,
}: ActiveCallViewProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  // Separate smooth GPU animations:
  // - promptAnim fades out immediately on tap (0ms latency)
  // - dockAnim glides in only once the AI agent is actually connected & ready
  const promptAnim = useRef(new Animated.Value(isSessionActive ? 0 : 1)).current;
  const dockAnim = useRef(
    new Animated.Value(isSessionActive && isCallReady ? 1 : 0),
  ).current;

  const showControls = isSessionActive && isCallReady;

  useEffect(() => {
    if (!showControls && chatOpen) {
      Keyboard.dismiss();
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setChatOpen(false);
      setDraft('');
    }

    Animated.parallel([
      Animated.timing(promptAnim, {
        toValue: isSessionActive ? 0 : 1,
        duration: isSessionActive ? 200 : 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(dockAnim, {
        toValue: showControls ? 1 : 0,
        duration: showControls ? 280 : 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [chatOpen, dockAnim, isSessionActive, promptAnim, showControls]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setAndroidKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setAndroidKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const activeControls = { ...DEFAULT_CONTROLS, ...controls };
  const resolvedState: AgentVisualizerState = !isSessionActive
    ? 'idle'
    : !isCallReady || status === 'connecting'
      ? 'connecting'
      : agentState;
  const isConnected = status === 'connected' || status === 'agent_speaking';

  const handleToggleChat = () => {
    LayoutAnimation.configureNext({
      duration: 240,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      create: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      delete: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
    });
    setChatOpen((prev) => {
      if (prev) Keyboard.dismiss();
      return !prev;
    });
  };

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

  const promptOpacity = promptAnim;

  const promptTranslateY = promptAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });

  const dockOpacity = dockAnim;

  const dockTranslateY = dockAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [28, 0],
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={[
          styles.flex,
          Platform.OS === 'android' &&
            androidKeyboardHeight > 0 && {
              paddingBottom: androidKeyboardHeight + 12,
            },
        ]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {/* Main Stage: Single persistent Aura transitions seamlessly between idle, active, and raised-chat */}
        <View style={[styles.stage, chatOpen && styles.stageTranscript]}>
          <Pressable
            onPress={!isSessionActive ? onStartCall : !isCallReady ? onEndCall : undefined}
            disabled={showControls}
            style={({ pressed }) => [
              chatOpen ? styles.raisedAuraHeader : styles.auraWrap,
              !showControls && pressed && styles.auraPressed,
            ]}
            accessibilityLabel={
              !isSessionActive
                ? 'Tap Aura to talk'
                : !isCallReady
                  ? 'Connecting to Kallie, tap to cancel'
                  : 'Kallie Aura visualizer'
            }
          >
            <AgentAuraVisualizer
              state={resolvedState}
              audioLevel={isSessionActive ? audioLevel : 0.1}
              size={chatOpen ? 'sm' : 'lg'}
            />
          </Pressable>

          {!chatOpen ? (
            <Animated.View
              style={[
                styles.promptWrap,
                {
                  opacity: promptOpacity,
                  transform: [{ translateY: promptTranslateY }],
                },
              ]}
              pointerEvents="none"
            >
              <Text style={styles.promptText}>Tap Aura to talk.</Text>
            </Animated.View>
          ) : null}

          {chatOpen ? (
            <View style={styles.transcriptBody}>
              <AgentChatTranscript messages={messages} agentState={resolvedState} />
            </View>
          ) : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        {/* Smoothly animated LiveKit Control Bar */}
        <Animated.View
          style={[
            styles.controlDock,
            {
              opacity: dockOpacity,
              transform: [{ translateY: dockTranslateY }],
            },
          ]}
          pointerEvents={showControls ? 'auto' : 'none'}
        >
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

              {activeControls.camera && onToggleCamera ? (
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

              {activeControls.screenShare && onToggleScreenShare ? (
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
                  onPress={handleToggleChat}
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
        </Animated.View>
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
  stage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  stageTranscript: {
    justifyContent: 'flex-start',
    paddingBottom: 10,
  },
  auraWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  auraPressed: {
    transform: [{ scale: 0.95 }],
  },
  promptWrap: {
    marginTop: 22,
  },
  promptText: {
    color: '#71717A',
    fontSize: 14,
    fontWeight: '400',
    letterSpacing: -0.1,
    textAlign: 'center',
  },
  raisedAuraHeader: {
    width: '100%',
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
    marginTop: 16,
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
