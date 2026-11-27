import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '../src/features/auth/hooks/useAuth';
import { ActiveCallView } from '../src/features/calling/components/ActiveCallView';
import { useActiveCall } from '../src/features/calling/context/ActiveCallContext';
import { usePermissions } from '../src/features/permissions/hooks/usePermissions';

/**
 * Unified pure-black (#000000) Aura canvas backed by the singleton ActiveCallContext.
 * Whether a call starts from tapping Aura, normal notification Answer, or returning
 * to Kallie during an ongoing background call, this view restores the exact active
 * LiveKit session with zero reconnection and zero duplicate connections.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const {
    hydrated: permissionsHydrated,
    allRequiredGranted,
    missingRequired,
    meta: permissionMeta,
  } = usePermissions();
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

  // Only show the permission indicator when a REQUIRED permission is missing,
  // denied, or revoked; optional permissions never clutter the Home screen.
  const hasMissingRequiredPermission = permissionsHydrated && !allRequiredGranted;
  const hasRevokedRequiredPermission = missingRequired.some(
    (descriptor) => permissionMeta[descriptor.id].revoked,
  );

  const handleOpenPermissions = useCallback(() => {
    const reason = hasRevokedRequiredPermission ? 'revoked' : 'call_microphone';
    router.push({ pathname: '/permissions', params: { reason } });
  }, [hasRevokedRequiredPermission, router]);

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
      showPermissionIndicator={hasMissingRequiredPermission}
      microphoneMissing={hasMissingRequiredPermission}
      onOpenPermissions={handleOpenPermissions}
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
