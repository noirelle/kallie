import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { apiClient } from '../../../lib/apiClient';
import { setPendingCallConnection } from '../../../lib/callSessionStore';
import { supabase } from '../../../lib/supabaseClient';
import { CallSession, JoinCallResponse } from '../../../types/database';

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

export function useIncomingCall(userId: string | undefined) {
  const [incomingSession, setIncomingSession] = useState<CallSession | null>(null);
  const [processing, setProcessing] = useState(false);
  const stopRingtoneRef = useRef<(() => void) | null>(null);

  const stopRingtone = useCallback(() => {
    if (stopRingtoneRef.current) {
      stopRingtoneRef.current();
      stopRingtoneRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (incomingSession) {
      stopRingtone();
      stopRingtoneRef.current = startWebRingtone();
    } else {
      stopRingtone();
    }

    return stopRingtone;
  }, [incomingSession, stopRingtone]);

  useEffect(() => {
    if (!userId) {
      setIncomingSession(null);
      return;
    }

    const channel = supabase
      .channel(`incoming-calls-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_sessions',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const next = payload.new as CallSession;
          if (next.status === 'ringing') {
            setIncomingSession(next);
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'call_sessions',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as CallSession;
          setIncomingSession((current) => {
            if (!current || current.id !== updated.id) {
              return current;
            }
            return updated.status === 'ringing' ? updated : null;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const acceptIncomingCall = useCallback(async (): Promise<JoinCallResponse | null> => {
    if (!incomingSession || processing) {
      return null;
    }

    setProcessing(true);
    try {
      const joinData = await apiClient.acceptCall(incomingSession.id);
      setPendingCallConnection(joinData);
      setIncomingSession(null);
      return joinData;
    } finally {
      setProcessing(false);
    }
  }, [incomingSession, processing]);

  const declineIncomingCall = useCallback(async () => {
    if (!incomingSession || processing) {
      return;
    }

    setProcessing(true);
    try {
      await apiClient.declineCall(incomingSession.id);
      setIncomingSession(null);
    } finally {
      setProcessing(false);
    }
  }, [incomingSession, processing]);

  return {
    incomingSession,
    processing,
    acceptIncomingCall,
    declineIncomingCall,
  };
}
