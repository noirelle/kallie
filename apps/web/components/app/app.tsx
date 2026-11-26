'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { TokenSource } from 'livekit-client';
import { useSession } from '@livekit/components-react';
import { WarningIcon } from '@phosphor-icons/react/dist/ssr';
import { AgentSessionProvider } from '@/components/agents-ui/agent-session-provider';
import { StartAudioButton } from '@/components/agents-ui/start-audio-button';
import { AuthGate } from '@/components/app/AuthGate';
import { IncomingCallbackOverlay } from '@/components/app/IncomingCallbackOverlay';
import { ViewController } from '@/components/app/view-controller';
import { Toaster } from '@/components/ui/sonner';
import { useAgentErrors } from '@/hooks/useAgentErrors';
import { useDebugMode } from '@/hooks/useDebug';
import { useKallieSession } from '@/hooks/useKallieSession';
import { kallieApi } from '@/lib/kallieClient';

const IN_DEVELOPMENT = process.env.NODE_ENV !== 'production';

function AppSetup() {
  useDebugMode({ enabled: IN_DEVELOPMENT });
  useAgentErrors();

  return null;
}

interface AppProps {
  agentName?: string;
}

export function App({ agentName }: AppProps) {
  const {
    user,
    authLoading,
    incomingCall,
    setIncomingCall,
    upcomingReminders,
    refreshReminders,
    declineIncoming,
    signOut,
  } = useKallieSession();

  const [acceptingCall, setAcceptingCall] = useState(false);
  const pendingAcceptSessionIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const userEmailRef = useRef<string>('Kallie User');
  userEmailRef.current = user?.email || 'Kallie User';

  const tokenSource = useMemo(
    () =>
      TokenSource.custom(async () => {
        const acceptId = pendingAcceptSessionIdRef.current;
        pendingAcceptSessionIdRef.current = null;

        const joinData = acceptId
          ? await kallieApi.acceptCall(acceptId)
          : await kallieApi.startCall();

        activeSessionIdRef.current = joinData.session.id;

        return {
          serverUrl: joinData.livekitUrl,
          roomName: joinData.roomName,
          participantName: userEmailRef.current,
          participantToken: joinData.token,
        };
      }),
    [],
  );

  const sessionOptions = useMemo(
    () => (agentName ? { agentName } : undefined),
    [agentName],
  );

  const session = useSession(tokenSource, sessionOptions);

  const handleAcceptIncoming = useCallback(async () => {
    if (!incomingCall || acceptingCall) return;
    setAcceptingCall(true);
    try {
      pendingAcceptSessionIdRef.current = incomingCall.id;
      setIncomingCall(null);
      await session.start();
    } finally {
      setAcceptingCall(false);
    }
  }, [acceptingCall, incomingCall, session, setIncomingCall]);

  const handleSessionDisconnected = useCallback(() => {
    const endedId = activeSessionIdRef.current;
    if (endedId) {
      activeSessionIdRef.current = null;
      void kallieApi.endCall(endedId).catch(() => {});
      void refreshReminders();
    }
  }, [refreshReminders]);

  if (authLoading) {
    return (
      <div className="bg-background flex h-svh items-center justify-center">
        <span className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
          Loading...
        </span>
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  return (
    <AgentSessionProvider session={session}>
      <AppSetup />

      <header className="fixed top-0 left-0 z-40 flex w-full items-center justify-between p-6">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/kallie-logo.svg" alt="Kallie" className="size-6 rounded" />
          <span className="text-foreground font-mono text-xs font-bold tracking-wider uppercase">
            Kallie
          </span>
        </div>

        <button
          type="button"
          onClick={signOut}
          className="text-muted-foreground hover:text-foreground font-mono text-[11px] tracking-wider uppercase transition-colors"
        >
          Sign out
        </button>
      </header>

      <main className="grid h-svh grid-cols-1 place-content-center">
        <ViewController
          upcomingReminders={upcomingReminders}
          onSessionDisconnected={handleSessionDisconnected}
        />
      </main>

      <IncomingCallbackOverlay
        call={incomingCall}
        accepting={acceptingCall}
        onAccept={handleAcceptIncoming}
        onDecline={declineIncoming}
      />

      <StartAudioButton label="Start Audio" />
      <Toaster
        icons={{
          warning: <WarningIcon weight="bold" />,
        }}
        position="top-center"
        className="toaster group"
        style={
          {
            '--normal-bg': 'var(--popover)',
            '--normal-text': 'var(--popover-foreground)',
            '--normal-border': 'var(--border)',
          } as React.CSSProperties
        }
      />
    </AgentSessionProvider>
  );
}
