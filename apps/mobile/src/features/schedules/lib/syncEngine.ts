import { cacheManager } from '../../../lib/cache/cacheManager';
import { supabase } from '../../../lib/supabaseClient';
import { CallSchedule, CallSession } from '../../../types/database';
import { applyServerSessions } from './callHistoryRepository';
import {
  applyServerSchedules,
  getPendingOutboxItems,
  markOutboxItemCompleted,
  markOutboxItemFailed,
  removeServerDeletedSchedule,
} from './schedulesRepository';

const SYNC_THROTTLE_MS = 2 * 60 * 1000; // 2 minutes for passive foreground sync
const CURSOR_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type CallSessionRealtimeListener = (
  eventType: 'INSERT' | 'UPDATE',
  session: CallSession,
) => void;

const callSessionListeners = new Set<CallSessionRealtimeListener>();

/**
 * Allows foreground hooks (e.g., useIncomingCall) to share the single unified
 * Supabase Realtime channel instead of opening a duplicate WebSocket channel.
 */
export function subscribeCallSessionEvents(
  listener: CallSessionRealtimeListener,
): () => void {
  callSessionListeners.add(listener);
  return () => {
    callSessionListeners.delete(listener);
  };
}

function emitCallSessionEvent(
  eventType: 'INSERT' | 'UPDATE',
  session: CallSession,
): void {
  callSessionListeners.forEach((listener) => {
    try {
      listener(eventType, session);
    } catch {
      // Ignore individual subscriber errors
    }
  });
}

function scheduleCursorKey(userId: string): string {
  return `sync_cursor:schedules:${userId}`;
}

function sessionCursorKey(userId: string): string {
  return `sync_cursor:sessions:${userId}`;
}

function lastFullSyncKey(userId: string): string {
  return `sync_last:${userId}`;
}

/**
 * Flushes all due pending local mutations (schedules upsert/delete) to Supabase
 * with exponential backoff on transient failures.
 */
export async function flushSyncOutbox(userId: string): Promise<void> {
  if (!userId) return;
  await cacheManager.dedupe(`outbox:${userId}`, async () => {
    const items = getPendingOutboxItems(userId);
    for (const item of items) {
      if (item.entity_type !== 'call_schedule') continue;
      try {
        if (item.operation === 'delete') {
          const { error } = await supabase
            .from('call_schedules')
            .delete()
            .eq('id', item.entity_id)
            .eq('user_id', userId);
          if (error) {
            markOutboxItemFailed(item, error.message);
            continue;
          }
          markOutboxItemCompleted(item);
        } else {
          const payload = JSON.parse(item.payload_json) as Record<string, unknown>;
          const { data, error } = await supabase
            .from('call_schedules')
            .upsert(payload, { onConflict: 'id' })
            .select('*')
            .single<CallSchedule>();
          if (error || !data) {
            markOutboxItemFailed(item, error?.message || 'Upsert returned empty');
            continue;
          }
          markOutboxItemCompleted(item, data);
        }
      } catch (err) {
        markOutboxItemFailed(
          item,
          err instanceof Error ? err.message : 'Network error during outbox flush',
        );
      }
    }
  });
}

/**
 * Delta-pulls updated schedules & recent call sessions from Supabase since the
 * last stored cursor, writing them into local SQLite in a single transaction.
 */
export async function syncUserData(
  userId: string,
  options?: { force?: boolean; includeHistory?: boolean },
): Promise<void> {
  if (!userId) return;

  const force = Boolean(options?.force);
  const lastSync = cacheManager.getSync<number>(lastFullSyncKey(userId));
  if (!force && lastSync?.isFresh) {
    // Still flush pending offline mutations immediately if any exist
    if (getPendingOutboxItems(userId).length > 0) {
      await flushSyncOutbox(userId);
    }
    return;
  }

  await cacheManager.dedupe(`sync:${userId}`, async () => {
    // 1. Push pending local edits first so delta pull sees latest server state
    await flushSyncOutbox(userId);

    // 2. Delta-pull schedules & recent call sessions in parallel to save 1 full RTT
    const schedCursor = cacheManager.getSync<string>(scheduleCursorKey(userId))?.value;
    let schedQuery = supabase
      .from('call_schedules')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: true })
      .limit(100);

    if (schedCursor) {
      schedQuery = schedQuery.gt('updated_at', schedCursor);
    }

    const shouldPullHistory = options?.includeHistory !== false;
    const pullSessions = async () => {
      if (!shouldPullHistory) return null;
      const sessCursor = cacheManager.getSync<string>(sessionCursorKey(userId))?.value;
      let sessQuery = supabase
        .from('call_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: true })
        .limit(50);

      if (sessCursor) {
        sessQuery = sessQuery.gt('updated_at', sessCursor);
      }
      return sessQuery;
    };

    const [schedResult, sessResult] = await Promise.all([schedQuery, pullSessions()]);

    if (!schedResult.error && Array.isArray(schedResult.data) && schedResult.data.length > 0) {
      const typed = schedResult.data as CallSchedule[];
      applyServerSchedules(userId, typed);
      const maxUpdated = typed[typed.length - 1]?.updated_at;
      if (maxUpdated) {
        cacheManager.set(scheduleCursorKey(userId), maxUpdated, {
          ttlMs: CURSOR_TTL_MS,
          persist: true,
        });
      }
    }

    if (
      sessResult &&
      !sessResult.error &&
      Array.isArray(sessResult.data) &&
      sessResult.data.length > 0
    ) {
      const typedSessions = sessResult.data as CallSession[];
      applyServerSessions(userId, typedSessions);
      const maxUpdated = typedSessions[typedSessions.length - 1]?.updated_at;
      if (maxUpdated) {
        cacheManager.set(sessionCursorKey(userId), maxUpdated, {
          ttlMs: CURSOR_TTL_MS,
          persist: true,
        });
      }
    }

    cacheManager.set(lastFullSyncKey(userId), Date.now(), {
      ttlMs: SYNC_THROTTLE_MS,
      persist: false,
    });
  });
}

/**
 * Opens ONE unified Supabase Realtime channel per user for both call_schedules
 * and call_sessions (feeding incoming call alerts AND local SQLite history sync).
 */
export function startRealtimeSync(userId: string): () => void {
  if (!userId) return () => {};

  const channel = supabase
    .channel(`kallie-user-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'call_schedules',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new as CallSchedule;
        if (row?.id) {
          applyServerSchedules(userId, [row]);
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'call_schedules',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new as CallSchedule;
        if (row?.id) {
          applyServerSchedules(userId, [row]);
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'call_schedules',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const oldRow = payload.old as { id?: string };
        if (oldRow?.id) {
          removeServerDeletedSchedule(userId, oldRow.id);
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'call_sessions',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new as CallSession;
        if (row?.id) {
          emitCallSessionEvent('INSERT', row);
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
        const row = payload.new as CallSession;
        if (row?.id) {
          emitCallSessionEvent('UPDATE', row);
          if (['completed', 'missed', 'declined'].includes(row.status)) {
            applyServerSessions(userId, [row]);
          }
        }
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
