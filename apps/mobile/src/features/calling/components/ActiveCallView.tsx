import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AgentAudioVisualizerAura } from '../../../components/AgentAudioVisualizerAura';
import { AuraConnectionStatus } from '../../../components/auraTheme';
import { ChevronLeftIcon, SlidersIcon } from '../../../components/MonoIcons';
import { MonoPressable } from '../../../components/MonoUi';
import { MONO, MOTION, RADIUS, TYPE } from '../../../theme/monoTheme';
import { useActiveCallTranscript } from '../context/ActiveCallContext';
import {
  AgentVisualizerState,
  CallConnectionState,
} from '../hooks/useDirectVoiceSession';
import { nativeIncomingCall } from '../lib/nativeIncomingCall';
import { AgentChatTranscript } from './AgentChatTranscript';
import {
  ChatIcon,
  HangupIcon,
  MicIcon,
  SendIcon,
} from './CallIcons';

export interface AgentControlBarControls {
  leave?: boolean;
  microphone?: boolean;
  chat?: boolean;
}

interface ActiveCallViewProps {
  isSessionActive?: boolean;
  isCallReady?: boolean;
  status: CallConnectionState;
  agentState: AgentVisualizerState;
  connectionStatus?: AuraConnectionStatus;
  isMuted: boolean;
  error: string | null;
  controls?: AgentControlBarControls;
  screenFocused?: boolean;
  onOpenSettings?: () => void;
  onStartCall?: () => void;
  onStartCallPressIn?: () => void;
  onSendMessage: (text: string) => Promise<void>;
  onToggleMute: () => void;
  onEndCall: () => void;
}

const DEFAULT_CONTROLS: Required<AgentControlBarControls> = {
  leave: true,
  microphone: true,
  chat: true,
};

/**
 * Isolated subscriber to ActiveCallTranscriptContext so streaming word deltas only
 * re-render the transcript list when the drawer is actually open.
 */
const LiveCallTranscript = memo(function LiveCallTranscript({
  agentState,
}: {
  agentState: AgentVisualizerState;
}) {
  const messages = useActiveCallTranscript();
  return <AgentChatTranscript messages={messages} agentState={agentState} />;
});

/**
 * Minimalist Monochrome Aura Canvas:
 * - Uncluttered pure-black idle canvas centered on the living Aura (no idle message button).
 * - Tap Aura to talk; Hold Aura (460ms) with expanding concentric halo & sliders cue
 *   to smoothly transition into Settings.
 * - Active call Control Bar (Mic, Chat/Transcript, Hangup) appears smoothly while call is active.
 */
export const ActiveCallView = memo(function ActiveCallView({
  isSessionActive = true,
  isCallReady = true,
  status,
  agentState,
  connectionStatus = 'idle',
  isMuted,
  error,
  controls = DEFAULT_CONTROLS,
  screenFocused = true,
  onOpenSettings,
  onStartCall,
  onStartCallPressIn,
  onSendMessage,
  onToggleMute,
  onEndCall,
}: ActiveCallViewProps) {
  const { height: windowHeight } = useWindowDimensions();
  const [chatOpen, setChatOpen] = useState(false);
  const [transcriptMounted, setTranscriptMounted] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  const showControls = isSessionActive;
  const showTranscript = showControls && chatOpen;

  // Native GPU animations
  const dockAnim = useRef(new Animated.Value(showControls ? 1 : 0)).current;
  const chatAnim = useRef(new Animated.Value(showTranscript ? 1 : 0)).current;
  const holdAnim = useRef(new Animated.Value(0)).current;
  const stageOpacity = useRef(new Animated.Value(1)).current;

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTriggeredRef = useRef(false);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearHoldTimer();
  }, [clearHoldTimer]);

  // Smoothly restore Aura stage whenever user returns from Settings / Chat
  useEffect(() => {
    if (screenFocused) {
      holdTriggeredRef.current = false;
      holdAnim.setValue(0);
      Animated.timing(stageOpacity, {
        toValue: 1,
        duration: MOTION.normal,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [holdAnim, screenFocused, stageOpacity]);

  useEffect(() => {
    if (!showControls && chatOpen) {
      Keyboard.dismiss();
      setChatOpen(false);
      setDraft('');
    }
  }, [chatOpen, showControls]);

  useEffect(() => {
    if (showTranscript) {
      setTranscriptMounted(true);
    }
    Animated.parallel([
      Animated.timing(dockAnim, {
        toValue: showControls ? 1 : 0,
        duration: MOTION.normal,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(chatAnim, {
        toValue: showTranscript ? 1 : 0,
        duration: MOTION.normal,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished && !showTranscript) {
        setTranscriptMounted(false);
      }
    });
  }, [chatAnim, dockAnim, showControls, showTranscript]);

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

  const activeControls = useMemo(
    () => ({ ...DEFAULT_CONTROLS, ...controls }),
    [controls],
  );
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

  const handleAuraPressIn = useCallback(() => {
    if (isSessionActive) return;
    holdTriggeredRef.current = false;
    onStartCallPressIn?.();

    if (!onOpenSettings) return;

    Animated.timing(holdAnim, {
      toValue: 1,
      duration: MOTION.holdToSettingsMs,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

    clearHoldTimer();
    holdTimerRef.current = setTimeout(() => {
      holdTriggeredRef.current = true;
      Vibration.vibrate(14);
      Animated.timing(stageOpacity, {
        toValue: 0,
        duration: 160,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        onOpenSettings();
      });
    }, MOTION.holdToSettingsMs);
  }, [clearHoldTimer, holdAnim, isSessionActive, onOpenSettings, onStartCallPressIn, stageOpacity]);

  const handleAuraPressOut = useCallback(() => {
    clearHoldTimer();
    if (!holdTriggeredRef.current) {
      Animated.spring(holdAnim, {
        toValue: 0,
        useNativeDriver: true,
        ...MOTION.springSnappy,
      }).start();
    }
  }, [clearHoldTimer, holdAnim]);

  const handleAuraPress = useCallback(() => {
    if (holdTriggeredRef.current) {
      holdTriggeredRef.current = false;
      return;
    }
    if (!isSessionActive) {
      onStartCall?.();
    } else if (!isCallReady) {
      Keyboard.dismiss();
      setChatOpen(false);
      setDraft('');
      onEndCall();
    }
  }, [isCallReady, isSessionActive, onEndCall, onStartCall]);

  const handleMinimizeToBackground = useCallback(() => {
    Keyboard.dismiss();
    if (Platform.OS === 'android') {
      nativeIncomingCall.moveToBackground();
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android' || !isSessionActive || !screenFocused) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (chatOpen) {
        Keyboard.dismiss();
        setChatOpen(false);
        return true;
      }
      nativeIncomingCall.moveToBackground();
      return true;
    });
    return () => sub.remove();
  }, [chatOpen, isSessionActive, screenFocused]);

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
  const raisedTranslateY = -Math.round(Math.max(210, windowHeight * 0.36));

  const {
    auraTranslateY,
    auraChatScale,
    auraHoldScale,
    holdRingScale,
    holdRingOpacity,
    holdIconScale,
    holdIconOpacity,
    transcriptTranslateY,
    dockTranslateY,
  } = useMemo(
    () => ({
      auraTranslateY: chatAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, raisedTranslateY],
      }),
      auraChatScale: chatAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0.3],
      }),
      auraHoldScale: holdAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0.91],
      }),
      holdRingScale: holdAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.9, 1.16],
      }),
      holdRingOpacity: holdAnim.interpolate({
        inputRange: [0, 0.18, 1],
        outputRange: [0, 0.22, 0.88],
      }),
      holdIconScale: holdAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.76, 1.02],
      }),
      holdIconOpacity: holdAnim.interpolate({
        inputRange: [0, 0.22, 1],
        outputRange: [0, 0.16, 1],
      }),
      transcriptTranslateY: chatAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [18, 0],
      }),
      dockTranslateY: dockAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [24, 0],
      }),
    }),
    [chatAnim, dockAnim, holdAnim, raisedTranslateY],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Animated.View style={[styles.flexRoot, { opacity: stageOpacity }]}>
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
          {/* Top-left Telegram-style Back / Minimize button during active call */}
          {Platform.OS === 'android' && isSessionActive ? (
            <View style={styles.topBackWrap} pointerEvents="box-none">
              <MonoPressable
                style={styles.topBackBtn}
                scaleTo={0.92}
                onPress={handleMinimizeToBackground}
                accessibilityLabel="Minimize call to background"
              >
                <ChevronLeftIcon color={MONO.white} size={20} />
              </MonoPressable>
            </View>
          ) : null}

          {/* Persistent Centered Aura Layer */}
          <View style={styles.auraBackdrop} pointerEvents="box-none">
            <Animated.View
              style={[
                styles.auraAnimatedBox,
                {
                  transform: [
                    { translateY: auraTranslateY },
                    { scale: auraChatScale },
                  ],
                },
              ]}
            >
              {/* Expanding monochrome hold-to-settings halo */}
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.holdHaloRing,
                  {
                    opacity: holdRingOpacity,
                    transform: [{ scale: holdRingScale }],
                  },
                ]}
              />

              <Pressable
                onPressIn={handleAuraPressIn}
                onPressOut={handleAuraPressOut}
                onPress={handleAuraPress}
                disabled={isSessionActive && isCallReady}
                style={styles.auraTouch}
                accessibilityLabel={
                  !isSessionActive
                    ? 'Tap Aura to talk, or hold to open Settings'
                    : !isCallReady
                      ? 'Connecting, tap to cancel'
                      : 'Kallie Aura'
                }
              >
                <Animated.View style={{ transform: [{ scale: auraHoldScale }] }}>
                  <AgentAudioVisualizerAura
                    size="xl"
                    connectionStatus={effectiveConnectionStatus}
                    state={resolvedState}
                    liveAudio={isSessionActive}
                    audioLevel={0.14}
                    colorShift={0.3}
                  />
                </Animated.View>

                {/* Centered Sliders cue materializes while holding Aura */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.holdCenterCue,
                    {
                      opacity: holdIconOpacity,
                      transform: [{ scale: holdIconScale }],
                    },
                  ]}
                >
                  <SlidersIcon color={MONO.white} size={22} />
                </Animated.View>
              </Pressable>
            </Animated.View>

            {error ? (
              <View style={styles.errorPill}>
                <Text style={styles.errorText} numberOfLines={2}>
                  {error}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Real-Time Chat Transcript Layer (unmounted when hidden to avoid background FlatList churn) */}
          {showControls && transcriptMounted ? (
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
              <LiveCallTranscript agentState={resolvedState} />
            </Animated.View>
          ) : null}

          {/* Pure Monochrome Active Call Control Bar */}
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
                  placeholder="Message"
                  placeholderTextColor={MONO.textMuted}
                  returnKeyType="send"
                  onSubmitEditing={handleSend}
                  editable={!sending}
                />
                <MonoPressable
                  style={[styles.sendBtn, canSend && styles.sendBtnReady]}
                  scaleTo={0.92}
                  onPress={handleSend}
                  disabled={!canSend}
                  accessibilityLabel="Send message"
                >
                  <SendIcon color={canSend ? MONO.black : MONO.textMuted} size={18} />
                </MonoPressable>
              </View>
            ) : null}

            <View style={styles.controlActions}>
              <View style={styles.leftActions}>
                {activeControls.microphone ? (
                  <MonoPressable
                    style={[styles.actionBtn, isMuted && styles.actionBtnActive]}
                    scaleTo={0.92}
                    onPress={onToggleMute}
                    accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                  >
                    <MicIcon
                      color={isMuted ? MONO.black : MONO.white}
                      size={19}
                      muted={isMuted}
                    />
                  </MonoPressable>
                ) : null}

                {activeControls.chat ? (
                  <MonoPressable
                    style={[styles.actionBtn, chatOpen && styles.actionBtnActive]}
                    scaleTo={0.92}
                    onPress={handleToggleChat}
                    accessibilityLabel={chatOpen ? 'Hide transcript' : 'Show transcript'}
                  >
                    <ChatIcon color={chatOpen ? MONO.black : MONO.white} size={19} />
                  </MonoPressable>
                ) : null}
              </View>

              {activeControls.leave ? (
                <MonoPressable
                  style={styles.endBtn}
                  scaleTo={0.92}
                  onPress={handleEndPress}
                  accessibilityLabel="End call"
                >
                  <HangupIcon color={MONO.black} size={20} />
                </MonoPressable>
              ) : null}
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>
    </SafeAreaView>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MONO.bg,
  },
  flexRoot: {
    flex: 1,
  },
  flex: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    justifyContent: 'flex-end',
  },
  topBackWrap: {
    position: 'absolute',
    top: 12,
    left: 20,
    zIndex: 20,
  },
  topBackBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    alignItems: 'center',
    justifyContent: 'center',
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
  holdHaloRing: {
    position: 'absolute',
    width: 248,
    height: 248,
    borderRadius: 124,
    borderWidth: 1.25,
    borderColor: MONO.white,
  },
  auraTouch: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdCenterCue: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    borderWidth: 1,
    borderColor: MONO.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorPill: {
    position: 'absolute',
    bottom: 108,
    maxWidth: 300,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: MONO.surfaceElevated,
    borderWidth: 1,
    borderColor: MONO.borderStrong,
  },
  errorText: {
    ...TYPE.caption,
    color: MONO.textPrimary,
    textAlign: 'center',
  },
  transcriptLayer: {
    flex: 1,
    width: '100%',
    marginTop: 108,
    marginBottom: 12,
  },
  controlDock: {
    width: '100%',
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    borderRadius: 30,
    padding: 9,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 9,
    marginBottom: 9,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: MONO.border,
  },
  composerInput: {
    ...TYPE.body,
    flex: 1,
    color: MONO.textPrimary,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: MONO.surfacePressed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnReady: {
    backgroundColor: MONO.white,
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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: MONO.surfaceElevated,
    borderWidth: 1,
    borderColor: MONO.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnActive: {
    backgroundColor: MONO.white,
    borderColor: MONO.white,
  },
  endBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: MONO.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
