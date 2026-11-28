import { useRouter } from 'expo-router';
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { AuraConnectionStatus } from '../../../components/auraTheme';
import { generateUuidV4 } from '../../../lib/id';
import { isPhoneToolRunning } from '../../ai/lib/toolRegistry';
import {
  NetworkQuality,
  useNetworkQuality,
} from '../../network/hooks/useNetworkQuality';
import { permissionManager } from '../../permissions/lib/permissionManager';
import {
  getPhoneControlSettingsSync,
  isConfirmationPending,
  subscribeNotchStopRequest,
  subscribePhoneControlSettings,
} from '../../phoneControl/lib/phoneActionSafety';
import {
  NotchVisualState,
  phoneControlBridge,
} from '../../phoneControl/lib/phoneControlBridge';
import { syncLocalAlarms } from '../../schedules/lib/schedulesRepository';
import {
  AgentVisualizerState,
  CallChatMessage,
  CallConnectionState,
  useDirectVoiceSession,
} from '../hooks/useDirectVoiceSession';
import { setNotchAudioSyncActive } from '../lib/audioLevelStore';
import { nativeIncomingCall } from '../lib/nativeIncomingCall';
import { getVoiceSettingsSync } from '../lib/voiceSettingsStore';

interface ActiveVoiceSessionMeta {
  id: string;
  title: string;
  aiPrompt?: string;
  isScheduledCallback?: boolean;
}

interface ActiveCallActionsValue {
  sessionActive: boolean;
  activeSessionId: string | null;
  startImmediateCall: (options?: {
    title?: string;
    aiPrompt?: string;
    isScheduledCallback?: boolean;
  }) => Promise<boolean>;
  prewarmCallIntent: () => void;
  endActiveCall: (expectedSessionId?: string) => void;
}

interface ActiveCallContextValue extends ActiveCallActionsValue {
  status: CallConnectionState;
  agentState: AgentVisualizerState;
  agentReady: boolean;
  connectionStatus: AuraConnectionStatus;
  networkQuality: NetworkQuality;
  error: string | null;
  isMuted: boolean;
  toggleMute: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
}

const ActiveCallActionsContext = createContext<ActiveCallActionsValue | null>(null);
const ActiveCallContext = createContext<ActiveCallContextValue | null>(null);
const ActiveCallTranscriptContext = createContext<CallChatMessage[]>([]);

export function ActiveCallProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const network = useNetworkQuality();
  const [activeSession, setActiveSession] = useState<ActiveVoiceSessionMeta | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [isAppBackgrounded, setIsAppBackgrounded] = useState(
    () => AppState.currentState !== 'active',
  );
  const [dynamicNotchEnabled, setDynamicNotchEnabled] = useState(
    () => getPhoneControlSettingsSync().dynamicNotchEnabled,
  );

  const sessionActive = Boolean(activeSession);
  const activeSessionIdRef = useRef<string | null>(null);
  activeSessionIdRef.current = activeSession?.id ?? null;
  const startingCallRef = useRef(false);
  const callStartNonceRef = useRef(0);
  const notchVisibleRef = useRef(false);
  const networkRef = useRef(network);
  networkRef.current = network;

  const redirectToPermissions = useCallback(
    (reason: 'call_microphone' | 'incoming_call') => {
      try {
        router.push({ pathname: '/permissions', params: { reason } });
      } catch {
        // Safe no-op if navigator not mounted
      }
    },
    [router],
  );

  const handleRemoteEnded = useCallback(() => {
    callStartNonceRef.current += 1;
    startingCallRef.current = false;
    nativeIncomingCall.stopCallForegroundService();
    setActiveSession(null);
    syncLocalAlarms();
  }, []);

  const handleMissingProviderKey = useCallback(() => {
    callStartNonceRef.current += 1;
    startingCallRef.current = false;
    nativeIncomingCall.stopCallForegroundService();
    setActiveSession(null);
    try {
      router.push('/settings');
    } catch {
      // Safe no-op
    }
  }, [router]);

  const voice = useDirectVoiceSession({
    sessionId: activeSession?.id ?? '',
    title: activeSession?.title,
    aiPrompt: activeSession?.aiPrompt,
    isScheduledCallback: activeSession?.isScheduledCallback,
    enabled: sessionActive,
    onRemoteEnded: handleRemoteEnded,
    onMissingProviderKey: handleMissingProviderKey,
  });

  useEffect(() => {
    const appSub = AppState.addEventListener('change', (nextState) => {
      setIsAppBackgrounded(nextState !== 'active');
    });
    const settingsSub = subscribePhoneControlSettings((settings) => {
      setDynamicNotchEnabled(settings.dynamicNotchEnabled);
    });
    return () => {
      appSub.remove();
      settingsSub();
    };
  }, []);

  useEffect(() => {
    if (!sessionActive) {
      nativeIncomingCall.stopCallForegroundService();
    }
  }, [sessionActive]);

  // Show/hide Floating Orb strictly on visibility/state transitions — zero audioLevel/transcript re-renders!
  useEffect(() => {
    const shouldShow = sessionActive && isAppBackgrounded && dynamicNotchEnabled;
    setNotchAudioSyncActive(shouldShow);

    if (!shouldShow) {
      if (notchVisibleRef.current) {
        // Keep active Confirm Card alive if the user returned to foreground while confirming
        if (sessionActive && isConfirmationPending()) {
          return;
        }
        notchVisibleRef.current = false;
        phoneControlBridge.hideNotch();
      }
      return;
    }

    const notchState: NotchVisualState = voice.isMuted
      ? 'muted'
      : voice.agentState === 'speaking'
        ? 'speaking'
        : voice.agentState === 'thinking'
          ? 'thinking'
          : 'listening';

    const statusLabel = voice.isMuted
      ? 'Muted'
      : voice.agentState === 'speaking'
        ? 'Kallie'
        : voice.agentState === 'thinking'
          ? 'Thinking…'
          : 'Listening';

    notchVisibleRef.current = true;
    phoneControlBridge.showNotch(notchState, statusLabel, 0.14);
  }, [
    dynamicNotchEnabled,
    isAppBackgrounded,
    sessionActive,
    voice.agentState,
    voice.isMuted,
  ]);

  const startImmediateCall = useCallback(
    async (options?: {
      title?: string;
      aiPrompt?: string;
      isScheduledCallback?: boolean;
    }): Promise<boolean> => {
      if (activeSessionIdRef.current || startingCallRef.current) return true;
      startingCallRef.current = true;
      const myNonce = ++callStartNonceRef.current;

      try {
        const settings = getVoiceSettingsSync();
        if (!settings.liveVoiceEnabled) {
          router.push('/settings');
          return false;
        }

        const micStatus = await permissionManager.checkPermission('microphone');
        if (callStartNonceRef.current !== myNonce) return false;
        if (micStatus !== 'granted') {
          setStartError(null);
          redirectToPermissions('call_microphone');
          return false;
        }

        if (networkRef.current.quality === 'disconnected') {
          const fresh = await networkRef.current.checkNow();
          if (callStartNonceRef.current !== myNonce) return false;
          if (fresh.quality === 'disconnected') {
            return false;
          }
        }

        const newSessionId = generateUuidV4();
        const sessionTitle = options?.title || 'Voice with Kallie';
        // Await FGS promotion BEFORE starting AudioRecord so Android 12–16 keeps mic alive in background
        const fgsOk = await nativeIncomingCall.startCallForegroundService(
          newSessionId,
          sessionTitle,
        );

        // If user hung up mid-flight while FGS was starting, stop FGS and abort cleanly
        if (callStartNonceRef.current !== myNonce) {
          nativeIncomingCall.stopCallForegroundService();
          return false;
        }

        if (!fgsOk) {
          setStartError('Unable to start background call audio service. Check microphone permission.');
          return false;
        }

        setStartError(null);
        setActiveSession({
          id: newSessionId,
          title: sessionTitle,
          aiPrompt: options?.aiPrompt,
          isScheduledCallback: options?.isScheduledCallback,
        });
        return true;
      } finally {
        if (callStartNonceRef.current === myNonce) {
          startingCallRef.current = false;
        }
      }
    },
    [redirectToPermissions, router],
  );

  const prewarmCallIntent = useCallback(() => {
    void permissionManager.checkPermission('microphone');
  }, []);

  const voiceEndCall = voice.endCall;

  const endActiveCall = useCallback(
    (expectedSessionId?: string) => {
      if (
        expectedSessionId &&
        activeSessionIdRef.current &&
        activeSessionIdRef.current !== expectedSessionId
      ) {
        return;
      }
      callStartNonceRef.current += 1;
      startingCallRef.current = false;
      const currentId = activeSessionIdRef.current || expectedSessionId;
      setStartError(null);
      nativeIncomingCall.stopCallForegroundService();
      if (currentId) {
        nativeIncomingCall.dismissIncomingCall(currentId);
      }
      setActiveSession(null);
      void voiceEndCall();
      syncLocalAlarms();
    },
    [voiceEndCall],
  );

  const activeSessionId = activeSession?.id ?? null;

  // Wire physical Floating Orb drag-to-X ONLY: stops running automation if active, else ends call cleanly
  useEffect(() => {
    if (!sessionActive) return;
    return subscribeNotchStopRequest(({ hadPendingConfirm }) => {
      if (!isPhoneToolRunning() && !hadPendingConfirm) {
        endActiveCall();
      }
    });
  }, [endActiveCall, sessionActive]);

  const actionsValue = useMemo<ActiveCallActionsValue>(
    () => ({
      sessionActive,
      activeSessionId,
      startImmediateCall,
      prewarmCallIntent,
      endActiveCall,
    }),
    [activeSessionId, endActiveCall, prewarmCallIntent, sessionActive, startImmediateCall],
  );

  const mergedConnectionStatus: AuraConnectionStatus = useMemo(() => {
    if (network.quality === 'disconnected' || startError) {
      return 'disconnected';
    }
    if (sessionActive) {
      if (voice.connectionStatus === 'disconnected') return 'disconnected';
      if (network.quality === 'weak' || voice.connectionStatus === 'weak') return 'weak';
      return voice.connectionStatus;
    }
    if (network.quality === 'weak') return 'weak';
    return 'idle';
  }, [network.quality, sessionActive, startError, voice.connectionStatus]);

  const value = useMemo<ActiveCallContextValue>(
    () => ({
      ...actionsValue,
      status: voice.status,
      agentState: voice.agentState,
      agentReady: voice.agentReady,
      connectionStatus: mergedConnectionStatus,
      networkQuality: network.quality,
      error: startError ?? voice.error,
      isMuted: voice.isMuted,
      toggleMute: voice.toggleMute,
      sendMessage: voice.sendMessage,
    }),
    [
      actionsValue,
      mergedConnectionStatus,
      network.quality,
      startError,
      voice.agentReady,
      voice.agentState,
      voice.error,
      voice.isMuted,
      voice.sendMessage,
      voice.status,
      voice.toggleMute,
    ],
  );

  return (
    <ActiveCallActionsContext.Provider value={actionsValue}>
      <ActiveCallContext.Provider value={value}>
        <ActiveCallTranscriptContext.Provider value={voice.messages}>
          {children}
        </ActiveCallTranscriptContext.Provider>
      </ActiveCallContext.Provider>
    </ActiveCallActionsContext.Provider>
  );
}

export function useActiveCallActions(): ActiveCallActionsValue {
  const ctx = useContext(ActiveCallActionsContext);
  if (!ctx) {
    throw new Error('useActiveCallActions must be used inside ActiveCallProvider');
  }
  return ctx;
}

export function useActiveCall(): ActiveCallContextValue {
  const ctx = useContext(ActiveCallContext);
  if (!ctx) {
    throw new Error('useActiveCall must be used inside ActiveCallProvider');
  }
  return ctx;
}

export function useActiveCallTranscript(): CallChatMessage[] {
  return useContext(ActiveCallTranscriptContext);
}
