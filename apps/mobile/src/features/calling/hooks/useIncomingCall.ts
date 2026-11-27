import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Vibration } from 'react-native';
import { apiClient } from '../../../lib/apiClient';
import { supabase } from '../../../lib/supabaseClient';
import { CallSession, JoinCallResponse } from '../../../types/database';
import { subscribeCallSessionEvents } from '../../schedules/lib/syncEngine';
import {
  IncomingCallIntentEvent,
  nativeIncomingCall,
} from '../lib/nativeIncomingCall';
import { ForegroundIncomingCallPayload } from './useNativeCallKeep';

const RING_TIMEOUT_MS = 35_000;

function startWebRingtone(): () => void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return () => {};
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioCtx) {
    return () => {};
  }

  let stopped = false;
  const ctx = new AudioCtx();

  const playChime = () => {
    if (stopped) return;
    const now = ctx.currentTime;
    [523.25, 659.25].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.18);
      gain.gain.setValueAtTime(0.001, now + idx * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.12, now + idx * 0.18 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.18 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.18);
      osc.stop(now + idx * 0.18 + 0.5);
    });
  };

  playChime();
  const intervalId = setInterval(playChime, 2200);

  return () => {
    stopped = true;
    clearInterval(intervalId);
    ctx.close().catch(() => {});
  };
}

function createPlaceholderSession(
  userId: string,
  payload: { sessionId: string; title?: string; roomName?: string },
): CallSession {
  const now = new Date().toISOString();
  return {
    id: payload.sessionId,
    schedule_id: null,
    user_id: userId,
    room_name: payload.roomName || '',
    title: payload.title || 'Kallie',
    ai_prompt: '',
    status: 'ringing',
    started_at: null,
    ended_at: null,
    transcript: [],
    summary: null,
    created_at: now,
    updated_at: now,
  };
}

export interface UseIncomingCallCallbacks {
  activeSessionId?: string | null;
  onAnswerSession: (
    sessionId: string,
    options: { openUi: boolean },
  ) => Promise<JoinCallResponse | null>;
  onOpenActiveCall: () => void;
  onHangUpSession: (sessionId?: string) => void;
}

export function useIncomingCall(
  userId: string | undefined,
  callbacks: UseIncomingCallCallbacks,
) {
  const [incomingSession, setIncomingSession] = useState<CallSession | null>(null);
  const [processing, setProcessing] = useState(false);

  const stopRingtoneRef = useRef<(() => void) | null>(null);
  const handledSessionsRef = useRef<Set<string>>(new Set());
  const incomingSessionIdRef = useRef<string | null>(null);
  const processingRef = useRef(false);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  incomingSessionIdRef.current = incomingSession?.id ?? null;

  const stopRingingFeedback = useCallback(() => {
    if (stopRingtoneRef.current) {
      stopRingtoneRef.current();
      stopRingtoneRef.current = null;
    }
    if (Platform.OS === 'android') {
      Vibration.cancel();
    }
  }, []);

  const markHandled = useCallback((sessionId: string) => {
    handledSessionsRef.current.add(sessionId);
    if (handledSessionsRef.current.size > 50) {
      const first = handledSessionsRef.current.values().next().value;
      if (first) handledSessionsRef.current.delete(first);
    }
  }, []);

  const dismissSession = useCallback(
    (sessionId: string) => {
      markHandled(sessionId);
      nativeIncomingCall.dismissIncomingCall(sessionId);
      setIncomingSession((current) =>
        current && current.id === sessionId ? null : current,
      );
    },
    [markHandled],
  );

  const presentIncomingSession = useCallback((session: CallSession) => {
    if (
      handledSessionsRef.current.has(session.id) ||
      callbacksRef.current.activeSessionId === session.id
    ) {
      return;
    }
    if (session.status !== 'ringing') {
      return;
    }
    setIncomingSession((current) => {
      if (current && current.id === session.id) {
        return current;
      }
      return session;
    });
  }, []);

  const presentForegroundPush = useCallback(
    (payload: ForegroundIncomingCallPayload) => {
      if (
        !userId ||
        handledSessionsRef.current.has(payload.sessionId) ||
        callbacksRef.current.activeSessionId === payload.sessionId
      ) {
        return;
      }
      presentIncomingSession(createPlaceholderSession(userId, payload));
    },
    [presentIncomingSession, userId],
  );

  const handleNativeIntent = useCallback(
    async (event: IncomingCallIntentEvent) => {
      if (!event.action) return;
      const { action, sessionId, title } = event;

      if (action === 'hangup') {
        if (sessionId) {
          markHandled(sessionId);
        }
        setIncomingSession(null);
        stopRingingFeedback();
        callbacksRef.current.onHangUpSession(sessionId || undefined);
        return;
      }

      if (action === 'open_active') {
        setIncomingSession(null);
        callbacksRef.current.onOpenActiveCall();
        return;
      }

      if (!userId || !sessionId) return;

      if (action === 'decline') {
        dismissSession(sessionId);
        // Native receiver already calls /decline-push via goAsync(); also ensure
        // authenticated fallback decline when triggered from an active JS session.
        void apiClient.declineCall(sessionId).catch(() => {});
        return;
      }

      if (action === 'answer' || action === 'answer_background') {
        if (
          callbacksRef.current.activeSessionId === sessionId ||
          handledSessionsRef.current.has(sessionId) ||
          processingRef.current
        ) {
          if (action === 'answer') {
            callbacksRef.current.onOpenActiveCall();
          }
          return;
        }

        markHandled(sessionId);
        nativeIncomingCall.dismissIncomingCall(sessionId);
        stopRingingFeedback();
        setIncomingSession(null);

        processingRef.current = true;
        setProcessing(true);
        try {
          await callbacksRef.current.onAnswerSession(sessionId, {
            openUi: action === 'answer',
          });
        } finally {
          processingRef.current = false;
          setProcessing(false);
        }
        return;
      }

      // action === 'show' (full-screen lock-screen wake or notification body tap)
      if (
        handledSessionsRef.current.has(sessionId) ||
        callbacksRef.current.activeSessionId === sessionId
      ) {
        nativeIncomingCall.dismissIncomingCall(sessionId);
        if (callbacksRef.current.activeSessionId === sessionId) {
          callbacksRef.current.onOpenActiveCall();
        }
        return;
      }

      presentIncomingSession(createPlaceholderSession(userId, { sessionId, title }));

      // Verify live session status so stale intents auto-dismiss cleanly
      const { data } = await supabase
        .from('call_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .maybeSingle<CallSession>();

      if (data && data.status !== 'ringing') {
        dismissSession(sessionId);
      } else if (data && data.status === 'ringing' && !handledSessionsRef.current.has(sessionId)) {
        setIncomingSession((current) =>
          current && current.id === sessionId ? data : current,
        );
      }
    },
    [dismissSession, markHandled, presentIncomingSession, stopRingingFeedback, userId],
  );

  // Foreground ringing feedback (web chime / subtle Android vibration) + 35s safety timeout
  useEffect(() => {
    if (!incomingSession) {
      stopRingingFeedback();
      return;
    }

    stopRingingFeedback();
    if (Platform.OS === 'web') {
      stopRingtoneRef.current = startWebRingtone();
    } else if (Platform.OS === 'android') {
      Vibration.vibrate([0, 450, 1000], true);
    }

    const sessionId = incomingSession.id;
    const timeoutId = setTimeout(() => {
      dismissSession(sessionId);
    }, RING_TIMEOUT_MS);

    return () => {
      clearTimeout(timeoutId);
      stopRingingFeedback();
    };
  }, [dismissSession, incomingSession, stopRingingFeedback]);

  // Listen to native Android incoming call & ongoing call intents (cold-start + warm launches)
  useEffect(() => {
    if (!userId || Platform.OS !== 'android') return;

    let mounted = true;
    void nativeIncomingCall.consumePendingCallIntent().then((pending) => {
      if (mounted && pending) {
        void handleNativeIntent(pending);
      }
    });

    const unsubscribe = nativeIncomingCall.subscribeToIntents((event) => {
      void handleNativeIntent(event);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [handleNativeIntent, userId]);

  // Share the single unified Supabase Realtime channel started by syncEngine
  useEffect(() => {
    if (!userId) {
      setIncomingSession(null);
      return;
    }

    return subscribeCallSessionEvents((eventType, session) => {
      if (session.user_id && session.user_id !== userId) {
        return;
      }
      if (eventType === 'INSERT') {
        if (session.status === 'ringing') {
          presentIncomingSession(session);
        }
        return;
      }
      if (session.status !== 'ringing') {
        dismissSession(session.id);
      } else if (incomingSessionIdRef.current === session.id) {
        setIncomingSession(session);
      }
    });
  }, [dismissSession, presentIncomingSession, userId]);

  const acceptIncomingCall = useCallback(async (): Promise<JoinCallResponse | null> => {
    if (!incomingSession || processingRef.current) {
      return null;
    }

    const sessionId = incomingSession.id;
    markHandled(sessionId);
    nativeIncomingCall.dismissIncomingCall(sessionId);
    stopRingingFeedback();
    setIncomingSession(null);

    processingRef.current = true;
    setProcessing(true);
    try {
      return await callbacksRef.current.onAnswerSession(sessionId, { openUi: true });
    } catch {
      return null;
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }, [incomingSession, markHandled, stopRingingFeedback]);

  const declineIncomingCall = useCallback(async () => {
    if (!incomingSession || processingRef.current) {
      return;
    }

    const sessionId = incomingSession.id;
    markHandled(sessionId);
    nativeIncomingCall.dismissIncomingCall(sessionId);
    stopRingingFeedback();
    setIncomingSession(null);

    processingRef.current = true;
    setProcessing(true);
    try {
      await apiClient.declineCall(sessionId);
    } catch {
      // Ignore network errors on decline since modal and notification are already dismissed
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }, [incomingSession, markHandled, stopRingingFeedback]);

  return {
    incomingSession,
    processing,
    presentForegroundPush,
    dismissSession,
    acceptIncomingCall,
    declineIncomingCall,
  };
}
