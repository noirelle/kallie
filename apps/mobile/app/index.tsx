import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '../src/features/auth/hooks/useAuth';
import { ActiveCallView } from '../src/features/calling/components/ActiveCallView';
import { useLiveKitCall } from '../src/features/calling/hooks/useLiveKitCall';
import { apiClient } from '../src/lib/apiClient';
import { JoinCallResponse } from '../src/types/database';

/**
 * Unified pure-black (#000000) Aura canvas.
 * Tapping the Aura transitions seamlessly in-place from idle -> active call
 * with zero route push, zero screen flash, and instant non-blocking hangup.
 */
export default function HomeScreen() {
  const { user, loading } = useAuth();
  const [sessionActive, setSessionActive] = useState(false);
  const [connection, setConnection] = useState<JoinCallResponse | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const attemptIdRef = useRef(0);

  const handleRemoteEnded = useCallback(() => {
    attemptIdRef.current += 1;
    setSessionActive(false);
    setConnection(null);
  }, []);

  const {
    status,
    agentState,
    agentReady,
    connectionStatus,
    error,
    isMuted,
    audioLevel,
    elapsedSeconds,
    messages,
    toggleMute,
    sendMessage,
    endCall,
  } = useLiveKitCall({
    sessionId: connection?.session.id ?? '',
    livekitUrl: connection?.livekitUrl ?? '',
    token: connection?.token ?? '',
    enabled: sessionActive,
    onRemoteEnded: handleRemoteEnded,
  });

  const handleStartCall = useCallback(async () => {
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
        // User ended the call while API was still creating the session
        void apiClient.endCall(joinData.session.id).catch(() => {});
        return;
      }
      setConnection(joinData);
    } catch (err) {
      if (attemptIdRef.current !== attemptId) return;
      setSessionActive(false);
      setConnection(null);
      setStartError(err instanceof Error ? err.message : 'Unable to connect');
    }
  }, [sessionActive]);

  const handleEndCall = useCallback(() => {
    attemptIdRef.current += 1;
    setStartError(null);
    setSessionActive(false);
    setConnection(null);
    void endCall();
  }, [endCall]);

  if (loading || !user) {
    return <View style={styles.blank} />;
  }

  return (
    <ActiveCallView
      isSessionActive={sessionActive}
      isCallReady={agentReady}
      status={status}
      agentState={agentState}
      connectionStatus={startError ? 'disconnected' : connectionStatus}
      audioLevel={audioLevel}
      elapsedSeconds={elapsedSeconds}
      isMuted={isMuted}
      error={startError ?? error}
      messages={messages}
      controls={{
        leave: true,
        microphone: true,
        screenShare: false,
        camera: false,
        chat: true,
      }}
      onStartCall={handleStartCall}
      onSendMessage={sendMessage}
      onToggleMute={toggleMute}
      onEndCall={handleEndCall}
    />
  );
}

const styles = StyleSheet.create({
  blank: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
