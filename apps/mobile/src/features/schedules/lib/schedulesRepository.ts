import { getLocalDb } from '../../../lib/storage/localDb';
import { CallSchedule, RecurrenceType, ScheduleStatus } from '../../../types/database';
import {
  LocalReminderAlarmItem,
  nativeIncomingCall,
} from '../../calling/lib/nativeIncomingCall';

export type ScheduleSyncState = 'synced' | 'pending_upsert' | 'pending_delete';

export interface LocalCallSchedule extends CallSchedule {
  sync_state: ScheduleSyncState;
  deleted_locally: number;
  last_synced_at: string | null;
}

export interface OutboxRecord {
  id: string;
  user_id: string;
  entity_type: 'call_schedule' | 'device_token';
  entity_id: string;
  operation: 'upsert' | 'delete';
  payload_json: string;
  base_updated_at: string | null;
  attempts: number;
  next_retry_at: number;
  last_error: string | null;
  created_at: number;
}

export interface UpsertScheduleInput {
  id?: string;
  title: string;
  ai_prompt?: string;
  scheduled_at: string;
  timezone?: string;
  recurrence?: RecurrenceType;
  status?: ScheduleStatus;
  reminder_offset_minutes?: number;
}

const MAX_LOCAL_ALARMS = 20;
const LOCAL_ALARM_HORIZON_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Fallback store when running on web or un-rebuilt dev binary without expo-sqlite
const fallbackSchedules = new Map<string, LocalCallSchedule>();
const fallbackOutbox = new Map<string, OutboxRecord>();
const listeners = new Set<() => void>();

function notifyScheduleListeners(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore individual subscriber errors
    }
  });
}

export function subscribeLocalSchedules(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function generateUuidV4(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Pure conflict resolver between an incoming server schedule and a local row.
 * - Server wins when the schedule was already claimed/completed or next_run_at advanced.
 * - Local pending delete always wins over server updates.
 * - Local pending edit is preserved on active unclaimed schedules.
 */
export function resolveScheduleConflict(
  local: LocalCallSchedule | null,
  server: CallSchedule,
): { winner: 'server' | 'local'; merged: LocalCallSchedule } {
  const nowIso = new Date().toISOString();
  const serverAsLocal: LocalCallSchedule = {
    ...server,
    reminder_offset_minutes: server.reminder_offset_minutes ?? 10,
    reminder_sent_at: server.reminder_sent_at ?? null,
    sync_state: 'synced',
    deleted_locally: 0,
    last_synced_at: nowIso,
  };

  if (!local || local.sync_state === 'synced') {
    return { winner: 'server', merged: serverAsLocal };
  }

  if (local.sync_state === 'pending_delete') {
    return { winner: 'local', merged: local };
  }

  // Server already executed or advanced this schedule — server wins on status & next_run_at
  const serverClaimed =
    server.status === 'completed' ||
    (Boolean(server.next_run_at) &&
      Boolean(local.next_run_at) &&
      server.next_run_at !== local.next_run_at &&
      new Date(server.next_run_at!).getTime() > new Date(local.next_run_at!).getTime());

  if (serverClaimed) {
    if (server.status === 'completed') {
      return { winner: 'server', merged: serverAsLocal };
    }
    return {
      winner: 'local',
      merged: {
        ...local,
        next_run_at: server.next_run_at,
        reminder_sent_at: server.reminder_sent_at ?? null,
        last_synced_at: nowIso,
      },
    };
  }

  // Otherwise preserve local pending edit until outbox flush succeeds
  return { winner: 'local', merged: local };
}

/**
 * Computes the next outbox action when a mutation is enqueued for an entity
 * that may already have a pending outbox row.
 * - pending_create + delete => cancel outbox entry (0 server requests!)
 * - pending_upsert + upsert => coalesce into single upsert
 */
export function coalesceOutboxAction(
  existing: Pick<OutboxRecord, 'operation' | 'base_updated_at'> | null,
  incomingOperation: 'upsert' | 'delete',
): 'drop' | 'replace' | 'insert' {
  if (!existing) return 'insert';
  if (incomingOperation === 'delete' && existing.operation === 'upsert' && !existing.base_updated_at) {
    return 'drop';
  }
  return 'replace';
}

export function getSchedulesSync(userId: string): LocalCallSchedule[] {
  if (!userId) return [];
  const db = getLocalDb();
  if (!db) {
    return Array.from(fallbackSchedules.values())
      .filter((s) => s.user_id === userId && s.deleted_locally === 0)
      .sort((a, b) => (a.next_run_at || a.scheduled_at).localeCompare(b.next_run_at || b.scheduled_at));
  }

  try {
    return db.getAllSync<LocalCallSchedule>(
      `SELECT * FROM local_call_schedules
       WHERE user_id = ? AND deleted_locally = 0
       ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END,
                COALESCE(next_run_at, scheduled_at) ASC`,
      [userId],
    );
  } catch {
    return [];
  }
}

export function buildUpcomingReminderAlarms(
  schedules: LocalCallSchedule[],
  nowMs = Date.now(),
): LocalReminderAlarmItem[] {
  const maxTriggerAt = nowMs + LOCAL_ALARM_HORIZON_MS;
  const alarms: LocalReminderAlarmItem[] = [];

  for (const s of schedules) {
    if (s.deleted_locally || s.status !== 'active' || !s.next_run_at) continue;
    const offsetMin = s.reminder_offset_minutes ?? 10;
    if (offsetMin <= 0) continue;

    const runAtMs = Date.parse(s.next_run_at);
    if (!Number.isFinite(runAtMs)) continue;

    const triggerAtMs = runAtMs - offsetMin * 60_000;
    // Skip reminders already in the past (> 1 min late) or beyond 14-day horizon
    if (triggerAtMs < nowMs - 60_000 || triggerAtMs > maxTriggerAt) continue;

    const dedupeKey = `${s.id}:${s.next_run_at}`;
    alarms.push({
      scheduleId: s.id,
      dedupeKey,
      title: s.title || 'Kallie',
      scheduledAtIso: s.next_run_at,
      timezone: s.timezone || 'Asia/Manila',
      minutesBefore: offsetMin,
      triggerAtMs: Math.max(nowMs + 2000, triggerAtMs),
    });
  }

  alarms.sort((a, b) => a.triggerAtMs - b.triggerAtMs);
  return alarms.slice(0, MAX_LOCAL_ALARMS);
}

export function syncLocalAlarmsForUser(userId: string): void {
  const schedules = getSchedulesSync(userId);
  const alarms = buildUpcomingReminderAlarms(schedules);
  nativeIncomingCall.syncLocalReminderAlarms(alarms);
}

export function upsertScheduleLocal(
  userId: string,
  input: UpsertScheduleInput,
): LocalCallSchedule {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const db = getLocalDb();
  const existing = input.id
    ? db
      ? db.getFirstSync<LocalCallSchedule>(
          'SELECT * FROM local_call_schedules WHERE id = ? AND user_id = ?',
          [input.id, userId],
        )
      : fallbackSchedules.get(input.id) ?? null
    : null;

  const id = existing?.id || input.id || generateUuidV4();
  const status: ScheduleStatus = input.status ?? existing?.status ?? 'active';
  const nextRunAt =
    status === 'active' ? input.scheduled_at : existing?.next_run_at ?? null;

  const record: LocalCallSchedule = {
    id,
    user_id: userId,
    title: input.title.trim() || 'Call with Kallie',
    ai_prompt:
      input.ai_prompt?.trim() ||
      existing?.ai_prompt ||
      'Have a warm, helpful check-in conversation with the user.',
    scheduled_at: input.scheduled_at,
    timezone: input.timezone || existing?.timezone || 'Asia/Manila',
    recurrence: input.recurrence ?? existing?.recurrence ?? 'none',
    next_run_at: nextRunAt,
    status,
    reminder_offset_minutes:
      input.reminder_offset_minutes ?? existing?.reminder_offset_minutes ?? 10,
    reminder_sent_at: null,
    created_at: existing?.created_at || nowIso,
    updated_at: nowIso,
    sync_state: 'pending_upsert',
    deleted_locally: 0,
    last_synced_at: existing?.last_synced_at ?? null,
  };

  const payloadJson = JSON.stringify({
    id: record.id,
    user_id: record.user_id,
    title: record.title,
    ai_prompt: record.ai_prompt,
    scheduled_at: record.scheduled_at,
    timezone: record.timezone,
    recurrence: record.recurrence,
    next_run_at: record.next_run_at,
    status: record.status,
    reminder_offset_minutes: record.reminder_offset_minutes,
    reminder_sent_at: record.reminder_sent_at,
  });

  if (!db) {
    fallbackSchedules.set(record.id, record);
    const existingOutbox = fallbackOutbox.get(record.id) ?? null;
    fallbackOutbox.set(record.id, {
      id: existingOutbox?.id || generateUuidV4(),
      user_id: userId,
      entity_type: 'call_schedule',
      entity_id: record.id,
      operation: 'upsert',
      payload_json: payloadJson,
      base_updated_at: existing?.last_synced_at ? existing.updated_at : null,
      attempts: 0,
      next_retry_at: nowMs,
      last_error: null,
      created_at: nowMs,
    });
  } else {
    db.withTransactionSync(() => {
      db.runSync(
        `INSERT INTO local_call_schedules (
           id, user_id, title, ai_prompt, scheduled_at, timezone, recurrence,
           next_run_at, status, reminder_offset_minutes, reminder_sent_at,
           created_at, updated_at, sync_state, deleted_locally, last_synced_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           ai_prompt = excluded.ai_prompt,
           scheduled_at = excluded.scheduled_at,
           timezone = excluded.timezone,
           recurrence = excluded.recurrence,
           next_run_at = excluded.next_run_at,
           status = excluded.status,
           reminder_offset_minutes = excluded.reminder_offset_minutes,
           reminder_sent_at = excluded.reminder_sent_at,
           updated_at = excluded.updated_at,
           sync_state = excluded.sync_state,
           deleted_locally = excluded.deleted_locally`,
        [
          record.id,
          record.user_id,
          record.title,
          record.ai_prompt,
          record.scheduled_at,
          record.timezone,
          record.recurrence,
          record.next_run_at,
          record.status,
          record.reminder_offset_minutes ?? 10,
          record.reminder_sent_at ?? null,
          record.created_at,
          record.updated_at,
          record.sync_state,
          record.deleted_locally,
          record.last_synced_at,
        ],
      );

      const prevOutbox = db.getFirstSync<OutboxRecord>(
        `SELECT * FROM sync_outbox WHERE user_id = ? AND entity_type = 'call_schedule' AND entity_id = ?`,
        [userId, record.id],
      );
      const action = coalesceOutboxAction(prevOutbox, 'upsert');
      if (action === 'replace' && prevOutbox) {
        db.runSync(
          `UPDATE sync_outbox
           SET operation = 'upsert', payload_json = ?, attempts = 0, next_retry_at = ?, last_error = NULL
           WHERE id = ?`,
          [payloadJson, nowMs, prevOutbox.id],
        );
      } else {
        db.runSync(
          `INSERT INTO sync_outbox (
             id, user_id, entity_type, entity_id, operation, payload_json,
             base_updated_at, attempts, next_retry_at, last_error, created_at
           ) VALUES (?, ?, 'call_schedule', ?, 'upsert', ?, ?, 0, ?, NULL, ?)`,
          [
            generateUuidV4(),
            userId,
            record.id,
            payloadJson,
            existing?.last_synced_at ? existing.updated_at : null,
            nowMs,
            nowMs,
          ],
        );
      }
    });
  }

  syncLocalAlarmsForUser(userId);
  notifyScheduleListeners();
  return record;
}

export function deleteScheduleLocal(userId: string, scheduleId: string): void {
  const nowMs = Date.now();
  const db = getLocalDb();

  if (!db) {
    const prev = fallbackOutbox.get(scheduleId) ?? null;
    const action = coalesceOutboxAction(prev, 'delete');
    fallbackSchedules.delete(scheduleId);
    if (action === 'drop') {
      fallbackOutbox.delete(scheduleId);
    } else {
      fallbackOutbox.set(scheduleId, {
        id: prev?.id || generateUuidV4(),
        user_id: userId,
        entity_type: 'call_schedule',
        entity_id: scheduleId,
        operation: 'delete',
        payload_json: JSON.stringify({ id: scheduleId }),
        base_updated_at: prev?.base_updated_at ?? null,
        attempts: 0,
        next_retry_at: nowMs,
        last_error: null,
        created_at: nowMs,
      });
    }
  } else {
    db.withTransactionSync(() => {
      const prevOutbox = db.getFirstSync<OutboxRecord>(
        `SELECT * FROM sync_outbox WHERE user_id = ? AND entity_type = 'call_schedule' AND entity_id = ?`,
        [userId, scheduleId],
      );
      const action = coalesceOutboxAction(prevOutbox, 'delete');

      if (action === 'drop' && prevOutbox) {
        db.runSync('DELETE FROM sync_outbox WHERE id = ?', [prevOutbox.id]);
        db.runSync('DELETE FROM local_call_schedules WHERE id = ? AND user_id = ?', [
          scheduleId,
          userId,
        ]);
      } else {
        db.runSync(
          `UPDATE local_call_schedules
           SET deleted_locally = 1, sync_state = 'pending_delete', updated_at = ?
           WHERE id = ? AND user_id = ?`,
          [new Date().toISOString(), scheduleId, userId],
        );
        if (prevOutbox) {
          db.runSync(
            `UPDATE sync_outbox
             SET operation = 'delete', payload_json = ?, attempts = 0, next_retry_at = ?, last_error = NULL
             WHERE id = ?`,
            [JSON.stringify({ id: scheduleId }), nowMs, prevOutbox.id],
          );
        } else {
          db.runSync(
            `INSERT INTO sync_outbox (
               id, user_id, entity_type, entity_id, operation, payload_json,
               base_updated_at, attempts, next_retry_at, last_error, created_at
             ) VALUES (?, ?, 'call_schedule', ?, 'delete', ?, NULL, 0, ?, NULL, ?)`,
            [generateUuidV4(), userId, scheduleId, JSON.stringify({ id: scheduleId }), nowMs, nowMs],
          );
        }
      }
    });
  }

  syncLocalAlarmsForUser(userId);
  notifyScheduleListeners();
}

export function applyServerSchedules(userId: string, rows: CallSchedule[]): void {
  if (!rows.length) return;
  const db = getLocalDb();

  if (!db) {
    for (const server of rows) {
      const local = fallbackSchedules.get(server.id) ?? null;
      const { merged } = resolveScheduleConflict(local, server);
      fallbackSchedules.set(server.id, merged);
    }
  } else {
    db.withTransactionSync(() => {
      for (const server of rows) {
        const local = db.getFirstSync<LocalCallSchedule>(
          'SELECT * FROM local_call_schedules WHERE id = ? AND user_id = ?',
          [server.id, userId],
        );
        const { merged } = resolveScheduleConflict(local ?? null, server);
        db.runSync(
          `INSERT INTO local_call_schedules (
             id, user_id, title, ai_prompt, scheduled_at, timezone, recurrence,
             next_run_at, status, reminder_offset_minutes, reminder_sent_at,
             created_at, updated_at, sync_state, deleted_locally, last_synced_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             ai_prompt = excluded.ai_prompt,
             scheduled_at = excluded.scheduled_at,
             timezone = excluded.timezone,
             recurrence = excluded.recurrence,
             next_run_at = excluded.next_run_at,
             status = excluded.status,
             reminder_offset_minutes = excluded.reminder_offset_minutes,
             reminder_sent_at = excluded.reminder_sent_at,
             updated_at = excluded.updated_at,
             sync_state = excluded.sync_state,
             deleted_locally = excluded.deleted_locally,
             last_synced_at = excluded.last_synced_at`,
          [
            merged.id,
            merged.user_id,
            merged.title,
            merged.ai_prompt,
            merged.scheduled_at,
            merged.timezone,
            merged.recurrence,
            merged.next_run_at,
            merged.status,
            merged.reminder_offset_minutes ?? 10,
            merged.reminder_sent_at ?? null,
            merged.created_at,
            merged.updated_at,
            merged.sync_state,
            merged.deleted_locally,
            merged.last_synced_at,
          ],
        );
      }
    });
  }

  syncLocalAlarmsForUser(userId);
  notifyScheduleListeners();
}

export function removeServerDeletedSchedule(userId: string, scheduleId: string): void {
  const db = getLocalDb();
  if (!db) {
    fallbackSchedules.delete(scheduleId);
  } else {
    db.runSync('DELETE FROM local_call_schedules WHERE id = ? AND user_id = ?', [
      scheduleId,
      userId,
    ]);
  }
  syncLocalAlarmsForUser(userId);
  notifyScheduleListeners();
}

export function getPendingOutboxItems(userId: string, nowMs = Date.now()): OutboxRecord[] {
  const db = getLocalDb();
  if (!db) {
    return Array.from(fallbackOutbox.values())
      .filter((item) => item.user_id === userId && item.next_retry_at <= nowMs)
      .sort((a, b) => a.created_at - b.created_at);
  }
  try {
    return db.getAllSync<OutboxRecord>(
      `SELECT * FROM sync_outbox
       WHERE user_id = ? AND next_retry_at <= ?
       ORDER BY created_at ASC
       LIMIT 25`,
      [userId, nowMs],
    );
  } catch {
    return [];
  }
}

export function markOutboxItemCompleted(item: OutboxRecord, syncedRow?: CallSchedule): void {
  const nowIso = new Date().toISOString();
  const db = getLocalDb();
  if (!db) {
    fallbackOutbox.delete(item.entity_id);
    if (item.operation === 'delete') {
      fallbackSchedules.delete(item.entity_id);
    } else if (syncedRow) {
      fallbackSchedules.set(syncedRow.id, {
        ...syncedRow,
        reminder_offset_minutes: syncedRow.reminder_offset_minutes ?? 10,
        reminder_sent_at: syncedRow.reminder_sent_at ?? null,
        sync_state: 'synced',
        deleted_locally: 0,
        last_synced_at: nowIso,
      });
    }
  } else {
    db.withTransactionSync(() => {
      db.runSync('DELETE FROM sync_outbox WHERE id = ?', [item.id]);
      if (item.operation === 'delete') {
        db.runSync('DELETE FROM local_call_schedules WHERE id = ? AND user_id = ?', [
          item.entity_id,
          item.user_id,
        ]);
      } else if (syncedRow) {
        db.runSync(
          `UPDATE local_call_schedules
           SET updated_at = ?, next_run_at = ?, status = ?, sync_state = 'synced', last_synced_at = ?
           WHERE id = ? AND user_id = ?`,
          [
            syncedRow.updated_at,
            syncedRow.next_run_at,
            syncedRow.status,
            nowIso,
            syncedRow.id,
            item.user_id,
          ],
        );
      }
    });
  }
  syncLocalAlarmsForUser(item.user_id);
  notifyScheduleListeners();
}

export function markOutboxItemFailed(item: OutboxRecord, errorMessage: string): void {
  const nextAttempts = item.attempts + 1;
  const backoffMs = Math.min(300_000, 2000 * Math.pow(4, Math.min(nextAttempts - 1, 4)));
  const nextRetryAt = Date.now() + backoffMs;

  const db = getLocalDb();
  if (!db) {
    const existing = fallbackOutbox.get(item.entity_id);
    if (existing) {
      existing.attempts = nextAttempts;
      existing.next_retry_at = nextRetryAt;
      existing.last_error = errorMessage;
    }
    return;
  }

  try {
    db.runSync(
      `UPDATE sync_outbox
       SET attempts = ?, next_retry_at = ?, last_error = ?
       WHERE id = ?`,
      [nextAttempts, nextRetryAt, errorMessage.slice(0, 250), item.id],
    );
  } catch {
    // Ignore
  }
}
