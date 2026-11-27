import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '../src/features/auth/hooks/useAuth';
import { ActiveCallView } from '../src/features/calling/components/ActiveCallView';
import { useActiveCall } from '../src/features/calling/context/ActiveCallContext';

/**
 * Unified pure-black (#000000) Aura canvas backed by the singleton ActiveCallContext.
 * Whether a call starts from tapping Aura, normal notification Answer, or returning
 * to Kallie during an ongoing background call, this view restores the exact active
 * LiveKit session with zero reconnection and zero duplicate connections.
 */
export default function HomeScreen() {
  const { user, loading } = useAuth();
  const {
    sessionActive,
    status,
    agentState,
    agentReady,
    connectionStatus,
    audioLevel,
    elapsedSeconds,
    isMuted,
    error,
    messages,
    startImmediateCall,
    prewarmCallIntent,
    sendMessage,
    toggleMute,
    endActiveCall,
  } = useActiveCall();

  if (loading || !user) {
    return <View style={styles.blank} />;
  }

  return (
    <ActiveCallView
      isSessionActive={sessionActive}
      isCallReady={agentReady}
      status={status}
      agentState={agentState}
      connectionStatus={connectionStatus}
      audioLevel={audioLevel}
      elapsedSeconds={elapsedSeconds}
      isMuted={isMuted}
      error={error}
      messages={messages}
      controls={{
        leave: true,
        microphone: true,
        screenShare: false,
        camera: false,
        chat: true,
      }}
      onStartCall={startImmediateCall}
      onStartCallPressIn={prewarmCallIntent}
      onSendMessage={sendMessage}
      onToggleMute={toggleMute}
      onEndCall={() => endActiveCall()}
    />
  );
}

const styles = StyleSheet.create({
  blank: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
