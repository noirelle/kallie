import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActiveCallView } from '../src/features/calling/components/ActiveCallView';
import { useActiveCall } from '../src/features/calling/context/ActiveCallContext';
import { SetupGateView } from '../src/features/readiness/components/SetupGateView';
import { useAppReadiness } from '../src/features/readiness/hooks/useAppReadiness';
import { MONO } from '../src/theme/monoTheme';

/**
 * Conditional Aura Home Canvas:
 * - Waits silently on pure black until provider + permission readiness hydrates (zero flicker).
 * - Displays minimal monochrome SetupGateView until both AI provider and Microphone are ready.
 * - Re-validates automatically on focus/return from Settings and smoothly transitions into Aura.
 * - Hold Aura (460ms) to open Settings; Tap Aura to talk.
 */
const HOME_CONTROLS = {
  leave: true,
  microphone: true,
  chat: true,
} as const;

export default function HomeScreen() {
  const router = useRouter();
  const readiness = useAppReadiness();
  const [screenFocused, setScreenFocused] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => {
        setScreenFocused(false);
      };
    }, []),
  );

  const {
    sessionActive,
    status,
    agentState,
    agentReady,
    connectionStatus,
    isMuted,
    error,
    startImmediateCall,
    prewarmCallIntent,
    sendMessage,
    toggleMute,
    endActiveCall,
  } = useActiveCall();

  const handleOpenSettings = useCallback(() => {
    router.push('/settings');
  }, [router]);

  const handleScanPcQr = useCallback(() => {
    router.push('/pair');
  }, [router]);

  const handleOpenPermissions = useCallback(() => {
    router.push({ pathname: '/permissions', params: { reason: 'call_microphone' } });
  }, [router]);

  const handleStartCall = useCallback(() => {
    void startImmediateCall();
  }, [startImmediateCall]);

  const handleEndCall = useCallback(() => {
    endActiveCall();
  }, [endActiveCall]);

  // Prevent flicker while initial readiness snapshot hydrates
  if (!readiness.hydrated && !sessionActive) {
    return <View style={styles.bootBlank} />;
  }

  // Conditional Aura visibility: hold back normal Aura until required config & mic are ready
  if (!readiness.isReady && !sessionActive) {
    return (
      <SetupGateView
        providerConfigured={readiness.providerConfigured}
        microphoneGranted={readiness.microphoneGranted}
        onConfigureAi={handleOpenSettings}
        onScanPcQr={handleScanPcQr}
        onOpenPermissions={handleOpenPermissions}
        onOpenSettings={handleOpenSettings}
      />
    );
  }

  return (
    <ActiveCallView
      isSessionActive={sessionActive}
      isCallReady={agentReady}
      status={status}
      agentState={agentState}
      connectionStatus={connectionStatus}
      isMuted={isMuted}
      error={error}
      screenFocused={screenFocused}
      controls={HOME_CONTROLS}
      onOpenSettings={handleOpenSettings}
      onStartCall={handleStartCall}
      onStartCallPressIn={prewarmCallIntent}
      onSendMessage={sendMessage}
      onToggleMute={toggleMute}
      onEndCall={handleEndCall}
    />
  );
}

const styles = StyleSheet.create({
  bootBlank: {
    flex: 1,
    backgroundColor: MONO.bg,
  },
});
