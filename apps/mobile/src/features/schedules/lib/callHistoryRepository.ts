import { getLocalDb } from '../../../lib/storage/localDb';
import { CallSession, TranscriptEntry } from '../../../types/database';

const MAX_RETAINED_SESSIONS = 50;

interface LocalSessionRow {
  id: string;
  schedule_id: string | null;
  user_id: string;
  room_name: string;
  title: string;
  ai_prompt: string;
  status: CallSession['status'];
  started_at: string | null;
  ended_at: string | null;
  transcript_json: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

const fallbackSessions = new Map<string, CallSession>();
const listeners = new Set<() => void>();

function notifySessionListeners(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore subscriber error
    }
  });
}

export function subscribeLocalCallHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function rowToCallSession(row: LocalSessionRow): CallSession {
  let transcript: TranscriptEntry[] = [];
  try {
    const parsed = JSON.parse(row.transcript_json);
    if (Array.isArray(parsed)) {
      transcript = parsed as TranscriptEntry[];
    }
  } catch {
    transcript = [];
  }
  return {
    id: row.id,
    schedule_id: row.schedule_id,
    user_id: row.user_id,
    room_name: row.room_name,
    title: row.title,
    ai_prompt: row.ai_prompt,
    status: row.status,
    started_at: row.started_at,
    ended_at: row.ended_at,
    transcript,
    summary: row.summary,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getCallHistorySync(userId: string, limit = MAX_RETAINED_SESSIONS): CallSession[] {
  if (!userId) return [];
  const db = getLocalDb();
  if (!db) {
    return Array.from(fallbackSessions.values())
      .filter((s) => s.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  try {
    const rows = db.getAllSync<LocalSessionRow>(
      `SELECT * FROM local_call_sessions
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [userId, limit],
    );
    return rows.map(rowToCallSession);
  } catch {
    return [];
  }
}

export function applyServerSessions(userId: string, sessions: CallSession[]): void {
  if (!sessions.length) return;
  const db = getLocalDb();
  if (!db) {
    for (const s of sessions) {
      fallbackSessions.set(s.id, s);
    }
    notifySessionListeners();
    return;
  }

  try {
    db.withTransactionSync(() => {
      for (const s of sessions) {
        db.runSync(
          `INSERT INTO local_call_sessions (
             id, schedule_id, user_id, room_name, title, ai_prompt, status,
             started_at, ended_at, transcript_json, summary, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             status = excluded.status,
             started_at = excluded.started_at,
             ended_at = excluded.ended_at,
             transcript_json = excluded.transcript_json,
             summary = excluded.summary,
             updated_at = excluded.updated_at`,
          [
            s.id,
            s.schedule_id ?? null,
            s.user_id || userId,
            s.room_name,
            s.title,
            s.ai_prompt,
            s.status,
            s.started_at ?? null,
            s.ended_at ?? null,
            JSON.stringify(Array.isArray(s.transcript) ? s.transcript : []),
            s.summary ?? null,
            s.created_at,
            s.updated_at,
          ],
        );
      }

      // Auto-prune older sessions beyond bounded retention cap (50 per user)
      db.runSync(
        `DELETE FROM local_call_sessions
         WHERE user_id = ?
           AND id NOT IN (
             SELECT id FROM local_call_sessions
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT ?
           )`,
        [userId, userId, MAX_RETAINED_SESSIONS],
      );
    });
  } catch {
    // Ignore local cache write errors
  }

  notifySessionListeners();
}
