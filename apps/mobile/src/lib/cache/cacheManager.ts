import {
  CacheEntryRow,
  deleteCacheEntriesByPrefixSync,
  deleteCacheEntrySync,
  getCacheEntrySync,
  setCacheEntrySync,
} from '../storage/localDb';

export interface CacheLookup<T> {
  value: T;
  etag: string | null;
  fetchedAt: number;
  expiresAt: number;
  staleUntil: number;
  isFresh: boolean;
  isWithinStaleWindow: boolean;
}

export interface CacheSetOptions {
  ttlMs: number;
  staleWhileRevalidateMs?: number;
  etag?: string | null;
  persist?: boolean;
}

export interface FetchWithCacheResult<T> {
  value: T;
  etag?: string | null;
  notModified?: boolean;
}

export interface CacheStorageAdapter {
  get: (key: string) => CacheEntryRow | null;
  set: (entry: CacheEntryRow) => void;
  delete: (key: string) => void;
  deleteByPrefix: (prefix: string) => void;
}

const DEFAULT_MAX_L1_ENTRIES = 200;

interface L1Entry<T = unknown> {
  value: T;
  etag: string | null;
  fetchedAt: number;
  expiresAt: number;
  staleUntil: number;
}

/**
 * Unified two-tier cache (L1 bounded LRU in-memory + L2 persistent SQLite)
 * with single-flight request deduplication, TTL, ETag, and stale-while-revalidate.
 */
export class UnifiedCacheManager {
  private readonly l1 = new Map<string, L1Entry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly l2: CacheStorageAdapter;

  constructor(options?: { maxEntries?: number; l2?: CacheStorageAdapter }) {
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_L1_ENTRIES;
    this.l2 = options?.l2 ?? {
      get: getCacheEntrySync,
      set: setCacheEntrySync,
      delete: deleteCacheEntrySync,
      deleteByPrefix: deleteCacheEntriesByPrefixSync,
    };
  }

  private touchL1<T>(key: string, entry: L1Entry<T>): void {
    if (this.l1.has(key)) {
      this.l1.delete(key);
    }
    this.l1.set(key, entry);
    if (this.l1.size > this.maxEntries) {
      const oldestKey = this.l1.keys().next().value;
      if (oldestKey !== undefined) {
        this.l1.delete(oldestKey);
      }
    }
  }

  getSync<T>(key: string, now = Date.now()): CacheLookup<T> | null {
    const mem = this.l1.get(key) as L1Entry<T> | undefined;
    if (mem) {
      this.touchL1(key, mem);
      return {
        value: mem.value,
        etag: mem.etag,
        fetchedAt: mem.fetchedAt,
        expiresAt: mem.expiresAt,
        staleUntil: mem.staleUntil,
        isFresh: now < mem.expiresAt,
        isWithinStaleWindow: now < mem.staleUntil,
      };
    }

    const row = this.l2.get(key);
    if (!row) return null;

    try {
      const parsed = JSON.parse(row.value_json) as T;
      const entry: L1Entry<T> = {
        value: parsed,
        etag: row.etag,
        fetchedAt: row.fetched_at,
        expiresAt: row.expires_at,
        staleUntil: row.stale_until,
      };
      this.touchL1(key, entry);
      return {
        value: parsed,
        etag: row.etag,
        fetchedAt: row.fetched_at,
        expiresAt: row.expires_at,
        staleUntil: row.stale_until,
        isFresh: now < row.expires_at,
        isWithinStaleWindow: now < row.stale_until,
      };
    } catch {
      this.l2.delete(key);
      return null;
    }
  }

  set<T>(key: string, value: T, options: CacheSetOptions, now = Date.now()): void {
    const expiresAt = now + Math.max(0, options.ttlMs);
    const staleUntil = expiresAt + Math.max(0, options.staleWhileRevalidateMs ?? 0);
    const etag = options.etag ?? null;

    this.touchL1(key, {
      value,
      etag,
      fetchedAt: now,
      expiresAt,
      staleUntil,
    });

    if (options.persist !== false) {
      this.l2.set({
        cache_key: key,
        value_json: JSON.stringify(value),
        etag,
        fetched_at: now,
        expires_at: expiresAt,
        stale_until: staleUntil,
      });
    }
  }

  dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }

    const promise = factory().finally(() => {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  /**
   * Executes a cached fetch with TTL, ETag conditional revalidation, single-flight
   * deduplication, and stale-while-revalidate (SWR).
   */
  async fetchWithCache<T>(
    key: string,
    fetcher: (cached: CacheLookup<T> | null) => Promise<FetchWithCacheResult<T>>,
    options: CacheSetOptions & { forceRefresh?: boolean },
  ): Promise<T> {
    const now = Date.now();
    const cached = this.getSync<T>(key, now);

    if (!options.forceRefresh && cached?.isFresh) {
      return cached.value;
    }

    const runRefresh = () =>
      this.dedupe<T>(key, async () => {
        const res = await fetcher(cached);
        if (res.notModified && cached) {
          this.set(
            key,
            cached.value,
            {
              ...options,
              etag: res.etag ?? cached.etag,
            },
            Date.now(),
          );
          return cached.value;
        }
        this.set(
          key,
          res.value,
          {
            ...options,
            etag: res.etag ?? null,
          },
          Date.now(),
        );
        return res.value;
      });

    if (!options.forceRefresh && cached?.isWithinStaleWindow) {
      // Return cached data immediately; refresh silently in background
      void runRefresh().catch(() => {});
      return cached.value;
    }

    try {
      return await runRefresh();
    } catch (err) {
      // Graceful offline fallback to expired L2 entry when available
      if (cached) {
        return cached.value;
      }
      throw err;
    }
  }

  invalidate(key: string): void {
    this.l1.delete(key);
    this.l2.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of Array.from(this.l1.keys())) {
      if (key.startsWith(prefix)) {
        this.l1.delete(key);
      }
    }
    this.l2.deleteByPrefix(prefix);
  }

  clearMemory(): void {
    this.l1.clear();
  }
}

export const cacheManager = new UnifiedCacheManager();
