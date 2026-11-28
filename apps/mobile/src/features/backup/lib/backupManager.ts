import {
  CURRENT_SCHEMA_VERSION,
  getLocalDb,
  wipeAllLocalCompanionDataSync,
} from '../../../lib/storage/localDb';
import { secureVault } from '../../../lib/storage/secureVault';
import { clearProviderKeyCache, listAiProvidersSync } from '../../ai/lib/providerStore';
import { getSchedulesSync, syncLocalAlarms } from '../../schedules/lib/schedulesRepository';
import {
  clearMemoryVectorCache,
  localMemoryEngine,
} from '../../memory/lib/memoryRepository';

export interface KallieBackupBundle {
  format: 'kallie-local-backup-v1';
  schemaVersion: number;
  exportedAt: string;
  note: string;
  data: {
    preferences: Array<{ pref_key: string; value_json: string; updated_at: number }>;
    providers: Array<Record<string, unknown>>;
    conversations: Array<Record<string, unknown>>;
    messages: Array<Record<string, unknown>>;
    memories: Array<Record<string, unknown>>;
    schedules: Array<Record<string, unknown>>;
    toolPermissions: Array<Record<string, unknown>>;
  };
}

/**
 * Exports all local-first companion data into a portable JSON snapshot.
 * Hardware-protected API keys in Android Keystore are NEVER included in backups.
 */
export function exportLocalBackupJson(): string {
  const db = getLocalDb();
  const bundle: KallieBackupBundle = {
    format: 'kallie-local-backup-v1',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    note: 'API keys are intentionally excluded for security and must be re-entered on a new device.',
    data: {
      preferences: db
        ? db.getAllSync('SELECT pref_key, value_json, updated_at FROM local_preferences')
        : [],
      providers: db
        ? db.getAllSync(
            'SELECT id, provider_type, display_name, base_url, default_model, embedding_model, extra_headers_json, capabilities_json, is_active, created_at, updated_at FROM ai_providers',
          )
        : [],
      conversations: db ? db.getAllSync('SELECT * FROM conversations') : [],
      messages: db ? db.getAllSync('SELECT * FROM messages') : [],
      memories: db ? db.getAllSync('SELECT * FROM memories') : [],
      schedules: db
        ? db.getAllSync('SELECT * FROM local_call_schedules')
        : (getSchedulesSync() as unknown as Array<Record<string, unknown>>),
      toolPermissions: db ? db.getAllSync('SELECT * FROM tool_permissions') : [],
    },
  };

  return JSON.stringify(bundle, null, 2);
}

/**
 * Restores a previously exported Kallie local backup bundle transactionally.
 */
export function importLocalBackupJson(rawJson: string): {
  memoriesRestored: number;
  conversationsRestored: number;
  schedulesRestored: number;
} {
  const parsed = JSON.parse(rawJson) as KallieBackupBundle;
  if (parsed?.format !== 'kallie-local-backup-v1' || !parsed.data) {
    throw new Error('Invalid Kallie backup format.');
  }

  const db = getLocalDb();
  if (!db) {
    throw new Error('Local SQLite database is unavailable on this runtime.');
  }

  let memoriesRestored = 0;
  let conversationsRestored = 0;
  let schedulesRestored = 0;

  db.withTransactionSync(() => {
    for (const pref of parsed.data.preferences || []) {
      db.runSync(
        `INSERT OR REPLACE INTO local_preferences (pref_key, value_json, updated_at) VALUES (?, ?, ?)`,
        [pref.pref_key, pref.value_json, pref.updated_at || Date.now()],
      );
    }

    for (const conv of parsed.data.conversations || []) {
      db.runSync(
        `INSERT OR REPLACE INTO conversations (id, title, mode, provider_id, model_id, summary, created_at, updated_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(conv.id),
          String(conv.title || 'Chat'),
          String(conv.mode || 'chat'),
          (conv.provider_id as string | null) ?? null,
          (conv.model_id as string | null) ?? null,
          (conv.summary as string | null) ?? null,
          String(conv.created_at || new Date().toISOString()),
          String(conv.updated_at || new Date().toISOString()),
          (conv.archived_at as string | null) ?? null,
        ],
      );
      conversationsRestored += 1;
    }

    for (const msg of parsed.data.messages || []) {
      db.runSync(
        `INSERT OR REPLACE INTO messages (id, conversation_id, role, content, tool_calls_json, tool_call_id, token_usage_json, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(msg.id),
          String(msg.conversation_id),
          String(msg.role),
          String(msg.content || ''),
          (msg.tool_calls_json as string | null) ?? null,
          (msg.tool_call_id as string | null) ?? null,
          (msg.token_usage_json as string | null) ?? null,
          String(msg.source || 'text'),
          String(msg.created_at || new Date().toISOString()),
        ],
      );
    }

    for (const mem of parsed.data.memories || []) {
      db.runSync(
        `INSERT OR REPLACE INTO memories (
           id, memory_type, content, normalized_hash, entities_json,
           source_conversation_id, confidence, importance, reinforcement_count,
           last_accessed_at, pinned, status, superseded_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(mem.id),
          String(mem.memory_type || 'fact'),
          String(mem.content || ''),
          String(mem.normalized_hash || ''),
          String(mem.entities_json || '[]'),
          (mem.source_conversation_id as string | null) ?? null,
          Number(mem.confidence ?? 0.8),
          Number(mem.importance ?? 0.5),
          Number(mem.reinforcement_count ?? 1),
          (mem.last_accessed_at as string | null) ?? null,
          Number(mem.pinned ?? 0),
          String(mem.status || 'active'),
          (mem.superseded_by as string | null) ?? null,
          String(mem.created_at || new Date().toISOString()),
          String(mem.updated_at || new Date().toISOString()),
        ],
      );
      memoriesRestored += 1;
    }

    for (const sched of parsed.data.schedules || []) {
      db.runSync(
        `INSERT OR REPLACE INTO local_call_schedules (
           id, user_id, title, ai_prompt, scheduled_at, timezone, recurrence,
           next_run_at, status, reminder_offset_minutes, reminder_sent_at,
           created_at, updated_at, sync_state, deleted_locally, last_synced_at
         ) VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', 0, NULL)`,
        [
          String(sched.id),
          String(sched.title || 'Reminder'),
          String(sched.ai_prompt || ''),
          String(sched.scheduled_at),
          String(sched.timezone || 'Asia/Manila'),
          String(sched.recurrence || 'none'),
          (sched.next_run_at as string | null) ?? null,
          String(sched.status || 'active'),
          Number(sched.reminder_offset_minutes ?? 0),
          (sched.reminder_sent_at as string | null) ?? null,
          String(sched.created_at || new Date().toISOString()),
          String(sched.updated_at || new Date().toISOString()),
        ],
      );
      schedulesRestored += 1;
    }
  });

  syncLocalAlarms();
  void localMemoryEngine.reindexEmbeddings().catch(() => {});

  return { memoriesRestored, conversationsRestored, schedulesRestored };
}

export function wipeAllCompanionData(): void {
  const existingProviders = listAiProvidersSync();
  for (const p of existingProviders) {
    if (p.secretKeyRef) {
      void secureVault.deleteSecret(p.secretKeyRef).catch(() => {});
    }
  }
  clearMemoryVectorCache();
  wipeAllLocalCompanionDataSync();
  clearProviderKeyCache();
  syncLocalAlarms();
}
