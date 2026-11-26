import { Slot, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { Component, ReactNode, useCallback, useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth } from '../src/features/auth/hooks/useAuth';
import { IncomingCallModal } from '../src/features/calling/components/IncomingCallModal';
import { useIncomingCall } from '../src/features/calling/hooks/useIncomingCall';
import { registerLiveKitGlobals } from '../src/features/calling/hooks/useLiveKitCall';
import {
  registerBackgroundFcmHandler,
  useNativeCallKeep,
} from '../src/features/calling/hooks/useNativeCallKeep';
import { OnboardingFlow } from '../src/features/onboarding/components/OnboardingFlow';
import { useOnboardingPermissions } from '../src/features/onboarding/hooks/useOnboardingPermissions';
import { AppUpdateBanner } from '../src/features/updates/components/AppUpdateBanner';
import { useAutoUpdate } from '../src/features/updates/hooks/useAutoUpdate';

// Register native WebRTC globals & Android killed/background FCM handler once at module load
registerLiveKitGlobals();
registerBackgroundFcmHandler();

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'Unexpected error' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorDetail}>{this.state.message}</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => this.setState({ hasError: false, message: '' })}
          >
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

function RootLayoutContent() {
  const { user, loading } = useAuth();
  const onboarding = useOnboardingPermissions();
  const segments = useSegments();
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const autoUpdate = useAutoUpdate();

  const handleNativeAccepted = useCallback(
    (sessionId: string) => {
      router.push(`/call/${sessionId}`);
    },
    [router],
  );

  useNativeCallKeep(user?.id, handleNativeAccepted, onboarding.completed);

  const {
    incomingSession,
    processing,
    acceptIncomingCall,
    declineIncomingCall,
  } = useIncomingCall(user?.id);

  const isNavReady = Boolean(rootNavigationState?.key);
  const isBooting = loading || !onboarding.hydrated;

  useEffect(() => {
    if (isBooting || !isNavReady) return;
    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace('/');
    }
  }, [isBooting, isNavReady, router, segments, user]);

  const handleAccept = async () => {
    const joinData = await acceptIncomingCall();
    if (joinData) {
      router.push(`/call/${joinData.session.id}`);
    }
  };

  const handleCompleteOnboarding = useCallback(
    async (intent: 'signup' | 'login') => {
      await onboarding.completeOnboarding();
      if (!user && isNavReady) {
        router.replace(intent === 'signup' ? '/(auth)/register' : '/(auth)/login');
      }
    },
    [isNavReady, onboarding, router, user],
  );

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Slot />

      {onboarding.hydrated && !onboarding.completed ? (
        <View style={styles.fullOverlay}>
          <OnboardingFlow
            discoverySource={onboarding.discoverySource}
            onSelectDiscovery={onboarding.setDiscoverySource}
            interests={onboarding.interests}
            onToggleInterest={onboarding.toggleInterest}
            permissions={onboarding.permissions}
            busyKey={onboarding.busyKey}
            onToggleNotifications={onboarding.toggleNotifications}
            onToggleMicrophone={onboarding.toggleMicrophone}
            onComplete={handleCompleteOnboarding}
          />
        </View>
      ) : null}

      {isBooting ? (
        <View style={styles.loaderOverlay}>
          <ActivityIndicator size="small" color="#FFFFFF" />
        </View>
      ) : null}

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

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <RootLayoutContent />
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  fullOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
    zIndex: 80,
  },
  loaderOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorDetail: {
    color: '#A1A1AA',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '600',
  },
});
