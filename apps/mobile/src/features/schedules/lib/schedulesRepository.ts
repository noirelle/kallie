import { generateUuidV4 } from '../../../lib/id';
import { getLocalDb } from '../../../lib/storage/localDb';
import { CallSchedule, RecurrenceType, ScheduleStatus } from '../../../types/database';
import { DEFAULT_SCHEDULE_CHECKIN_PROMPT } from '../../ai/lib/kalliePersona';
import {
  LocalReminderAlarmItem,
  nativeIncomingCall,
} from '../../calling/lib/nativeIncomingCall';

export interface LocalCallSchedule extends CallSchedule {
  deleted_locally: number;
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

const LOCAL_SCOPE = 'local';
const MAX_LOCAL_ALARMS = 20;
const LOCAL_ALARM_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;

const fallbackSchedules = new Map<string, LocalCallSchedule>();
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

export function getSchedulesSync(): LocalCallSchedule[] {
  const db = getLocalDb();
  if (!db) {
    return Array.from(fallbackSchedules.values())
      .filter((s) => s.deleted_locally === 0)
      .sort((a, b) =>
        (a.next_run_at || a.scheduled_at).localeCompare(b.next_run_at || b.scheduled_at),
      );
  }

  try {
    return db.getAllSync<LocalCallSchedule>(
      `SELECT * FROM local_call_schedules
       WHERE deleted_locally = 0
       ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END,
                COALESCE(next_run_at, scheduled_at) ASC`,
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
    const runAtMs = Date.parse(s.next_run_at);
    if (!Number.isFinite(runAtMs)) continue;

    // Schedule native Android exact alarm directly for the target time
    if (runAtMs < nowMs - 60_000 || runAtMs > maxTriggerAt) continue;

    const dedupeKey = `${s.id}:${s.next_run_at}`;
    alarms.push({
      scheduleId: s.id,
      dedupeKey,
      title: s.title || 'Kallie',
      aiPrompt: s.ai_prompt || undefined,
      scheduledAtIso: s.next_run_at,
      timezone: s.timezone || 'Asia/Manila',
      minutesBefore: s.reminder_offset_minutes ?? 0,
      triggerAtMs: Math.max(nowMs + 2000, runAtMs),
    });
  }

  alarms.sort((a, b) => a.triggerAtMs - b.triggerAtMs);
  return alarms.slice(0, MAX_LOCAL_ALARMS);
}

export function syncLocalAlarms(): void {
  const schedules = getSchedulesSync();
  const alarms = buildUpcomingReminderAlarms(schedules);
  nativeIncomingCall.syncLocalReminderAlarms(alarms);
}

export function upsertScheduleLocal(input: UpsertScheduleInput): LocalCallSchedule {
  const nowIso = new Date().toISOString();
  const db = getLocalDb();
  const existing = input.id
    ? db
      ? db.getFirstSync<LocalCallSchedule>(
          'SELECT * FROM local_call_schedules WHERE id = ?',
          [input.id],
        )
      : fallbackSchedules.get(input.id) ?? null
    : null;

  const id = existing?.id || input.id || generateUuidV4();
  const status: ScheduleStatus = input.status ?? existing?.status ?? 'active';
  const nextRunAt =
    status === 'active' ? input.scheduled_at : existing?.next_run_at ?? null;

  const record: LocalCallSchedule = {
    id,
    user_id: LOCAL_SCOPE,
    title: input.title.trim() || 'Reminder from Kallie',
    ai_prompt:
      input.ai_prompt?.trim() ||
      existing?.ai_prompt ||
      DEFAULT_SCHEDULE_CHECKIN_PROMPT,
    scheduled_at: input.scheduled_at,
    timezone: input.timezone || existing?.timezone || 'Asia/Manila',
    recurrence: input.recurrence ?? existing?.recurrence ?? 'none',
    next_run_at: nextRunAt,
    status,
    reminder_offset_minutes:
      input.reminder_offset_minutes ?? existing?.reminder_offset_minutes ?? 0,
    reminder_sent_at: null,
    created_at: existing?.created_at || nowIso,
    updated_at: nowIso,
    deleted_locally: 0,
  };

  if (!db) {
    fallbackSchedules.set(record.id, record);
  } else {
    db.runSync(
      `INSERT INTO local_call_schedules (
         id, user_id, title, ai_prompt, scheduled_at, timezone, recurrence,
         next_run_at, status, reminder_offset_minutes, reminder_sent_at,
         created_at, updated_at, sync_state, deleted_locally, last_synced_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', 0, NULL)
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
         deleted_locally = 0`,
      [
        record.id,
        LOCAL_SCOPE,
        record.title,
        record.ai_prompt,
        record.scheduled_at,
        record.timezone,
        record.recurrence,
        record.next_run_at,
        record.status,
        record.reminder_offset_minutes ?? 0,
        record.reminder_sent_at ?? null,
        record.created_at,
        record.updated_at,
      ],
    );
  }

  syncLocalAlarms();
  notifyScheduleListeners();
  return record;
}

export function cancelSchedulesByQueryLocal(titleQuery: string): {
  cancelledCount: number;
  cancelledTitles: string[];
} {
  const query = titleQuery.trim().toLowerCase();
  const active = getSchedulesSync().filter((s) => s.status === 'active');
  const targets =
    query === 'all'
      ? active
      : active.filter((s) => s.title.toLowerCase().includes(query));

  if (targets.length === 0) {
    return { cancelledCount: 0, cancelledTitles: [] };
  }

  const nowIso = new Date().toISOString();
  const db = getLocalDb();
  for (const item of targets) {
    if (!db) {
      fallbackSchedules.set(item.id, { ...item, status: 'paused', updated_at: nowIso });
    } else {
      db.runSync(
        `UPDATE local_call_schedules SET status = 'paused', updated_at = ? WHERE id = ?`,
        [nowIso, item.id],
      );
    }
  }

  syncLocalAlarms();
  notifyScheduleListeners();
  return {
    cancelledCount: targets.length,
    cancelledTitles: targets.map((t) => t.title),
  };
}

export function deleteScheduleLocal(scheduleId: string): void {
  const db = getLocalDb();
  if (!db) {
    fallbackSchedules.delete(scheduleId);
  } else {
    db.runSync('DELETE FROM local_call_schedules WHERE id = ?', [scheduleId]);
  }
  syncLocalAlarms();
  notifyScheduleListeners();
}
