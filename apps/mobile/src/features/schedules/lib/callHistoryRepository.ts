import { getLocalDb } from '../../../lib/storage/localDb';
import { CallSession, TranscriptEntry } from '../../../types/database';

const MAX_RETAINED_SESSIONS = 100;

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

export function getCallHistorySync(limit = MAX_RETAINED_SESSIONS): CallSession[] {
  const db = getLocalDb();
  if (!db) {
    return Array.from(fallbackSessions.values())
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  try {
    const rows = db.getAllSync<LocalSessionRow>(
      `SELECT * FROM local_call_sessions
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit],
    );
    return rows.map(rowToCallSession);
  } catch {
    return [];
  }
}

export function saveLocalCallSession(session: CallSession): void {
  const db = getLocalDb();
  if (!db) {
    fallbackSessions.set(session.id, session);
    notifySessionListeners();
    return;
  }

  try {
    db.withTransactionSync(() => {
      db.runSync(
        `INSERT INTO local_call_sessions (
           id, schedule_id, user_id, room_name, title, ai_prompt, status,
           started_at, ended_at, transcript_json, summary, created_at, updated_at
         ) VALUES (?, ?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           transcript_json = excluded.transcript_json,
           summary = excluded.summary,
           updated_at = excluded.updated_at`,
        [
          session.id,
          session.schedule_id ?? null,
          session.room_name,
          session.title,
          session.ai_prompt,
          session.status,
          session.started_at ?? null,
          session.ended_at ?? null,
          JSON.stringify(Array.isArray(session.transcript) ? session.transcript : []),
          session.summary ?? null,
          session.created_at,
          session.updated_at,
        ],
      );

      db.runSync(
        `DELETE FROM local_call_sessions
         WHERE id NOT IN (
           SELECT id FROM local_call_sessions
           ORDER BY created_at DESC
           LIMIT ?
         )`,
        [MAX_RETAINED_SESSIONS],
      );
    });
  } catch {
    // Ignore local write errors
  }

  notifySessionListeners();
}
