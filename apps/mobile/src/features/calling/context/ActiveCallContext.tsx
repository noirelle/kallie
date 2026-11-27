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
import { apiClient } from '../../../lib/apiClient';
import { scheduleAfterPaint } from '../../../lib/scheduleAfterPaint';
import {
  clearPendingCallConnection,
  getPendingCallConnection,
  setPendingCallConnection,
} from '../../../lib/callSessionStore';
import {
  getCachedAuthState,
  subscribeAuthSession,
} from '../../../lib/storage/authSessionCache';
import { JoinCallResponse } from '../../../types/database';
import {
  NetworkQuality,
  useNetworkQuality,
} from '../../network/hooks/useNetworkQuality';
import { syncUserData } from '../../schedules/lib/syncEngine';
import {
  AgentVisualizerState,
  CallChatMessage,
  CallConnectionState,
  useLiveKitCall,
} from '../hooks/useLiveKitCall';
import {
  activateStandbyImperatively,
  consumeStandbySession,
  hasMicrophonePermission,
  hasMicrophonePermissionSync,
  prewarmCallInfrastructure,
  prewarmOnTouchIntent,
  StagedStandbySession,
  stageStandbySession,
  stopAudioSessionSafe,
  teardownStandbySession,
  warmAudioSessionEarly,
} from '../lib/callPrewarm';
import { nativeIncomingCall } from '../lib/nativeIncomingCall';

interface ActiveCallActionsValue {
  sessionActive: boolean;
  activeSessionId: string | null;
  startImmediateCall: () => Promise<void>;
  prewarmCallIntent: () => void;
  joinAcceptedCall: (joinData: JoinCallResponse) => void;
  joinSessionById: (sessionId: string) => Promise<JoinCallResponse | null>;
  endActiveCall: (expectedSessionId?: string) => void;
}

interface ActiveCallContextValue extends ActiveCallActionsValue {
  connection: JoinCallResponse | null;
  status: CallConnectionState;
  agentState: AgentVisualizerState;
  agentReady: boolean;
  connectionStatus: AuraConnectionStatus;
  networkQuality: NetworkQuality;
  error: string | null;
  isMuted: boolean;
  isCameraOn: boolean;
  isScreenShareOn: boolean;
  audioLevel: number;
  elapsedSeconds: number;
  messages: CallChatMessage[];
  toggleMute: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
}

const ActiveCallActionsContext = createContext<ActiveCallActionsValue | null>(null);
const ActiveCallContext = createContext<ActiveCallContextValue | null>(null);

export function ActiveCallProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const network = useNetworkQuality();
  const [sessionActive, setSessionActive] = useState(false);
  const [connection, setConnection] = useState<JoinCallResponse | null>(null);
  const [activeStandby, setActiveStandby] = useState<StagedStandbySession | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [callStartedAtMs, setCallStartedAtMs] = useState<number | null>(null);
  const initialAuth = getCachedAuthState();
  const [signedInUserId, setSignedInUserId] = useState<string | null>(
    initialAuth.session?.user?.id ?? null,
  );
  const signedIn = Boolean(signedInUserId);

  const attemptIdRef = useRef(0);
  const activeSessionIdRef = useRef<string | null>(null);
  const inFlightAcceptSessionRef = useRef<string | null>(null);
  const sessionActiveRef = useRef(false);
  const signedInUserIdRef = useRef<string | null>(signedInUserId);
  const prevNetworkQualityRef = useRef<NetworkQuality>(network.quality);
  const networkRef = useRef(network);
  networkRef.current = network;

  activeSessionIdRef.current = connection?.session.id ?? null;
  sessionActiveRef.current = sessionActive;
  signedInUserIdRef.current = signedInUserId;

  // Automatically re-warm standby & sync data the moment internet recovers from offline
  useEffect(() => {
    const prev = prevNetworkQualityRef.current;
    prevNetworkQualityRef.current = network.quality;
    if (prev === 'disconnected' && network.quality !== 'disconnected') {
      setStartError(null);
      prewarmCallInfrastructure(true);
      const uid = signedInUserIdRef.current;
      if (uid) {
        void syncUserData(uid, { force: true });
        if (!sessionActiveRef.current && AppState.currentState === 'active') {
          void stageStandbySession();
        }
      }
    }
  }, [network.quality]);

  // Share the single authSessionCache listener so standby pre-staging only runs when signed in
  useEffect(() => {
    return subscribeAuthSession((nextSession) => {
      const nextUid = nextSession?.user?.id ?? null;
      setSignedInUserId(nextUid);
      if (!nextUid) {
        void teardownStandbySession();
      }
    });
  }, []);

  // Pre-warm DNS/TLS keep-alive and stage a short-lived standby room on Home screen
  // mount & foreground resume — deferred past initial frame paint so cold boot stays instant.
  useEffect(() => {
    let stageTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelDeferred = scheduleAfterPaint(() => {
      prewarmCallInfrastructure(true);
      if (signedIn && !sessionActive && AppState.currentState === 'active') {
        stageTimer = setTimeout(() => {
          if (!sessionActiveRef.current && AppState.currentState === 'active') {
            void stageStandbySession();
          }
        }, 500);
      }
    });

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        prewarmCallInfrastructure(false);
        if (signedIn && !sessionActiveRef.current) {
          void stageStandbySession();
        }
      } else if (!sessionActiveRef.current) {
        // Release idle standby room immediately when app leaves foreground
        void teardownStandbySession();
      }
    });
    return () => {
      cancelDeferred();
      if (stageTimer) clearTimeout(stageTimer);
      sub.remove();
    };
  }, [sessionActive, signedIn]);

  const handleRemoteEnded = useCallback(() => {
    attemptIdRef.current += 1;
    const prevId = activeSessionIdRef.current;
    if (prevId) {
      clearPendingCallConnection(prevId);
    }
    nativeIncomingCall.stopCallForegroundService();
    setSessionActive(false);
    setConnection(null);
    setActiveStandby(null);
    setCallStartedAtMs(null);
    // Sync schedules & history immediately after call end in case Kallie scheduled a callback by voice
    const uid = signedInUserIdRef.current;
    if (uid) {
      setTimeout(() => void syncUserData(uid, { force: true }), 1200);
    }
    setTimeout(() => prewarmCallInfrastructure(true), 600);
  }, []);

  const redirectToPermissions = useCallback(
    (reason: 'call_microphone' | 'incoming_call') => {
      try {
        router.push({ pathname: '/permissions', params: { reason } });
      } catch {
        // Safe no-op if navigator is not yet mounted
      }
    },
    [router],
  );

  const handleMissingCallPermission = useCallback(() => {
    attemptIdRef.current += 1;
    nativeIncomingCall.stopCallForegroundService();
    void stopAudioSessionSafe();
    setSessionActive(false);
    setConnection(null);
    setActiveStandby(null);
    setCallStartedAtMs(null);
    setStartError(null);
    redirectToPermissions('call_microphone');
  }, [redirectToPermissions]);

  const livekit = useLiveKitCall({
    sessionId: connection?.session.id ?? '',
    livekitUrl: connection?.livekitUrl ?? '',
    token: connection?.token ?? '',
    enabled: sessionActive,
    callStartedAtMs: callStartedAtMs ?? undefined,
    preconnectedStandby: activeStandby,
    onRemoteEnded: handleRemoteEnded,
    onMissingPermission: handleMissingCallPermission,
  });

  // Synchronize native Android microphone Foreground Service with the active call lifecycle.
  // Strictly guarded by RECORD_AUDIO permission so Android never throws
  // ForegroundServiceDidNotStartInTimeException when mic access is missing or revoked.
  useEffect(() => {
    if (sessionActive && connection?.session.id && hasMicrophonePermissionSync()) {
      nativeIncomingCall.startCallForegroundService(
        connection.session.id,
        connection.session.title || 'Kallie',
      );
      return;
    }

    if (!sessionActive) {
      nativeIncomingCall.stopCallForegroundService();
    }
  }, [connection?.session.id, connection?.session.title, sessionActive]);

  const startImmediateCall = useCallback(async () => {
    if (sessionActive) return;

    // Non-prompting live check (~1ms): if Microphone is missing or revoked, redirect
    // cleanly to the Permission Management page instead of crashing or spamming dialogs.
    const hasMic = await hasMicrophonePermission();
    if (!hasMic) {
      setStartError(null);
      redirectToPermissions('call_microphone');
      return;
    }

    // If currently offline, trigger an immediate probe; if still offline, stay idle
    // with the red Aura instead of hanging on a doomed network request.
    if (networkRef.current.quality === 'disconnected') {
      const fresh = await networkRef.current.checkNow();
      if (fresh.quality === 'disconnected') {
        return;
      }
    }

    const attemptId = ++attemptIdRef.current;
    const startedAt = Date.now();
    setStartError(null);
    setCallStartedAtMs(startedAt);
    // Enter active session immediately for 0ms perceived latency
    setSessionActive(true);

    // Overlap native AudioSession setup at t=0ms
    void warmAudioSessionEarly().catch(() => {});

    // Fast path: adopt already-connected (or in-flight) Home-screen standby session
    // and trigger `start_call` + mic capture IMPERATIVELY at t=0ms before React renders.
    const staged = consumeStandbySession();
    if (staged) {
      activateStandbyImperatively(staged, startedAt);
      nativeIncomingCall.startCallForegroundService(
        staged.joinData.session.id,
        staged.joinData.session.title || 'Kallie',
      );
      console.log(
        `[CallPerf] standbyHit connected=${staged.isConnected()} audioReady=${staged.isAgentAudioSubscribed()} session=${staged.joinData.session.id}`,
      );
      setActiveStandby(staged);
      setPendingCallConnection(staged.joinData);
      setConnection(staged.joinData);
      void apiClient
        .activateStandbyCall({
          sessionId: staged.joinData.session.id,
          roomName: staged.joinData.roomName,
          title: staged.joinData.session.title,
          aiPrompt: staged.joinData.session.ai_prompt,
        })
        .catch(() => {});
      return;
    }

    setActiveStandby(null);
    setConnection(null);

    try {
      const joinData = await apiClient.createTestCall({
        title: 'Call with Kallie',
      });
      console.log(
        `[CallPerf] apiCreateTestCall=${Date.now() - startedAt}ms session=${joinData.session.id}`,
      );
      if (attemptIdRef.current !== attemptId) {
        void stopAudioSessionSafe();
        void apiClient.endCall(joinData.session.id).catch(() => {});
        return;
      }
      setPendingCallConnection(joinData);
      setConnection(joinData);
    } catch (err) {
      if (attemptIdRef.current !== attemptId) return;
      nativeIncomingCall.stopCallForegroundService();
      void stopAudioSessionSafe();
      setSessionActive(false);
      setConnection(null);
      setActiveStandby(null);
      setCallStartedAtMs(null);
      setStartError(err instanceof Error ? err.message : 'Unable to connect');
    }
  }, [redirectToPermissions, sessionActive]);

  const joinAcceptedCall = useCallback(
    (joinData: JoinCallResponse) => {
      const targetId = joinData.session.id;
      // Prevent duplicate LiveKit connections if already active on this session
      if (activeSessionIdRef.current === targetId && sessionActive) {
        return;
      }

      if (!hasMicrophonePermissionSync()) {
        nativeIncomingCall.dismissIncomingCall(targetId);
        redirectToPermissions('incoming_call');
        return;
      }

      void teardownStandbySession();
      attemptIdRef.current += 1;
      setStartError(null);
      setActiveStandby(null);
      setCallStartedAtMs((prev) => prev ?? Date.now());
      setPendingCallConnection(joinData);
      nativeIncomingCall.dismissIncomingCall(targetId);
      nativeIncomingCall.startCallForegroundService(
        targetId,
        joinData.session.title || 'Kallie',
      );
      void warmAudioSessionEarly().catch(() => {});
      setConnection(joinData);
      setSessionActive(true);
    },
    [redirectToPermissions, sessionActive],
  );

  const joinSessionById = useCallback(
    async (sessionId: string): Promise<JoinCallResponse | null> => {
      if (!sessionId) return null;

      // Never duplicate an already active or in-flight session
      if (activeSessionIdRef.current === sessionId && sessionActive) {
        return connection;
      }
      if (inFlightAcceptSessionRef.current === sessionId) {
        return null;
      }

      const hasMic = await hasMicrophonePermission();
      if (!hasMic) {
        nativeIncomingCall.dismissIncomingCall(sessionId);
        redirectToPermissions('incoming_call');
        return null;
      }

      const cached = getPendingCallConnection(sessionId);
      if (cached) {
        joinAcceptedCall(cached);
        return cached;
      }

      void teardownStandbySession();
      const attemptId = ++attemptIdRef.current;
      const startedAt = Date.now();
      inFlightAcceptSessionRef.current = sessionId;
      setStartError(null);
      setActiveStandby(null);
      setCallStartedAtMs(startedAt);
      nativeIncomingCall.dismissIncomingCall(sessionId);
      setSessionActive(true);
      setConnection(null);

      // Warm AudioSession in parallel with POST /calls/:id/accept
      void warmAudioSessionEarly().catch(() => {});

      try {
        const joinData = await apiClient.acceptCall(sessionId);
        console.log(
          `[CallPerf] apiAcceptCall=${Date.now() - startedAt}ms session=${joinData.session.id}`,
        );
        if (attemptIdRef.current !== attemptId) {
          void stopAudioSessionSafe();
          void apiClient.endCall(joinData.session.id).catch(() => {});
          return null;
        }
        setPendingCallConnection(joinData);
        nativeIncomingCall.startCallForegroundService(
          joinData.session.id,
          joinData.session.title || 'Kallie',
        );
        setConnection(joinData);
        return joinData;
      } catch (err) {
        if (attemptIdRef.current !== attemptId) return null;
        nativeIncomingCall.stopCallForegroundService();
        void stopAudioSessionSafe();
        setSessionActive(false);
        setConnection(null);
        setActiveStandby(null);
        setCallStartedAtMs(null);
        setStartError(err instanceof Error ? err.message : 'Unable to connect');
        return null;
      } finally {
        if (inFlightAcceptSessionRef.current === sessionId) {
          inFlightAcceptSessionRef.current = null;
        }
      }
    },
    [connection, joinAcceptedCall, redirectToPermissions, sessionActive],
  );

  const prewarmCallIntent = useCallback(() => {
    if (!sessionActiveRef.current) {
      prewarmOnTouchIntent();
    }
  }, []);

  const livekitEndCall = livekit.endCall;

  const endActiveCall = useCallback(
    (expectedSessionId?: string) => {
      if (
        expectedSessionId &&
        activeSessionIdRef.current &&
        activeSessionIdRef.current !== expectedSessionId
      ) {
        return;
      }

      const currentId = activeSessionIdRef.current || expectedSessionId || null;
      attemptIdRef.current += 1;
      inFlightAcceptSessionRef.current = null;
      setStartError(null);
      nativeIncomingCall.stopCallForegroundService();
      if (currentId) {
        nativeIncomingCall.dismissIncomingCall(currentId);
        clearPendingCallConnection(currentId);
      }
      // If user cancelled before LiveKit connection existed, ensure early AudioSession stops
      if (!activeSessionIdRef.current) {
        void stopAudioSessionSafe();
      }
      setSessionActive(false);
      setConnection(null);
      setActiveStandby(null);
      setCallStartedAtMs(null);
      void livekitEndCall();
      const uid = signedInUserIdRef.current;
      if (uid) {
        setTimeout(() => void syncUserData(uid, { force: true }), 1200);
      }
      setTimeout(() => prewarmCallInfrastructure(true), 600);
    },
    [livekitEndCall],
  );

  const activeSessionId = connection?.session.id ?? null;

  const actionsValue = useMemo<ActiveCallActionsValue>(
    () => ({
      sessionActive,
      activeSessionId,
      startImmediateCall,
      prewarmCallIntent,
      joinAcceptedCall,
      joinSessionById,
      endActiveCall,
    }),
    [
      activeSessionId,
      endActiveCall,
      joinAcceptedCall,
      joinSessionById,
      prewarmCallIntent,
      sessionActive,
      startImmediateCall,
    ],
  );

  const mergedConnectionStatus: AuraConnectionStatus = useMemo(() => {
    if (network.quality === 'disconnected' || startError) {
      return 'disconnected';
    }
    if (sessionActive) {
      if (livekit.connectionStatus === 'disconnected') {
        return 'disconnected';
      }
      if (network.quality === 'weak' || livekit.connectionStatus === 'weak') {
        return 'weak';
      }
      return livekit.connectionStatus;
    }
    if (network.quality === 'weak') {
      return 'weak';
    }
    return 'idle';
  }, [livekit.connectionStatus, network.quality, sessionActive, startError]);

  const value = useMemo<ActiveCallContextValue>(
    () => ({
      ...actionsValue,
      connection,
      status: livekit.status,
      agentState: livekit.agentState,
      agentReady: livekit.agentReady,
      connectionStatus: mergedConnectionStatus,
      networkQuality: network.quality,
      error: startError ?? livekit.error,
      isMuted: livekit.isMuted,
      isCameraOn: livekit.isCameraOn,
      isScreenShareOn: livekit.isScreenShareOn,
      audioLevel: livekit.audioLevel,
      elapsedSeconds: livekit.elapsedSeconds,
      messages: livekit.messages,
      toggleMute: livekit.toggleMute,
      toggleCamera: livekit.toggleCamera,
      toggleScreenShare: livekit.toggleScreenShare,
      sendMessage: livekit.sendMessage,
    }),
    [
      actionsValue,
      connection,
      livekit.agentReady,
      livekit.agentState,
      livekit.audioLevel,
      livekit.elapsedSeconds,
      livekit.error,
      livekit.isCameraOn,
      livekit.isMuted,
      livekit.isScreenShareOn,
      livekit.messages,
      livekit.sendMessage,
      livekit.status,
      livekit.toggleCamera,
      livekit.toggleMute,
      livekit.toggleScreenShare,
      mergedConnectionStatus,
      network.quality,
      startError,
    ],
  );

  return (
    <ActiveCallActionsContext.Provider value={actionsValue}>
      <ActiveCallContext.Provider value={value}>
        {children}
      </ActiveCallContext.Provider>
    </ActiveCallActionsContext.Provider>
  );
}

/**
 * Stable low-frequency slice for RootLayout & deep links — avoids re-rendering
 * the app shell every second when elapsedSeconds/audioLevel/messages tick.
 */
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
