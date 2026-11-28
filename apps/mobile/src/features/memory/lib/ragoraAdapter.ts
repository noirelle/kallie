import { MemoryRecord, MemoryType } from '../../../types/database';

export interface MemoryIngestInput {
  content: string;
  memoryType?: MemoryType;
  entities?: string[];
  sourceConversationId?: string | null;
  confidence?: number;
  importance?: number;
  pinned?: boolean;
}

export interface MemorySearchResult {
  memory: MemoryRecord;
  score: number;
  matchSource: 'hybrid' | 'semantic' | 'lexical';
}

export interface MemoryRetrieveOptions {
  limit?: number;
  minConfidence?: number;
  types?: MemoryType[];
}

/**
 * Provider-agnostic Memory & RAG engine contract designed so Ragora's retrieval,
 * chunking, deduplication, and reranking layer can be plugged in directly without
 * coupling memory persistence to any single AI provider or cloud database.
 */
export interface RagoraCompatibleMemoryEngine {
  readonly engineName: string;
  ingest(input: MemoryIngestInput): Promise<{
    memory: MemoryRecord;
    action: 'created' | 'reinforced' | 'superseded';
  }>;
  retrieve(query: string, options?: MemoryRetrieveOptions): Promise<MemorySearchResult[]>;
  buildPromptContext(query: string, maxItems?: number): Promise<string>;
  /** Zero-latency synchronous FTS5/lexical + pinned context builder for real-time voice start. */
  buildFastPromptContextSync(query: string, maxItems?: number): string;
  listAll(limit?: number): MemoryRecord[];
  updateMemory(
    id: string,
    patch: Partial<Pick<MemoryRecord, 'content' | 'pinned' | 'confidence' | 'status'>>,
  ): void;
  deleteMemory(id: string): void;
  reindexEmbeddings(): Promise<{ total: number; embedded: number }>;
}
