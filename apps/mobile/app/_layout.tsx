import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../src/features/auth/hooks/useAuth';
import { IncomingCallModal } from '../src/features/calling/components/IncomingCallModal';
import { useIncomingCall } from '../src/features/calling/hooks/useIncomingCall';
import {
  registerBackgroundFcmHandler,
  useNativeCallKeep,
} from '../src/features/calling/hooks/useNativeCallKeep';
import { AppUpdateBanner } from '../src/features/updates/components/AppUpdateBanner';
import { useAutoUpdate } from '../src/features/updates/hooks/useAutoUpdate';

// Register Android killed/background FCM handler once at module load
registerBackgroundFcmHandler();

export default function RootLayout() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const autoUpdate = useAutoUpdate();

  const handleNativeAccepted = useCallback(
    (sessionId: string) => {
      router.push(`/call/${sessionId}`);
    },
    [router],
  );

  useNativeCallKeep(user?.id, handleNativeAccepted);

  const {
    incomingSession,
    processing,
    acceptIncomingCall,
    declineIncomingCall,
  } = useIncomingCall(user?.id);

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace('/');
    }
  }, [loading, router, segments, user]);

  const handleAccept = async () => {
    const joinData = await acceptIncomingCall();
    if (joinData) {
      router.push(`/call/${joinData.session.id}`);
    }
  };

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="small" color="#1FD5F9" />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Slot />
      <AppUpdateBanner
        state={autoUpdate.state}
        onApply={autoUpdate.applyUpdate}
        onDismiss={autoUpdate.dismiss}
      />
      <IncomingCallModal
        session={incomingSession}
        processing={processing}
        onAccept={handleAccept}
        onDecline={declineIncomingCall}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loader: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
