'use client';

import { memo, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useSessionContext } from '@livekit/components-react';
import { AgentSessionView_01 } from '@/components/agents-ui/blocks/agent-session-view-01';
import { WelcomeView } from '@/components/app/welcome-view';
import type { CallScheduleRow } from '@/lib/kallieClient';

const MotionWelcomeView = motion.create(WelcomeView);
const MotionSessionView = motion.create(AgentSessionView_01);

const VIEW_MOTION_PROPS = {
  variants: {
    visible: { opacity: 1 },
    hidden: { opacity: 0 },
  },
  initial: 'hidden',
  animate: 'visible',
  exit: 'hidden',
  transition: {
    duration: 0.2,
    ease: 'easeOut' as const,
  },
};

const SESSION_CONTROLS = {
  leave: true,
  microphone: true,
  chat: true,
  camera: false,
  screenShare: false,
};

const AUDIO_VISUALIZER_CONFIG = {
  type: 'bar' as const,
};

interface ViewControllerProps {
  upcomingReminders: CallScheduleRow[];
  onSessionDisconnected: () => void;
}

export const ViewController = memo(function ViewController({
  upcomingReminders,
  onSessionDisconnected,
}: ViewControllerProps) {
  const { isConnected, start } = useSessionContext();
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (!isConnected) {
      setIsStarting(false);
      onSessionDisconnected();
    } else {
      setIsStarting(false);
    }
  }, [isConnected, onSessionDisconnected]);

  const handleStartCall = useCallback(async () => {
    if (isStarting || isConnected) return;
    setIsStarting(true);
    try {
      await start();
    } catch {
      setIsStarting(false);
    }
  }, [isConnected, isStarting, start]);

  return (
    <AnimatePresence mode="wait">
      {!isConnected && (
        <MotionWelcomeView
          key="welcome"
          {...VIEW_MOTION_PROPS}
          startButtonText="Start call"
          isStarting={isStarting}
          onStartCall={handleStartCall}
          upcomingReminders={upcomingReminders}
        />
      )}
      {isConnected && (
        <MotionSessionView
          key="session-view"
          {...VIEW_MOTION_PROPS}
          controls={SESSION_CONTROLS}
          audioVisualizer={AUDIO_VISUALIZER_CONFIG}
          isPreConnectBufferEnabled={false}
          themeMode="dark"
          className="fixed inset-0 z-50 h-dvh w-screen bg-black"
        />
      )}
    </AnimatePresence>
  );
});
