import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AgentAudioVisualizerAura } from '../../../components/AgentAudioVisualizerAura';
import { AuraConnectionStatus } from '../../../components/auraTheme';
import {
  AgentVisualizerState,
  CallChatMessage,
  CallConnectionState,
} from '../hooks/useLiveKitCall';
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
  isSessionActive?: boolean;
  isCallReady?: boolean;
  status: CallConnectionState;
  agentState: AgentVisualizerState;
  connectionStatus?: AuraConnectionStatus;
  audioLevel: number;
  elapsedSeconds: number;
  isMuted: boolean;
  isCameraOn?: boolean;
  isScreenShareOn?: boolean;
  error: string | null;
  messages: CallChatMessage[];
  controls?: AgentControlBarControls;
  showPermissionIndicator?: boolean;
  microphoneMissing?: boolean;
  onOpenPermissions?: () => void;
  onStartCall?: () => void;
  onStartCallPressIn?: () => void;
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

/**
 * Pure GPU-animated Voice & Transcript Canvas:
 * - One persistent `AgentAudioVisualizerAura` smoothly scales and glides via
 *   native transforms (never unmounted or resized on state/chat transitions).
 * - Zero LayoutAnimation conflicts, zero freeze when ending a call with chat open.
 */
export function ActiveCallView({
  isSessionActive = true,
  isCallReady = true,
  status,
  agentState,
  connectionStatus = 'idle',
  audioLevel,
  isMuted,
  isCameraOn = false,
  isScreenShareOn = false,
  error,
  messages,
  controls = DEFAULT_CONTROLS,
  showPermissionIndicator = false,
  microphoneMissing = false,
  onOpenPermissions,
  onStartCall,
  onStartCallPressIn,
  onSendMessage,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  onEndCall,
}: ActiveCallViewProps) {
  const { height: windowHeight } = useWindowDimensions();
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  const showControls = isSessionActive && isCallReady;
  const showTranscript = showControls && chatOpen;

  // All 3 transitions run strictly on the native GPU driver (60fps, zero JS lockups)
  const promptAnim = useRef(new Animated.Value(isSessionActive ? 0 : 1)).current;
  const dockAnim = useRef(new Animated.Value(showControls ? 1 : 0)).current;
  const chatAnim = useRef(new Animated.Value(showTranscript ? 1 : 0)).current;

  useEffect(() => {
    if (!showControls && chatOpen) {
      Keyboard.dismiss();
      setChatOpen(false);
      setDraft('');
    }
  }, [chatOpen, showControls]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(promptAnim, {
        toValue: isSessionActive ? 0 : 1,
        duration: isSessionActive ? 190 : 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(dockAnim, {
        toValue: showControls ? 1 : 0,
        duration: showControls ? 280 : 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(chatAnim, {
        toValue: showTranscript ? 1 : 0,
        duration: showTranscript ? 280 : 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [chatAnim, dockAnim, isSessionActive, promptAnim, showControls, showTranscript]);

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

  const effectiveConnectionStatus: AuraConnectionStatus =
    error || connectionStatus === 'disconnected'
      ? 'disconnected'
      : connectionStatus === 'weak'
        ? 'weak'
        : !isSessionActive
          ? 'idle'
          : !isCallReady || status === 'connecting'
            ? 'connecting'
            : 'connected';

  const isConnected = status === 'connected' || status === 'agent_speaking';

  const handleToggleChat = useCallback(() => {
    setChatOpen((prev) => {
      if (prev) Keyboard.dismiss();
      return !prev;
    });
  }, []);

  const handleEndPress = useCallback(() => {
    Keyboard.dismiss();
    setChatOpen(false);
    setDraft('');
    onEndCall();
  }, [onEndCall]);

  const handleSend = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setDraft('');
    try {
      await onSendMessage(trimmed);
    } finally {
      setSending(false);
    }
  }, [draft, onSendMessage, sending]);

  const canSend = Boolean(draft.trim()) && !sending && isConnected;

  // Distance Aura smoothly glides upward when transcript opens
  const raisedTranslateY = -Math.round(Math.max(210, windowHeight * 0.36));

  const auraTranslateY = chatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, raisedTranslateY],
  });

  const auraScale = chatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.3],
  });

  const transcriptTranslateY = chatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });

  const promptTranslateY = promptAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });

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
        {/* Permission indicator — strictly hidden when all required permissions are granted */}
        {!isSessionActive && showPermissionIndicator && onOpenPermissions ? (
          <View style={styles.idleTopBar} pointerEvents="box-none">
            <Pressable
              style={({ pressed }) => [
                styles.permissionsPill,
                styles.permissionsPillAlert,
                pressed && styles.permissionsPillPressed,
              ]}
              onPress={onOpenPermissions}
              hitSlop={8}
              accessibilityLabel="Required permission missing. Open permission settings."
            >
              <View style={styles.alertDot} />
              <Text style={styles.permissionsPillText}>Permissions</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Persistent Centered Aura Layer — smoothly scales & glides via pure GPU transforms */}
        <View style={styles.auraBackdrop} pointerEvents="box-none">
          <Animated.View
            style={[
              styles.auraAnimatedBox,
              {
                transform: [{ translateY: auraTranslateY }, { scale: auraScale }],
              },
            ]}
          >
            <Pressable
              onPressIn={!isSessionActive ? onStartCallPressIn : undefined}
              onPress={!isSessionActive ? onStartCall : !isCallReady ? handleEndPress : undefined}
              disabled={showControls}
              style={({ pressed }) => [
                styles.auraTouch,
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
              <AgentAudioVisualizerAura
                size="xl"
                connectionStatus={effectiveConnectionStatus}
                state={resolvedState}
                audioLevel={isSessionActive ? audioLevel : 0.14}
                colorShift={0.3}
                themeMode="dark"
              />
            </Pressable>
          </Animated.View>

          <Animated.View
            style={[
              styles.promptWrap,
              {
                opacity: promptAnim,
                transform: [{ translateY: promptTranslateY }],
              },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.promptText}>
              {microphoneMissing
                ? 'Tap Aura to allow microphone & talk.'
                : 'Tap Aura to talk.'}
            </Text>
          </Animated.View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        {/* Borderless Real-Time Chat Transcript Layer — mounted lazily when call controls & chat/messages are active */}
        {showControls && (chatOpen || messages.length > 0) ? (
          <Animated.View
            style={[
              styles.transcriptLayer,
              {
                opacity: chatAnim,
                transform: [{ translateY: transcriptTranslateY }],
              },
            ]}
            pointerEvents={showTranscript ? 'auto' : 'none'}
          >
            <AgentChatTranscript messages={messages} agentState={resolvedState} />
          </Animated.View>
        ) : null}

        {/* Smoothly animated LiveKit Control Bar */}
        <Animated.View
          style={[
            styles.controlDock,
            {
              opacity: dockAnim,
              transform: [{ translateY: dockTranslateY }],
            },
          ]}
          pointerEvents={showControls ? 'auto' : 'none'}
        >
          {showTranscript && activeControls.chat ? (
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
                onPress={handleEndPress}
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
    justifyContent: 'flex-end',
  },
  idleTopBar: {
    position: 'absolute',
    top: 12,
    right: 20,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  permissionsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  permissionsPillAlert: {
    borderColor: 'rgba(245, 158, 11, 0.42)',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  permissionsPillPressed: {
    backgroundColor: '#18181B',
  },
  alertDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FBBF24',
  },
  permissionsPillText: {
    color: '#D4D4D8',
    fontSize: 12,
    fontWeight: '500',
  },
  auraBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  auraAnimatedBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  auraTouch: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  auraPressed: {
    transform: [{ scale: 0.96 }],
  },
  promptWrap: {
    position: 'absolute',
    top: '50%',
    marginTop: 158,
  },
  promptText: {
    color: '#71717A',
    fontSize: 14,
    fontWeight: '400',
    letterSpacing: -0.1,
    textAlign: 'center',
  },
  errorText: {
    position: 'absolute',
    bottom: 112,
    color: '#F87171',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 24,
    lineHeight: 19,
  },
  transcriptLayer: {
    flex: 1,
    width: '100%',
    marginTop: 108,
    marginBottom: 12,
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
