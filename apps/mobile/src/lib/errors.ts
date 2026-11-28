import { redactSecrets } from './storage/secureVault';

export function formatSafeError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const cleaned = raw.trim();
  return redactSecrets(cleaned || fallback);
}
