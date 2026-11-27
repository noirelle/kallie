import { Slot, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { Component, ReactNode, useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { scheduleAfterPaint } from '../src/lib/scheduleAfterPaint';
import { useAuth } from '../src/features/auth/hooks/useAuth';
import { IncomingCallModal } from '../src/features/calling/components/IncomingCallModal';
import {
  ActiveCallProvider,
  useActiveCallActions,
} from '../src/features/calling/context/ActiveCallContext';
import { useIncomingCall } from '../src/features/calling/hooks/useIncomingCall';
import {
  registerBackgroundFcmHandler,
  useNativeCallKeep,
} from '../src/features/calling/hooks/useNativeCallKeep';
import { useAuraGuide } from '../src/features/onboarding/hooks/useAuraGuide';
import { useOnboardingPermissions } from '../src/features/onboarding/hooks/useOnboardingPermissions';
import { permissionManager } from '../src/features/permissions/lib/permissionManager';
import { AppUpdateBanner } from '../src/features/updates/components/AppUpdateBanner';
import { useAutoUpdate } from '../src/features/updates/hooks/useAutoUpdate';
import { startRealtimeSync, syncUserData } from '../src/features/schedules/lib/syncEngine';

// Register Android killed/background FCM handler once at module load (required by RNFB).
// LiveKit native globals are initialized lazily post-first-paint by ActiveCallProvider.
registerBackgroundFcmHandler();

let cachedOnboardingFlow:
  | typeof import('../src/features/onboarding/components/OnboardingFlow').OnboardingFlow
  | null = null;
let cachedAuraGuideSlider:
  | typeof import('../src/features/onboarding/components/AuraGuideSlider').AuraGuideSlider
  | null = null;

function getOnboardingFlowComponent() {
  if (!cachedOnboardingFlow) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../src/features/onboarding/components/OnboardingFlow') as typeof import('../src/features/onboarding/components/OnboardingFlow');
    cachedOnboardingFlow = mod.OnboardingFlow;
  }
  return cachedOnboardingFlow;
}

function getAuraGuideSliderComponent() {
  if (!cachedAuraGuideSlider) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../src/features/onboarding/components/AuraGuideSlider') as typeof import('../src/features/onboarding/components/AuraGuideSlider');
    cachedAuraGuideSlider = mod.AuraGuideSlider;
  }
  return cachedAuraGuideSlider;
}

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
  const auraGuide = useAuraGuide(user?.id);
  const segments = useSegments();
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const autoUpdate = useAutoUpdate();
  const activeCall = useActiveCallActions();

  const isNavReady = Boolean(rootNavigationState?.key);

  const openAuraHome = useCallback(() => {
    if (!isNavReady) return;
    if (segments[0] !== undefined) {
      router.replace('/');
    }
  }, [isNavReady, router, segments]);

  const handleAnswerSession = useCallback(
    async (sessionId: string, options: { openUi: boolean }) => {
      if (options.openUi) {
        openAuraHome();
      }
      return activeCall.joinSessionById(sessionId);
    },
    [activeCall, openAuraHome],
  );

  const handleNativeAccepted = useCallback(
    (sessionId: string) => {
      openAuraHome();
      void activeCall.joinSessionById(sessionId);
    },
    [activeCall, openAuraHome],
  );

  const {
    incomingSession,
    processing,
    presentForegroundPush,
    dismissSession,
    acceptIncomingCall,
    declineIncomingCall,
  } = useIncomingCall(user?.id, {
    activeSessionId: activeCall.activeSessionId,
    onAnswerSession: handleAnswerSession,
    onOpenActiveCall: openAuraHome,
    onHangUpSession: activeCall.endActiveCall,
  });

  useNativeCallKeep(user?.id, handleNativeAccepted, onboarding.completed, {
    onForegroundIncomingCall: presentForegroundPush,
    onForegroundCallEnded: dismissSession,
  });

  const isBooting = loading || !onboarding.hydrated || (Boolean(user) && !auraGuide.hydrated);
  const inAuthGroup = segments[0] === '(auth)';
  const needsAuthRedirect =
    !isBooting && isNavReady && ((!user && !inAuthGroup) || (Boolean(user) && inAuthGroup));
  const showOnboarding = onboarding.hydrated && !onboarding.completed;
  const showAuraGuide =
    !showOnboarding && Boolean(user) && auraGuide.hydrated && !auraGuide.completed;
  const showBootOverlay =
    isBooting || !isNavReady || (!showOnboarding && !showAuraGuide && needsAuthRedirect);

  useEffect(() => {
    const enforceHiddenStatusBar = () => {
      RNStatusBar.setHidden(true, 'fade');
    };
    enforceHiddenStatusBar();
    // Silently keep permission state synchronized (detecting revocations in Settings)
    // without ever displaying an unprompted OS permission dialog on boot or resume.
    const cancelPermSync = scheduleAfterPaint(() => {
      void permissionManager.refreshAll();
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        enforceHiddenStatusBar();
        void permissionManager.refreshAll();
      }
    });
    return () => {
      cancelPermSync();
      sub.remove();
    };
  }, []);

  // Keep local SQLite schedules & call history synchronized via 1 unified Realtime channel + delta pull.
  // Deferred past initial frame paint so Home Aura renders with zero boot contention.
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;

    let stopRealtime: (() => void) | null = null;
    const cancelDeferred = scheduleAfterPaint(() => {
      stopRealtime = startRealtimeSync(uid);
      void syncUserData(uid);
    });

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void syncUserData(uid);
      }
    });

    return () => {
      cancelDeferred();
      stopRealtime?.();
      sub.remove();
    };
  }, [user?.id]);

  useEffect(() => {
    if (isBooting || !isNavReady) return;

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace('/');
    }
  }, [inAuthGroup, isBooting, isNavReady, router, user]);

  const handleAccept = async () => {
    await acceptIncomingCall();
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
      <StatusBar style="light" hidden animated />
      <Slot />

      {showOnboarding
        ? (() => {
            const OnboardingFlowComp = getOnboardingFlowComponent();
            return (
              <View style={styles.fullOverlay}>
                <OnboardingFlowComp
                  discoverySource={onboarding.discoverySource}
                  onSelectDiscovery={onboarding.setDiscoverySource}
                  interests={onboarding.interests}
                  onToggleInterest={onboarding.toggleInterest}
                  permissions={onboarding.permissions}
                  busyKey={onboarding.busyKey}
                  showFullScreenIntentToggle={onboarding.supportsFullScreenIntentToggle}
                  onToggleNotifications={onboarding.toggleNotifications}
                  onToggleMicrophone={onboarding.toggleMicrophone}
                  onToggleFullScreenIntent={onboarding.toggleFullScreenIntent}
                  onComplete={handleCompleteOnboarding}
                />
              </View>
            );
          })()
        : null}

      {showAuraGuide
        ? (() => {
            const AuraGuideSliderComp = getAuraGuideSliderComponent();
            return (
              <View style={styles.fullOverlay}>
                <AuraGuideSliderComp onComplete={auraGuide.completeGuide} />
              </View>
            );
          })()
        : null}

      {showBootOverlay ? (
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
        <ActiveCallProvider>
          <RootLayoutContent />
        </ActiveCallProvider>
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
