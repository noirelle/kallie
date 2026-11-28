import { requireOptionalNativeModule } from 'expo-modules-core';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

const DB_NAME = 'kallie.db';
export const CURRENT_SCHEMA_VERSION = 3;

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
  user_id TEXT NOT NULL DEFAULT 'local',
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
  sync_state TEXT NOT NULL DEFAULT 'local',
  deleted_locally INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_local_schedules_active
  ON local_call_schedules (status, next_run_at ASC)
  WHERE deleted_locally = 0;

CREATE TABLE IF NOT EXISTS local_call_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  schedule_id TEXT,
  user_id TEXT NOT NULL DEFAULT 'local',
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

CREATE INDEX IF NOT EXISTS idx_local_sessions_created
  ON local_call_sessions (created_at DESC);

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

const SCHEMA_V2_SQL = `
DROP TABLE IF EXISTS sync_outbox;

UPDATE local_call_schedules SET user_id = 'local', sync_state = 'local' WHERE user_id != 'local';
UPDATE local_call_sessions SET user_id = 'local' WHERE user_id != 'local';

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY NOT NULL,
  provider_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT,
  default_model TEXT NOT NULL,
  embedding_model TEXT,
  extra_headers_json TEXT NOT NULL DEFAULT '{}',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 0,
  secret_key_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'chat',
  provider_id TEXT,
  model_id TEXT,
  summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated
  ON conversations (updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls_json TEXT,
  tool_call_id TEXT,
  token_usage_json TEXT,
  source TEXT NOT NULL DEFAULT 'text',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages (conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS tool_permissions (
  tool_id TEXT PRIMARY KEY NOT NULL,
  policy TEXT NOT NULL DEFAULT 'ask',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY NOT NULL,
  tool_id TEXT NOT NULL,
  conversation_id TEXT,
  input_json TEXT NOT NULL,
  output_json TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

const SCHEMA_V3_MEMORY_SQL = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY NOT NULL,
  memory_type TEXT NOT NULL,
  content TEXT NOT NULL,
  normalized_hash TEXT NOT NULL,
  entities_json TEXT NOT NULL DEFAULT '[]',
  source_conversation_id TEXT,
  confidence REAL NOT NULL DEFAULT 0.75,
  importance REAL NOT NULL DEFAULT 0.5,
  reinforcement_count INTEGER NOT NULL DEFAULT 1,
  last_accessed_at TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  superseded_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_status_updated
  ON memories (status, pinned DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memories_hash
  ON memories (normalized_hash);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id TEXT PRIMARY KEY NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  embedding_provider TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_blob BLOB NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const SCHEMA_V3_FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  memory_id UNINDEXED,
  content,
  entities_text
);
`;

let dbInstance: SQLiteDatabase | null = null;
let dbInitAttempted = false;
let ftsAvailable = false;

const fallbackPrefs = new Map<string, string>();
const fallbackCache = new Map<string, CacheEntryRow>();
const fallbackReminderLedger = new Map<string, number>();

function openAndMigrateSqlite(): SQLiteDatabase | null {
  if (Platform.OS === 'web') {
    return null;
  }
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
    db.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');

    const versionRow = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
    let version = versionRow?.user_version ?? 0;

    if (version < 1) {
      db.execSync(SCHEMA_V1_SQL);
      version = 1;
      db.execSync('PRAGMA user_version = 1');
    }

    if (version < 2) {
      db.execSync(SCHEMA_V2_SQL);
      version = 2;
      db.execSync('PRAGMA user_version = 2');
    }

    if (version < 3) {
      db.execSync(SCHEMA_V3_MEMORY_SQL);
      try {
        db.execSync(SCHEMA_V3_FTS_SQL);
        ftsAvailable = true;
      } catch {
        ftsAvailable = false;
      }
      version = 3;
      db.execSync('PRAGMA user_version = 3');
    } else {
      try {
        db.getFirstSync('SELECT 1 FROM memories_fts LIMIT 1');
        ftsAvailable = true;
      } catch {
        try {
          db.execSync(SCHEMA_V3_FTS_SQL);
          ftsAvailable = true;
        } catch {
          ftsAvailable = false;
        }
      }
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

export function isFts5Available(): boolean {
  getLocalDb();
  return ftsAvailable;
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
    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    db.runSync('DELETE FROM local_reminder_ledger WHERE delivered_at < ?', [cutoff]);
  } catch {
    // Ignore
  }
}

/**
 * Permanently wipes all local companion data (conversations, memories, schedules,
 * provider configs, tool permissions, and caches) and compacts SQLite storage.
 */
export function wipeAllLocalCompanionDataSync(): void {
  fallbackPrefs.clear();
  fallbackCache.clear();
  fallbackReminderLedger.clear();

  const db = getLocalDb();
  if (!db) return;
  try {
    db.withTransactionSync(() => {
      db.runSync('DELETE FROM memory_embeddings');
      db.runSync('DELETE FROM memories');
      if (ftsAvailable) {
        db.runSync('DELETE FROM memories_fts');
      }
      db.runSync('DELETE FROM messages');
      db.runSync('DELETE FROM conversations');
      db.runSync('DELETE FROM automation_runs');
      db.runSync('DELETE FROM tool_permissions');
      db.runSync('DELETE FROM ai_providers');
      db.runSync('DELETE FROM app_settings');
      db.runSync('DELETE FROM local_call_schedules');
      db.runSync('DELETE FROM local_call_sessions');
      db.runSync('DELETE FROM local_reminder_ledger');
      db.runSync('DELETE FROM cache_entries');
    });
    db.execSync('VACUUM');
  } catch {
    // Ignore cleanup errors
  }
}
