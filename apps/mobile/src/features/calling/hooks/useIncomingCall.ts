import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Vibration } from 'react-native';
import { CallSession } from '../../../types/database';
import {
  IncomingCallIntentEvent,
  nativeIncomingCall,
} from '../lib/nativeIncomingCall';

const RING_TIMEOUT_MS = 35_000;

function createLocalReminderSession(payload: {
  sessionId: string;
  title?: string;
  aiPrompt?: string;
}): CallSession {
  const now = new Date().toISOString();
  const customPrompt = payload.aiPrompt?.trim();
  return {
    id: payload.sessionId,
    schedule_id: payload.sessionId,
    room_name: '',
    title: payload.title || 'Kallie Reminder',
    ai_prompt:
      customPrompt ||
      (payload.title
        ? `Follow up warmly on their local scheduled reminder: "${payload.title}".`
        : 'Follow up warmly on their scheduled local reminder.'),
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
  onStartScheduledCallback: (payload: {
    title: string;
    aiPrompt: string;
    openUi: boolean;
  }) => Promise<boolean>;
  onOpenActiveCall: () => void;
  onHangUpSession: (sessionId?: string) => void;
}

/**
 * Handles native Android AlarmManager incoming reminder intents locally with zero
 * Supabase Realtime or cloud push dependency.
 */
export function useIncomingCall(callbacks: UseIncomingCallCallbacks) {
  const initialPendingRef = useRef<IncomingCallIntentEvent | null | undefined>(undefined);
  if (initialPendingRef.current === undefined) {
    initialPendingRef.current =
      Platform.OS === 'android' ? nativeIncomingCall.consumePendingCallIntentSync() : null;
  }

  const [incomingSession, setIncomingSession] = useState<CallSession | null>(() => {
    const initial = initialPendingRef.current;
    if (initial && initial.action === 'show' && initial.sessionId) {
      return createLocalReminderSession({
        sessionId: initial.sessionId,
        title: initial.title,
        aiPrompt: initial.aiPrompt,
      });
    }
    return null;
  });
  const [processing, setProcessing] = useState(false);

  const handledSessionsRef = useRef<Set<string>>(new Set());
  const processingRef = useRef(false);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const stopRingingFeedback = useCallback(() => {
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

  const handleNativeIntent = useCallback(
    async (event: IncomingCallIntentEvent) => {
      if (!event.action) return;
      const { action, sessionId, title, aiPrompt } = event;

      if (action === 'hangup') {
        if (sessionId) markHandled(sessionId);
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

      if (!sessionId) return;

      if (action === 'decline') {
        dismissSession(sessionId);
        return;
      }

      if (action === 'answer' || action === 'answer_background') {
        if (handledSessionsRef.current.has(sessionId) || processingRef.current) {
          if (action === 'answer') callbacksRef.current.onOpenActiveCall();
          return;
        }
        markHandled(sessionId);
        nativeIncomingCall.dismissIncomingCall(sessionId);
        stopRingingFeedback();
        setIncomingSession(null);

        processingRef.current = true;
        setProcessing(true);
        try {
          const placeholder = createLocalReminderSession({ sessionId, title, aiPrompt });
          const started = await callbacksRef.current.onStartScheduledCallback({
            title: placeholder.title,
            aiPrompt: placeholder.ai_prompt,
            openUi: action === 'answer',
          });
          if (started && action === 'answer_background' && Platform.OS === 'android') {
            setTimeout(() => {
              nativeIncomingCall.moveToBackground();
            }, 450);
          }
        } finally {
          processingRef.current = false;
          setProcessing(false);
        }
        return;
      }

      if (handledSessionsRef.current.has(sessionId)) {
        nativeIncomingCall.dismissIncomingCall(sessionId);
        return;
      }

      setIncomingSession(createLocalReminderSession({ sessionId, title, aiPrompt }));
    },
    [dismissSession, markHandled, stopRingingFeedback],
  );

  useEffect(() => {
    if (!incomingSession) {
      stopRingingFeedback();
      if (Platform.OS === 'android') {
        nativeIncomingCall.setKeepScreenOn(false);
      }
      return;
    }
    if (Platform.OS === 'android') {
      nativeIncomingCall.setKeepScreenOn(true);
      Vibration.vibrate([0, 450, 1000], true);
    }
    const id = incomingSession.id;
    const timer = setTimeout(() => dismissSession(id), RING_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
      stopRingingFeedback();
      if (Platform.OS === 'android') {
        nativeIncomingCall.setKeepScreenOn(false);
      }
    };
  }, [dismissSession, incomingSession, stopRingingFeedback]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let mounted = true;

    const initial = initialPendingRef.current;
    if (initial && initial.action !== 'show') {
      initialPendingRef.current = null;
      void handleNativeIntent(initial);
    } else {
      initialPendingRef.current = null;
    }

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
  }, [handleNativeIntent]);

  const acceptIncomingCall = useCallback(async (): Promise<boolean> => {
    if (!incomingSession || processingRef.current) return false;
    const session = incomingSession;
    markHandled(session.id);
    nativeIncomingCall.dismissIncomingCall(session.id);
    stopRingingFeedback();
    setIncomingSession(null);

    processingRef.current = true;
    setProcessing(true);
    try {
      return await callbacksRef.current.onStartScheduledCallback({
        title: session.title,
        aiPrompt: session.ai_prompt,
        openUi: true,
      });
    } catch {
      return false;
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }, [incomingSession, markHandled, stopRingingFeedback]);

  const declineIncomingCall = useCallback(async () => {
    if (!incomingSession || processingRef.current) return;
    dismissSession(incomingSession.id);
    stopRingingFeedback();
  }, [dismissSession, incomingSession, stopRingingFeedback]);

  return {
    incomingSession,
    processing,
    dismissSession,
    acceptIncomingCall,
    declineIncomingCall,
  };
}
