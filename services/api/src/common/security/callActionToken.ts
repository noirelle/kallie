import * as crypto from 'crypto';

const DEFAULT_TTL_MS = 5 * 60_000;

export function signCallDeclineToken(
  secret: string,
  sessionId: string,
  userId: string,
  ttlMs = DEFAULT_TTL_MS,
): string {
  const expiresAt = Date.now() + ttlMs;
  const payload = `${sessionId}.${userId}.${expiresAt}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${expiresAt}.${signature}`;
}

export function verifyCallDeclineToken(
  secret: string,
  sessionId: string,
  userId: string,
  token: string,
): boolean {
  if (!secret || !token) {
    return false;
  }

  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) {
    return false;
  }

  const expiresRaw = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);
  const expiresAt = Number(expiresRaw);

  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return false;
  }

  const payload = `${sessionId}.${userId}.${expiresRaw}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  const providedBuf = Buffer.from(providedSig, 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
