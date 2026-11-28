import { useFonts } from 'expo-font';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
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
import { IncomingCallModal } from '../src/features/calling/components/IncomingCallModal';
import {
  ActiveCallProvider,
  useActiveCallActions,
} from '../src/features/calling/context/ActiveCallContext';
import { useIncomingCall } from '../src/features/calling/hooks/useIncomingCall';
import { nativeIncomingCall } from '../src/features/calling/lib/nativeIncomingCall';
import {
  OnboardingFlow,
  OnboardingIntent,
} from '../src/features/onboarding/components/OnboardingFlow';
import { startOpenRouterOAuth } from '../src/features/ai/lib/openRouterAuth';
import { useOnboardingPermissions } from '../src/features/onboarding/hooks/useOnboardingPermissions';
import { permissionManager } from '../src/features/permissions/lib/permissionManager';
import { syncLocalAlarms } from '../src/features/schedules/lib/schedulesRepository';
import { AppUpdateBanner } from '../src/features/updates/components/AppUpdateBanner';
import { useAutoUpdate } from '../src/features/updates/hooks/useAutoUpdate';
import { scheduleAfterPaint } from '../src/lib/scheduleAfterPaint';
import { hydrateLocalInstallationId } from '../src/lib/storage/localIdentity';
import { MONO, TYPE } from '../src/theme/monoTheme';

const FONT_ASSETS = {
  Geist_400Regular: require('@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf'),
  Geist_500Medium: require('@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf'),
  Geist_600SemiBold: require('@expo-google-fonts/geist/600SemiBold/Geist_600SemiBold.ttf'),
  GeistMono_400Regular: require('@expo-google-fonts/geist-mono/400Regular/GeistMono_400Regular.ttf'),
};

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
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const onboarding = useOnboardingPermissions();
  const segments = useSegments();
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const autoUpdate = useAutoUpdate();
  const activeCall = useActiveCallActions();

  const isNavReady = Boolean(rootNavigationState?.key);
  const fontsReady = fontsLoaded || Boolean(fontError);

  const openAuraHome = useCallback(() => {
    if (!isNavReady) return;
    if (segments[0] !== undefined) {
      router.replace('/');
    }
  }, [isNavReady, router, segments]);

  const handleStartScheduledCallback = useCallback(
    async (payload: { title: string; aiPrompt: string; openUi: boolean }) => {
      if (payload.openUi) {
        openAuraHome();
      }
      return activeCall.startImmediateCall({
        title: payload.title,
        aiPrompt: payload.aiPrompt,
        isScheduledCallback: true,
      });
    },
    [activeCall, openAuraHome],
  );

  const {
    incomingSession,
    processing,
    acceptIncomingCall,
    declineIncomingCall,
  } = useIncomingCall({
    activeSessionId: activeCall.activeSessionId,
    onStartScheduledCallback: handleStartScheduledCallback,
    onOpenActiveCall: openAuraHome,
    onHangUpSession: activeCall.endActiveCall,
  });

  useEffect(() => {
    const enforceHiddenStatusBar = () => {
      RNStatusBar.setHidden(true, 'fade');
    };
    enforceHiddenStatusBar();

    const cancelInit = scheduleAfterPaint(() => {
      nativeIncomingCall.ensureChannels();
      void hydrateLocalInstallationId();
      syncLocalAlarms();
      void permissionManager.refreshAll();
    });

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        enforceHiddenStatusBar();
        syncLocalAlarms();
        void permissionManager.refreshAll();
      }
    });

    return () => {
      cancelInit();
      sub.remove();
    };
  }, []);

  const handleCompleteOnboarding = useCallback(
    async (intent: OnboardingIntent) => {
      await onboarding.completeOnboarding();
      if (!isNavReady) return;
      if (intent === 'openrouter_oauth') {
        await startOpenRouterOAuth().catch(() => {
          router.push('/settings');
        });
      } else if (intent === 'pair_desktop') {
        router.push('/settings?tab=desktop');
      } else if (intent === 'setup_provider') {
        router.push('/settings');
      }
    },
    [isNavReady, onboarding, router],
  );

  const isDeepLinkOnboardingBypass =
    segments[0] === 'pair' || segments[0] === 'oauth';
  const showOnboarding =
    onboarding.hydrated && !onboarding.completed && !isDeepLinkOnboardingBypass;
  const showBootOverlay = !fontsReady || !onboarding.hydrated || !isNavReady;

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden animated />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#000000' },
          animation: 'fade',
          animationDuration: 200,
        }}
      />

      {showOnboarding ? (
        <View style={styles.fullOverlay}>
          <OnboardingFlow onComplete={handleCompleteOnboarding} />
        </View>
      ) : null}

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
        onAccept={() => void acceptIncomingCall()}
        onDecline={() => void declineIncomingCall()}
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
    ...TYPE.heading,
    color: MONO.textPrimary,
    marginBottom: 8,
  },
  errorDetail: {
    ...TYPE.caption,
    color: MONO.textSecondary,
    textAlign: 'center',
    marginBottom: 22,
  },
  retryBtn: {
    backgroundColor: MONO.white,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryBtnText: {
    ...TYPE.button,
    color: MONO.black,
  },
});
