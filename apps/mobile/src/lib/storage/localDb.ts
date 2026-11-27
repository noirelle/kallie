import { requireOptionalNativeModule } from 'expo-modules-core';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

const DB_NAME = 'kallie.db';
const CURRENT_SCHEMA_VERSION = 1;

export interface CacheEntryRow {
  cache_key: string;
  value_json: string;
  etag: string | null;
  fetched_at: number;
  expires_at: number;
  stale_until: number;
}

const SCHEMA_V1_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS local_call_schedules (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  ai_prompt TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Manila',
  recurrence TEXT NOT NULL DEFAULT 'none',
  next_run_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  reminder_offset_minutes INTEGER NOT NULL DEFAULT 10,
  reminder_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_state TEXT NOT NULL DEFAULT 'synced',
  deleted_locally INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_local_schedules_user_active
  ON local_call_schedules (user_id, status, next_run_at ASC)
  WHERE deleted_locally = 0;

CREATE INDEX IF NOT EXISTS idx_local_schedules_sync
  ON local_call_schedules (sync_state)
  WHERE sync_state != 'synced';

CREATE TABLE IF NOT EXISTS local_call_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  schedule_id TEXT,
  user_id TEXT NOT NULL,
  room_name TEXT NOT NULL,
  title TEXT NOT NULL,
  ai_prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  transcript_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_sessions_user_created
  ON local_call_sessions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  base_updated_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending
  ON sync_outbox (user_id, next_retry_at ASC);

CREATE TABLE IF NOT EXISTS cache_entries (
  cache_key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  etag TEXT,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  stale_until INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS local_preferences (
  pref_key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS local_reminder_ledger (
  dedupe_key TEXT PRIMARY KEY NOT NULL,
  delivered_by TEXT NOT NULL,
  delivered_at INTEGER NOT NULL
);
`;

let dbInstance: SQLiteDatabase | null = null;
let dbInitAttempted = false;

// Graceful in-memory fallback when running on web or an older dev binary
// that has not yet been rebuilt with expo-sqlite native bindings.
const fallbackPrefs = new Map<string, string>();
const fallbackCache = new Map<string, CacheEntryRow>();
const fallbackReminderLedger = new Map<string, number>();

function openAndMigrateSqlite(): SQLiteDatabase | null {
  if (Platform.OS === 'web') {
    return null;
  }
  // Check optional native module first so older un-rebuilt dev APKs degrade cleanly
  // without triggering a React Native Dev RedBox exception.
  if (!requireOptionalNativeModule('ExpoSQLite')) {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SQLite = require('expo-sqlite') as typeof import('expo-sqlite');
    if (typeof SQLite.openDatabaseSync !== 'function') {
      return null;
    }
    const db = SQLite.openDatabaseSync(DB_NAME);
    const versionRow = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
    const currentVersion = versionRow?.user_version ?? 0;

    if (currentVersion < CURRENT_SCHEMA_VERSION) {
      db.execSync(SCHEMA_V1_SQL);
      db.execSync(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
    } else {
      db.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    }

    return db;
  } catch {
    return null;
  }
}

export function getLocalDb(): SQLiteDatabase | null {
  if (!dbInitAttempted) {
    dbInitAttempted = true;
    dbInstance = openAndMigrateSqlite();
  }
  return dbInstance;
}

export function isNativeSqliteAvailable(): boolean {
  return getLocalDb() !== null;
}

export function getPreferenceSync<T>(prefKey: string): T | null {
  const db = getLocalDb();
  if (!db) {
    const raw = fallbackPrefs.get(prefKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  try {
    const row = db.getFirstSync<{ value_json: string }>(
      'SELECT value_json FROM local_preferences WHERE pref_key = ?',
      [prefKey],
    );
    if (!row?.value_json) return null;
    return JSON.parse(row.value_json) as T;
  } catch {
    return null;
  }
}

export function setPreferenceSync(prefKey: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  const now = Date.now();
  const db = getLocalDb();
  if (!db) {
    fallbackPrefs.set(prefKey, serialized);
    return;
  }
  try {
    db.runSync(
      `INSERT INTO local_preferences (pref_key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(pref_key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
      [prefKey, serialized, now],
    );
  } catch {
    fallbackPrefs.set(prefKey, serialized);
  }
}

export function deletePreferenceSync(prefKey: string): void {
  fallbackPrefs.delete(prefKey);
  const db = getLocalDb();
  if (!db) return;
  try {
    db.runSync('DELETE FROM local_preferences WHERE pref_key = ?', [prefKey]);
  } catch {
    // Ignore storage cleanup errors
  }
}

export function getCacheEntrySync(cacheKey: string): CacheEntryRow | null {
  const db = getLocalDb();
  if (!db) {
    return fallbackCache.get(cacheKey) ?? null;
  }
  try {
    const row = db.getFirstSync<CacheEntryRow>(
      'SELECT cache_key, value_json, etag, fetched_at, expires_at, stale_until FROM cache_entries WHERE cache_key = ?',
      [cacheKey],
    );
    return row ?? null;
  } catch {
    return fallbackCache.get(cacheKey) ?? null;
  }
}

export function setCacheEntrySync(entry: CacheEntryRow): void {
  const db = getLocalDb();
  if (!db) {
    fallbackCache.set(entry.cache_key, entry);
    return;
  }
  try {
    db.runSync(
      `INSERT INTO cache_entries (cache_key, value_json, etag, fetched_at, expires_at, stale_until)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         value_json = excluded.value_json,
         etag = excluded.etag,
         fetched_at = excluded.fetched_at,
         expires_at = excluded.expires_at,
         stale_until = excluded.stale_until`,
      [
        entry.cache_key,
        entry.value_json,
        entry.etag,
        entry.fetched_at,
        entry.expires_at,
        entry.stale_until,
      ],
    );
  } catch {
    fallbackCache.set(entry.cache_key, entry);
  }
}

export function deleteCacheEntrySync(cacheKey: string): void {
  fallbackCache.delete(cacheKey);
  const db = getLocalDb();
  if (!db) return;
  try {
    db.runSync('DELETE FROM cache_entries WHERE cache_key = ?', [cacheKey]);
  } catch {
    // Ignore
  }
}

export function deleteCacheEntriesByPrefixSync(prefix: string): void {
  for (const key of Array.from(fallbackCache.keys())) {
    if (key.startsWith(prefix)) {
      fallbackCache.delete(key);
    }
  }
  const db = getLocalDb();
  if (!db) return;
  try {
    db.runSync('DELETE FROM cache_entries WHERE cache_key LIKE ?', [`${prefix}%`]);
  } catch {
    // Ignore
  }
}

export function hasReminderBeenDeliveredSync(dedupeKey: string): boolean {
  const db = getLocalDb();
  if (!db) {
    return fallbackReminderLedger.has(dedupeKey);
  }
  try {
    const row = db.getFirstSync<{ dedupe_key: string }>(
      'SELECT dedupe_key FROM local_reminder_ledger WHERE dedupe_key = ?',
      [dedupeKey],
    );
    return Boolean(row);
  } catch {
    return fallbackReminderLedger.has(dedupeKey);
  }
}

export function markReminderDeliveredSync(
  dedupeKey: string,
  deliveredBy: 'local_alarm' | 'fcm_push',
): void {
  const now = Date.now();
  fallbackReminderLedger.set(dedupeKey, now);
  const db = getLocalDb();
  if (!db) return;
  try {
    db.runSync(
      `INSERT OR IGNORE INTO local_reminder_ledger (dedupe_key, delivered_by, delivered_at)
       VALUES (?, ?, ?)`,
      [dedupeKey, deliveredBy, now],
    );
    // Prune ledger entries older than 7 days
    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    db.runSync('DELETE FROM local_reminder_ledger WHERE delivered_at < ?', [cutoff]);
  } catch {
    // Ignore
  }
}

/**
 * Purges all user-scoped records from local SQLite on sign-out or account switch
 * so no prior user's schedules, transcripts, sync cursors, or pending mutations remain.
 */
export function purgeUserScopedDataSync(userId?: string): void {
  for (const key of Array.from(fallbackCache.keys())) {
    if (key.startsWith('sync_cursor:') || (userId && key.includes(userId))) {
      fallbackCache.delete(key);
    }
  }
  if (userId) {
    fallbackPrefs.delete(`fcm_reg:${userId}`);
  }
  fallbackReminderLedger.clear();

  const db = getLocalDb();
  if (!db) return;
  try {
    db.withTransactionSync(() => {
      if (userId) {
        db.runSync('DELETE FROM local_call_schedules WHERE user_id = ?', [userId]);
        db.runSync('DELETE FROM local_call_sessions WHERE user_id = ?', [userId]);
        db.runSync('DELETE FROM sync_outbox WHERE user_id = ?', [userId]);
        db.runSync('DELETE FROM local_preferences WHERE pref_key = ?', [`fcm_reg:${userId}`]);
        db.runSync('DELETE FROM cache_entries WHERE cache_key LIKE ?', [`sync_cursor:%:${userId}`]);
      } else {
        db.runSync('DELETE FROM local_call_schedules');
        db.runSync('DELETE FROM local_call_sessions');
        db.runSync('DELETE FROM sync_outbox');
        db.runSync("DELETE FROM cache_entries WHERE cache_key LIKE 'sync_cursor:%'");
      }
      db.runSync('DELETE FROM local_reminder_ledger');
    });
  } catch {
    // Ignore cleanup errors
  }
}
