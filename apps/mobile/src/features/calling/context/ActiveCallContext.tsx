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
import { AuraConnectionStatus } from '../../../components/auraTheme';
import { apiClient } from '../../../lib/apiClient';
import {
  clearPendingCallConnection,
  getPendingCallConnection,
  setPendingCallConnection,
} from '../../../lib/callSessionStore';
import { JoinCallResponse } from '../../../types/database';
import {
  AgentVisualizerState,
  CallChatMessage,
  CallConnectionState,
  useLiveKitCall,
} from '../hooks/useLiveKitCall';
import { nativeIncomingCall } from '../lib/nativeIncomingCall';

interface ActiveCallContextValue {
  sessionActive: boolean;
  activeSessionId: string | null;
  connection: JoinCallResponse | null;
  status: CallConnectionState;
  agentState: AgentVisualizerState;
  agentReady: boolean;
  connectionStatus: AuraConnectionStatus;
  error: string | null;
  isMuted: boolean;
  isCameraOn: boolean;
  isScreenShareOn: boolean;
  audioLevel: number;
  elapsedSeconds: number;
  messages: CallChatMessage[];
  startImmediateCall: () => Promise<void>;
  joinAcceptedCall: (joinData: JoinCallResponse) => void;
  joinSessionById: (sessionId: string) => Promise<JoinCallResponse | null>;
  toggleMute: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  endActiveCall: (expectedSessionId?: string) => void;
}

const ActiveCallContext = createContext<ActiveCallContextValue | null>(null);

export function ActiveCallProvider({ children }: { children: ReactNode }) {
  const [sessionActive, setSessionActive] = useState(false);
  const [connection, setConnection] = useState<JoinCallResponse | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const attemptIdRef = useRef(0);
  const activeSessionIdRef = useRef<string | null>(null);
  const inFlightAcceptSessionRef = useRef<string | null>(null);

  activeSessionIdRef.current = connection?.session.id ?? null;

  const handleRemoteEnded = useCallback(() => {
    attemptIdRef.current += 1;
    const prevId = activeSessionIdRef.current;
    if (prevId) {
      clearPendingCallConnection(prevId);
    }
    nativeIncomingCall.stopCallForegroundService();
    setSessionActive(false);
    setConnection(null);
  }, []);

  const livekit = useLiveKitCall({
    sessionId: connection?.session.id ?? '',
    livekitUrl: connection?.livekitUrl ?? '',
    token: connection?.token ?? '',
    enabled: sessionActive,
    onRemoteEnded: handleRemoteEnded,
  });

  // Synchronize native Android microphone Foreground Service with the active call lifecycle.
  // Guarantees ongoing LiveKit audio survives minimizing Kallie or locking the screen,
  // and ensures the service is always torn down cleanly when the call ends.
  useEffect(() => {
    if (sessionActive && connection?.session.id) {
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
    const attemptId = ++attemptIdRef.current;
    setStartError(null);
    // Enter active session immediately for 0ms perceived latency
    setSessionActive(true);
    setConnection(null);

    try {
      const joinData = await apiClient.createTestCall({
        title: 'Call with Kallie',
      });
      if (attemptIdRef.current !== attemptId) {
        void apiClient.endCall(joinData.session.id).catch(() => {});
        return;
      }
      setPendingCallConnection(joinData);
      setConnection(joinData);
    } catch (err) {
      if (attemptIdRef.current !== attemptId) return;
      nativeIncomingCall.stopCallForegroundService();
      setSessionActive(false);
      setConnection(null);
      setStartError(err instanceof Error ? err.message : 'Unable to connect');
    }
  }, [sessionActive]);

  const joinAcceptedCall = useCallback((joinData: JoinCallResponse) => {
    const targetId = joinData.session.id;
    // Prevent duplicate LiveKit connections if already active on this session
    if (activeSessionIdRef.current === targetId && sessionActive) {
      return;
    }

    attemptIdRef.current += 1;
    setStartError(null);
    setPendingCallConnection(joinData);
    nativeIncomingCall.dismissIncomingCall(targetId);
    nativeIncomingCall.startCallForegroundService(
      targetId,
      joinData.session.title || 'Kallie',
    );
    setConnection(joinData);
    setSessionActive(true);
  }, [sessionActive]);

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

      const cached = getPendingCallConnection(sessionId);
      if (cached) {
        joinAcceptedCall(cached);
        return cached;
      }

      const attemptId = ++attemptIdRef.current;
      inFlightAcceptSessionRef.current = sessionId;
      setStartError(null);
      nativeIncomingCall.dismissIncomingCall(sessionId);
      setSessionActive(true);
      setConnection(null);

      try {
        const joinData = await apiClient.acceptCall(sessionId);
        if (attemptIdRef.current !== attemptId) {
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
        setSessionActive(false);
        setConnection(null);
        setStartError(err instanceof Error ? err.message : 'Unable to connect');
        return null;
      } finally {
        if (inFlightAcceptSessionRef.current === sessionId) {
          inFlightAcceptSessionRef.current = null;
        }
      }
    },
    [connection, joinAcceptedCall, sessionActive],
  );

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
      setSessionActive(false);
      setConnection(null);
      void livekit.endCall();
    },
    [livekit],
  );

  const value = useMemo<ActiveCallContextValue>(
    () => ({
      sessionActive,
      activeSessionId: connection?.session.id ?? null,
      connection,
      status: livekit.status,
      agentState: livekit.agentState,
      agentReady: livekit.agentReady,
      connectionStatus: startError ? 'disconnected' : livekit.connectionStatus,
      error: startError ?? livekit.error,
      isMuted: livekit.isMuted,
      isCameraOn: livekit.isCameraOn,
      isScreenShareOn: livekit.isScreenShareOn,
      audioLevel: livekit.audioLevel,
      elapsedSeconds: livekit.elapsedSeconds,
      messages: livekit.messages,
      startImmediateCall,
      joinAcceptedCall,
      joinSessionById,
      toggleMute: livekit.toggleMute,
      toggleCamera: livekit.toggleCamera,
      toggleScreenShare: livekit.toggleScreenShare,
      sendMessage: livekit.sendMessage,
      endActiveCall,
    }),
    [
      connection,
      endActiveCall,
      joinAcceptedCall,
      joinSessionById,
      livekit.agentReady,
      livekit.agentState,
      livekit.audioLevel,
      livekit.connectionStatus,
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
      sessionActive,
      startError,
      startImmediateCall,
    ],
  );

  return (
    <ActiveCallContext.Provider value={value}>
      {children}
    </ActiveCallContext.Provider>
  );
}

export function useActiveCall(): ActiveCallContextValue {
  const ctx = useContext(ActiveCallContext);
  if (!ctx) {
    throw new Error('useActiveCall must be used inside ActiveCallProvider');
  }
  return ctx;
}
