/**
 * Lightweight vector & hashing utilities for embedded Android semantic memory.
 * Operates directly on L2-normalized Float32Arrays stored as SQLite BLOBs.
 */

export function normalizeTextForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic 64-bit FNV-1a hex hash for fast exact-duplicate memory suppression.
 */
export function hashNormalizedText(text: string): string {
  const normalized = normalizeTextForHash(text);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function normalizeVector(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) {
    return vec;
  }
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i] / norm;
  }
  return out;
}

export function dotProduct(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

export function float32ToBytes(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer.slice(vec.byteOffset, vec.byteOffset + vec.byteLength));
}

export function bytesToFloat32(bytes: Uint8Array): Float32Array {
  const aligned = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(aligned);
}

/**
 * Simple lexical token overlap fallback (Jaccard/BM25-lite) used alongside FTS5
 * and when embeddings are not yet generated (e.g., offline or Anthropic-only setup).
 */
export function lexicalOverlapScore(query: string, content: string): number {
  const qTokens = new Set(
    normalizeTextForHash(query)
      .split(' ')
      .filter((t) => t.length >= 2),
  );
  if (qTokens.size === 0) return 0;
  const cTokens = new Set(normalizeTextForHash(content).split(' '));
  let hits = 0;
  for (const token of qTokens) {
    if (cTokens.has(token)) hits += 1;
  }
  return hits / qTokens.size;
}
