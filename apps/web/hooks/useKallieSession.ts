'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import {
  type CallScheduleRow,
  type CallSessionRow,
  kallieApi,
  supabase,
} from '@/lib/kallieClient';

function startRingtone(): () => void {
  if (typeof window === 'undefined') return () => {};
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return () => {};

  let stopped = false;
  const ctx = new AudioCtx();

  const chime = () => {
    if (stopped) return;
    const now = ctx.currentTime;
    [523.25, 659.25].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.18);
      gain.gain.setValueAtTime(0.001, now + idx * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.1, now + idx * 0.18 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.18 + 0.42);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.18);
      osc.stop(now + idx * 0.18 + 0.45);
    });
  };

  chime();
  const id = setInterval(chime, 2200);
  return () => {
    stopped = true;
    clearInterval(id);
    ctx.close().catch(() => {});
  };
}

export function useKallieSession() {
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [incomingCall, setIncomingCall] = useState<CallSessionRow | null>(null);
  const [upcomingReminders, setUpcomingReminders] = useState<CallScheduleRow[]>([]);
  const stopRingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setAuthSession(data.session ?? null);
        setAuthLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) {
        setAuthSession(next ?? null);
        setAuthLoading(false);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const user: User | null = authSession?.user ?? null;

  const refreshReminders = useCallback(async () => {
    if (!user?.id) {
      setUpcomingReminders([]);
      return;
    }
    const { data } = await supabase
      .from('call_schedules')
      .select('id, title, ai_prompt, next_run_at, recurrence, status')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('next_run_at', { ascending: true })
      .limit(5);

    setUpcomingReminders((data || []) as CallScheduleRow[]);
  }, [user?.id]);

  useEffect(() => {
    refreshReminders();
  }, [refreshReminders]);

  useEffect(() => {
    if (!user?.id) {
      setIncomingCall(null);
      return;
    }

    const callsChannel = supabase
      .channel(`kallie-web-calls-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_sessions',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as CallSessionRow;
          if (row.status === 'ringing') {
            setIncomingCall(row);
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'call_sessions',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as CallSessionRow;
          setIncomingCall((curr) => {
            if (!curr || curr.id !== row.id) return curr;
            return row.status === 'ringing' ? row : null;
          });
        },
      )
      .subscribe();

    const schedulesChannel = supabase
      .channel(`kallie-web-schedules-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'call_schedules',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void refreshReminders();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(callsChannel);
      supabase.removeChannel(schedulesChannel);
    };
  }, [refreshReminders, user?.id]);

  useEffect(() => {
    if (incomingCall) {
      stopRingRef.current?.();
      stopRingRef.current = startRingtone();
    } else {
      stopRingRef.current?.();
      stopRingRef.current = null;
    }
    return () => {
      stopRingRef.current?.();
      stopRingRef.current = null;
    };
  }, [incomingCall]);

  const declineIncoming = useCallback(async () => {
    if (!incomingCall) return;
    const id = incomingCall.id;
    setIncomingCall(null);
    await kallieApi.declineCall(id).catch(() => {});
  }, [incomingCall]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return {
    user,
    authLoading,
    incomingCall,
    setIncomingCall,
    upcomingReminders,
    refreshReminders,
    declineIncoming,
    signOut,
  };
}
