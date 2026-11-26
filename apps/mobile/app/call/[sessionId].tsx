import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ActiveCallView } from '../../src/features/calling/components/ActiveCallView';
import { useLiveKitCall } from '../../src/features/calling/hooks/useLiveKitCall';
import { apiClient } from '../../src/lib/apiClient';
import {
  getPendingCallConnection,
  setPendingCallConnection,
} from '../../src/lib/callSessionStore';
import { JoinCallResponse } from '../../src/types/database';

function ActiveCallContent({ connection }: { connection: JoinCallResponse }) {
  const router = useRouter();

  const handleRemoteEnded = useCallback(() => {
    router.replace('/');
  }, [router]);

  const {
    status,
    error,
    isMuted,
    isSpeakerOn,
    audioLevel,
    elapsedSeconds,
    messages,
    toggleMute,
    toggleSpeaker,
    sendMessage,
    endCall,
  } = useLiveKitCall({
    sessionId: connection.session.id,
    livekitUrl: connection.livekitUrl,
    token: connection.token,
    onRemoteEnded: handleRemoteEnded,
  });

  const handleEndCall = async () => {
    await endCall();
    router.replace('/');
  };

  return (
    <ActiveCallView
      status={status}
      audioLevel={audioLevel}
      elapsedSeconds={elapsedSeconds}
      isMuted={isMuted}
      isSpeakerOn={isSpeakerOn}
      error={error}
      messages={messages}
      onSendMessage={sendMessage}
      onToggleMute={toggleMute}
      onToggleSpeaker={toggleSpeaker}
      onEndCall={handleEndCall}
    />
  );
}

export default function ActiveCallScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const [connection, setConnection] = useState<JoinCallResponse | null>(() =>
    sessionId ? getPendingCallConnection(sessionId) ?? null : null,
  );

  useEffect(() => {
    if (connection || !sessionId) return;

    apiClient
      .acceptCall(sessionId)
      .then((data) => {
        setPendingCallConnection(data);
        setConnection(data);
      })
      .catch(() => {
        router.replace('/');
      });
  }, [connection, router, sessionId]);

  if (!connection) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="small" color="#FFFFFF" />
      </View>
    );
  }

  return <ActiveCallContent connection={connection} />;
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
