import { generateUuidV4 } from '../../../lib/id';
import {
  getLocalDb,
  getPreferenceSync,
  isFts5Available,
  setPreferenceSync,
} from '../../../lib/storage/localDb';
import { MemoryRecord, MemoryType } from '../../../types/database';
import {
  embedWithAvailableProvider,
  resolveActiveRuntime,
} from '../../ai/lib/providerRegistry';
import {
  MemoryIngestInput,
  MemoryRetrieveOptions,
  MemorySearchResult,
  RagoraCompatibleMemoryEngine,
} from './ragoraAdapter';
import {
  bytesToFloat32,
  dotProduct,
  float32ToBytes,
  hashNormalizedText,
  lexicalOverlapScore,
  normalizeVector,
} from './vectorMath';

const AUTO_LEARN_PREF = 'memory_auto_learn_enabled';
const MAX_QUERY_EMBED_CACHE = 64;
const REINDEX_CONCURRENCY = 4;

interface MemoryRow {
  id: string;
  memory_type: MemoryType;
  content: string;
  normalized_hash: string;
  entities_json: string;
  source_conversation_id: string | null;
  confidence: number;
  importance: number;
  reinforcement_count: number;
  last_accessed_at: string | null;
  pinned: number;
  status: 'active' | 'superseded' | 'archived';
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

interface EmbeddingRow {
  memory_id: string;
  embedding_provider: string;
  embedding_model: string;
  dimensions: number;
  vector_blob: Uint8Array;
}

interface CachedVectorEntry {
  provider: string;
  model: string;
  dim: number;
  vec: Float32Array;
}

const fallbackMemories = new Map<string, MemoryRecord>();
// L1 in-memory vector cache eliminates repeated SQLite BLOB deserialization on search
const vectorL1Cache = new Map<string, CachedVectorEntry>();
let vectorL1Hydrated = false;
// Bounded L1 query-embedding cache avoids redundant HTTP embed calls for repeated queries
const queryEmbedL1Cache = new Map<string, { vec: Float32Array; provider: string; model: string }>();
const listeners = new Set<() => void>();

function notifyMemoryListeners(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore subscriber error
    }
  });
}

export function subscribeLocalMemories(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isAutoLearnEnabledSync(): boolean {
  const saved = getPreferenceSync<boolean>(AUTO_LEARN_PREF);
  return saved !== false;
}

export function setAutoLearnEnabledSync(enabled: boolean): void {
  setPreferenceSync(AUTO_LEARN_PREF, enabled);
}

export function clearMemoryVectorCache(): void {
  vectorL1Cache.clear();
  queryEmbedL1Cache.clear();
  vectorL1Hydrated = false;
}

function rowToMemory(row: MemoryRow): MemoryRecord {
  let entities: string[] = [];
  try {
    const parsed = JSON.parse(row.entities_json || '[]');
    if (Array.isArray(parsed)) entities = parsed.map(String);
  } catch {
    entities = [];
  }
  return {
    id: row.id,
    memoryType: row.memory_type,
    content: row.content,
    normalizedHash: row.normalized_hash,
    entities,
    sourceConversationId: row.source_conversation_id,
    confidence: row.confidence,
    importance: row.importance,
    reinforcementCount: row.reinforcement_count,
    lastAccessedAt: row.last_accessed_at,
    pinned: row.pinned === 1,
    status: row.status,
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function upsertFtsEntry(memoryId: string, content: string, entities: string[]): void {
  const db = getLocalDb();
  if (!db || !isFts5Available()) return;
  try {
    db.runSync('DELETE FROM memories_fts WHERE memory_id = ?', [memoryId]);
    db.runSync(
      'INSERT INTO memories_fts (memory_id, content, entities_text) VALUES (?, ?, ?)',
      [memoryId, content, entities.join(' ')],
    );
  } catch {
    // Ignore FTS sync issues
  }
}

function ensureVectorL1Hydrated(): void {
  if (vectorL1Hydrated) return;
  vectorL1Hydrated = true;
  const db = getLocalDb();
  if (!db) return;
  try {
    const rows = db.getAllSync<EmbeddingRow>(
      `SELECT memory_id, embedding_provider, embedding_model, dimensions, vector_blob
       FROM memory_embeddings`,
    );
    for (const row of rows) {
      if (row.vector_blob) {
        vectorL1Cache.set(row.memory_id, {
          provider: row.embedding_provider,
          model: row.embedding_model,
          dim: row.dimensions,
          vec: bytesToFloat32(row.vector_blob),
        });
      }
    }
  } catch {
    // Keep cache empty on fallback
  }
}

function storeEmbeddingSync(
  memoryId: string,
  provider: string,
  model: string,
  vector: Float32Array,
): void {
  const normalized = normalizeVector(vector);
  vectorL1Cache.set(memoryId, {
    provider,
    model,
    dim: normalized.length,
    vec: normalized,
  });

  const db = getLocalDb();
  if (!db) return;
  try {
    db.runSync(
      `INSERT INTO memory_embeddings (
         memory_id, embedding_provider, embedding_model, dimensions, vector_blob, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(memory_id) DO UPDATE SET
         embedding_provider = excluded.embedding_provider,
         embedding_model = excluded.embedding_model,
         dimensions = excluded.dimensions,
         vector_blob = excluded.vector_blob,
         updated_at = excluded.updated_at`,
      [
        memoryId,
        provider,
        model,
        normalized.length,
        float32ToBytes(normalized),
        new Date().toISOString(),
      ],
    );
  } catch {
    // L1 cache still holds normalized vector
  }
}

async function getCachedQueryEmbedding(
  query: string,
): Promise<{ vec: Float32Array; provider: string; model: string } | null> {
  const key = hashNormalizedText(query);
  const hit = queryEmbedL1Cache.get(key);
  if (hit) {
    // Refresh LRU order
    queryEmbedL1Cache.delete(key);
    queryEmbedL1Cache.set(key, hit);
    return hit;
  }
  const embedded = await embedWithAvailableProvider(query).catch(() => null);
  if (!embedded) return null;

  const entry = {
    vec: normalizeVector(embedded.vector),
    provider: embedded.provider,
    model: embedded.model,
  };
  queryEmbedL1Cache.set(key, entry);
  if (queryEmbedL1Cache.size > MAX_QUERY_EMBED_CACHE) {
    const oldest = queryEmbedL1Cache.keys().next().value;
    if (oldest) queryEmbedL1Cache.delete(oldest);
  }
  return entry;
}

function listAllActiveMemoriesSync(limit = 200): MemoryRecord[] {
  const db = getLocalDb();
  if (!db) {
    return Array.from(fallbackMemories.values())
      .filter((m) => m.status === 'active')
      .sort((a, b) =>
        a.pinned === b.pinned ? b.updatedAt.localeCompare(a.updatedAt) : a.pinned ? -1 : 1,
      )
      .slice(0, limit);
  }
  try {
    const rows = db.getAllSync<MemoryRow>(
      `SELECT * FROM memories
       WHERE status = 'active'
       ORDER BY pinned DESC, updated_at DESC
       LIMIT ?`,
      [limit],
    );
    return rows.map(rowToMemory);
  } catch {
    return [];
  }
}

function ftsSearchIds(query: string, limit = 30): string[] {
  const db = getLocalDb();
  if (!db || !isFts5Available()) return [];
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
  if (terms.length === 0) return [];

  try {
    const ftsQuery = terms.map((t) => `"${t}"*`).join(' OR ');
    const rows = db.getAllSync<{ memory_id: string }>(
      `SELECT memory_id FROM memories_fts WHERE memories_fts MATCH ? LIMIT ?`,
      [ftsQuery, limit],
    );
    return rows.map((r) => r.memory_id);
  } catch {
    return [];
  }
}

export const localMemoryEngine: RagoraCompatibleMemoryEngine = {
  engineName: 'kallie-local-sqlite-hybrid-v1',

  async ingest(input: MemoryIngestInput) {
    const cleaned = input.content.trim();
    const hash = hashNormalizedText(cleaned);
    const nowIso = new Date().toISOString();
    const db = getLocalDb();

    // 1. O(1) indexed exact duplicate check via normalized_hash
    let exactMatch: MemoryRecord | null = null;
    if (db) {
      const row = db.getFirstSync<MemoryRow>(
        `SELECT * FROM memories WHERE status = 'active' AND normalized_hash = ? LIMIT 1`,
        [hash],
      );
      if (row) exactMatch = rowToMemory(row);
    } else {
      exactMatch =
        Array.from(fallbackMemories.values()).find(
          (m) => m.status === 'active' && m.normalizedHash === hash,
        ) ?? null;
    }

    if (exactMatch) {
      const nextCount = exactMatch.reinforcementCount + 1;
      const nextConfidence = Math.min(1, exactMatch.confidence + 0.08);
      const updated: MemoryRecord = {
        ...exactMatch,
        reinforcementCount: nextCount,
        confidence: nextConfidence,
        updatedAt: nowIso,
      };
      if (!db) {
        fallbackMemories.set(updated.id, updated);
      } else {
        db.runSync(
          `UPDATE memories
           SET reinforcement_count = ?, confidence = ?, updated_at = ?
           WHERE id = ?`,
          [nextCount, nextConfidence, nowIso, updated.id],
        );
      }
      notifyMemoryListeners();
      return { memory: updated, action: 'reinforced' };
    }

    // 2. Semantic deduplication against L1 vector cache
    const existingAll = listAllActiveMemoriesSync(500);
    const embedded = await embedWithAvailableProvider(cleaned).catch(() => null);
    if (embedded && existingAll.length > 0) {
      ensureVectorL1Hydrated();
      const queryVec = normalizeVector(embedded.vector);
      let bestMatch: { memory: MemoryRecord; sim: number } | null = null;
      for (const mem of existingAll) {
        const cached = vectorL1Cache.get(mem.id);
        if (!cached || cached.dim !== queryVec.length) continue;
        const sim = dotProduct(queryVec, cached.vec);
        if (!bestMatch || sim > bestMatch.sim) {
          bestMatch = { memory: mem, sim };
        }
      }

      if (bestMatch && bestMatch.sim >= 0.9) {
        const nextCount = bestMatch.memory.reinforcementCount + 1;
        const nextConfidence = Math.min(1, bestMatch.memory.confidence + 0.06);
        const updated: MemoryRecord = {
          ...bestMatch.memory,
          reinforcementCount: nextCount,
          confidence: nextConfidence,
          updatedAt: nowIso,
        };
        if (!db) {
          fallbackMemories.set(updated.id, updated);
        } else {
          db.runSync(
            `UPDATE memories
             SET reinforcement_count = ?, confidence = ?, updated_at = ?
             WHERE id = ?`,
            [nextCount, nextConfidence, nowIso, updated.id],
          );
        }
        notifyMemoryListeners();
        return { memory: updated, action: 'reinforced' };
      }
    }

    // 3. Insert fresh canonical memory
    const id = generateUuidV4();
    const record: MemoryRecord = {
      id,
      memoryType: input.memoryType || 'fact',
      content: cleaned,
      normalizedHash: hash,
      entities: input.entities || [],
      sourceConversationId: input.sourceConversationId ?? null,
      confidence: Math.max(0.1, Math.min(1, input.confidence ?? 0.8)),
      importance: Math.max(0.1, Math.min(1, input.importance ?? 0.6)),
      reinforcementCount: 1,
      lastAccessedAt: null,
      pinned: Boolean(input.pinned),
      status: 'active',
      supersededBy: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (!db) {
      fallbackMemories.set(record.id, record);
    } else {
      db.runSync(
        `INSERT INTO memories (
           id, memory_type, content, normalized_hash, entities_json,
           source_conversation_id, confidence, importance, reinforcement_count,
           last_accessed_at, pinned, status, superseded_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.memoryType,
          record.content,
          record.normalizedHash,
          JSON.stringify(record.entities),
          record.sourceConversationId,
          record.confidence,
          record.importance,
          record.reinforcementCount,
          record.lastAccessedAt,
          record.pinned ? 1 : 0,
          record.status,
          record.supersededBy,
          record.createdAt,
          record.updatedAt,
        ],
      );
      upsertFtsEntry(record.id, record.content, record.entities);
    }

    if (embedded) {
      storeEmbeddingSync(record.id, embedded.provider, embedded.model, embedded.vector);
    }

    notifyMemoryListeners();
    return { memory: record, action: 'created' };
  },

  async retrieve(
    query: string,
    options?: MemoryRetrieveOptions,
  ): Promise<MemorySearchResult[]> {
    const limit = options?.limit ?? 6;
    const minConfidence = options?.minConfidence ?? 0.3;
    const candidates = listAllActiveMemoriesSync(300).filter((m) => {
      if (m.confidence < minConfidence) return false;
      if (options?.types?.length && !options.types.includes(m.memoryType)) return false;
      return true;
    });

    if (candidates.length === 0) return [];

    // 1. Lexical ranking (FTS5 + overlap)
    const ftsIds = new Set(ftsSearchIds(query, 40));
    const lexicalScores = new Map<string, number>();
    for (const mem of candidates) {
      const overlap = lexicalOverlapScore(query, `${mem.content} ${mem.entities.join(' ')}`);
      const ftsBoost = ftsIds.has(mem.id) ? 0.35 : 0;
      lexicalScores.set(mem.id, overlap + ftsBoost);
    }

    // 2. Semantic cosine ranking using L1 vector cache (0 SQLite BLOB decodes!)
    const semanticScores = new Map<string, number>();
    ensureVectorL1Hydrated();
    if (vectorL1Cache.size > 0 && query.trim().length > 2) {
      const queryEmbed = await getCachedQueryEmbedding(query);
      if (queryEmbed) {
        for (const mem of candidates) {
          const cached = vectorL1Cache.get(mem.id);
          if (cached && cached.dim === queryEmbed.vec.length) {
            semanticScores.set(mem.id, Math.max(0, dotProduct(queryEmbed.vec, cached.vec)));
          }
        }
      }
    }

    // 3. Hybrid score + confidence + pinning boost
    const results: MemorySearchResult[] = candidates.map((mem) => {
      const lex = lexicalScores.get(mem.id) ?? 0;
      const sem = semanticScores.get(mem.id) ?? 0;
      const pinBoost = mem.pinned ? 0.25 : 0;
      const confidenceWeight = 0.7 + mem.confidence * 0.3;
      const combined = (sem * 0.65 + lex * 0.35 + pinBoost) * confidenceWeight;

      const matchSource: MemorySearchResult['matchSource'] =
        sem > 0 && lex > 0 ? 'hybrid' : sem > 0 ? 'semantic' : 'lexical';

      return { memory: mem, score: combined, matchSource };
    });

    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, limit);

    // Batch last_accessed_at update inside a single transaction
    const db = getLocalDb();
    const nowIso = new Date().toISOString();
    if (db && top.length > 0) {
      try {
        db.withTransactionSync(() => {
          for (const item of top) {
            db.runSync('UPDATE memories SET last_accessed_at = ? WHERE id = ?', [
              nowIso,
              item.memory.id,
            ]);
          }
        });
      } catch {
        // Ignore touch errors
      }
    }

    return top;
  },

  buildFastPromptContextSync(query: string, maxItems = 6): string {
    const candidates = listAllActiveMemoriesSync(120);
    if (candidates.length === 0) return '';

    const ftsIds = new Set(ftsSearchIds(query, 24));
    const scored = candidates.map((mem) => {
      const overlap = lexicalOverlapScore(query, `${mem.content} ${mem.entities.join(' ')}`);
      const ftsBoost = ftsIds.has(mem.id) ? 0.4 : 0;
      const pinBoost = mem.pinned ? 0.35 : 0;
      const score = (overlap + ftsBoost + pinBoost) * (0.7 + mem.confidence * 0.3);
      return { mem, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored
      .slice(0, maxItems)
      .map(({ mem }) => `- [${mem.memoryType}] ${mem.content}`)
      .join('\n');
  },

  async buildPromptContext(query: string, maxItems = 6): Promise<string> {
    const hits = await this.retrieve(query, { limit: maxItems });
    if (hits.length === 0) {
      return this.buildFastPromptContextSync(query, maxItems);
    }
    return hits.map((h) => `- [${h.memory.memoryType}] ${h.memory.content}`).join('\n');
  },

  listAll(limit = 200): MemoryRecord[] {
    return listAllActiveMemoriesSync(limit);
  },

  updateMemory(id, patch) {
    const db = getLocalDb();
    const nowIso = new Date().toISOString();
    if (!db) {
      const prev = fallbackMemories.get(id);
      if (!prev) return;
      const next: MemoryRecord = {
        ...prev,
        ...patch,
        normalizedHash: patch.content ? hashNormalizedText(patch.content) : prev.normalizedHash,
        updatedAt: nowIso,
      };
      fallbackMemories.set(id, next);
      notifyMemoryListeners();
      return;
    }

    const row = db.getFirstSync<MemoryRow>('SELECT * FROM memories WHERE id = ?', [id]);
    if (!row) return;
    const prev = rowToMemory(row);
    const nextContent = patch.content?.trim() || prev.content;
    const nextPinned = patch.pinned !== undefined ? patch.pinned : prev.pinned;
    const nextConfidence = patch.confidence !== undefined ? patch.confidence : prev.confidence;
    const nextStatus = patch.status ?? prev.status;

    db.runSync(
      `UPDATE memories
       SET content = ?, normalized_hash = ?, pinned = ?, confidence = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      [
        nextContent,
        hashNormalizedText(nextContent),
        nextPinned ? 1 : 0,
        nextConfidence,
        nextStatus,
        nowIso,
        id,
      ],
    );
    upsertFtsEntry(id, nextContent, prev.entities);
    if (patch.content && patch.content.trim() !== prev.content) {
      vectorL1Cache.delete(id);
    }
    notifyMemoryListeners();
  },

  deleteMemory(id: string) {
    vectorL1Cache.delete(id);
    const db = getLocalDb();
    if (!db) {
      fallbackMemories.delete(id);
    } else {
      db.withTransactionSync(() => {
        db.runSync('DELETE FROM memory_embeddings WHERE memory_id = ?', [id]);
        db.runSync('DELETE FROM memories WHERE id = ?', [id]);
        if (isFts5Available()) {
          db.runSync('DELETE FROM memories_fts WHERE memory_id = ?', [id]);
        }
      });
    }
    notifyMemoryListeners();
  },

  async reindexEmbeddings(): Promise<{ total: number; embedded: number }> {
    ensureVectorL1Hydrated();
    const all = listAllActiveMemoriesSync(500);
    const activeRuntime = await resolveActiveRuntime();
    if (!activeRuntime) {
      return { total: all.length, embedded: 0 };
    }
    const targetProvider = activeRuntime.config.providerType;
    const targetModel = activeRuntime.config.embeddingModel || 'default';

    // Only re-embed rows missing an embedding for the active (provider, model)
    const pending = all.filter((mem) => {
      const existing = vectorL1Cache.get(mem.id);
      return !existing || existing.provider !== targetProvider || existing.model !== targetModel;
    });

    let embeddedCount = all.length - pending.length;
    let cursor = 0;

    const worker = async () => {
      while (cursor < pending.length) {
        const mem = pending[cursor++];
        const res = await embedWithAvailableProvider(mem.content).catch(() => null);
        if (res) {
          storeEmbeddingSync(mem.id, res.provider, res.model, res.vector);
          embeddedCount += 1;
        }
      }
    };

    const workerCount = Math.min(REINDEX_CONCURRENCY, pending.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return { total: all.length, embedded: embeddedCount };
  },
};
