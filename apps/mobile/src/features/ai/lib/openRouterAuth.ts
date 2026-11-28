import { Linking } from 'react-native';
import { fetchWithTimeout } from '../../../lib/id';
import { redactSecrets, secureVault } from '../../../lib/storage/secureVault';
import { saveAiProviderConfig } from './providerStore';

export const OPENROUTER_PROVIDER_ID = 'provider-openrouter';
const PKCE_VERIFIER_VAULT_KEY = 'openrouter_pkce_verifier_v1';
const OPENROUTER_CALLBACK_URL = 'kallie://oauth/openrouter';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// FIPS 180-4 SHA-256 initial hash values & round constants
const SHA256_H0 = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Ascii(input: string): Uint8Array {
  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    bytes[i] = input.charCodeAt(i) & 0xff;
  }

  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;

  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const h = SHA256_H0.slice();
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 4, h[i], false);
  }
  return out;
}

const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    out += B64URL_ALPHABET[(triplet >> 18) & 63];
    out += B64URL_ALPHABET[(triplet >> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL_ALPHABET[(triplet >> 6) & 63];
    if (i + 2 < bytes.length) out += B64URL_ALPHABET[triplet & 63];
  }
  return out;
}

function generatePkceVerifier(): string {
  const bytes = new Uint8Array(32);
  const globalCrypto = globalThis.crypto as
    | { getRandomValues?: (arr: Uint8Array) => Uint8Array }
    | undefined;
  if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
    globalCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return toBase64Url(bytes);
}

/**
 * Starts 1-Tap OpenRouter OAuth PKCE in the system browser.
 * Users sign in with Google/GitHub on OpenRouter and return to `kallie://oauth/openrouter`
 * with zero manual API key copy-paste.
 */
export async function startOpenRouterOAuth(): Promise<void> {
  const verifier = generatePkceVerifier();
  const challenge = toBase64Url(sha256Ascii(verifier));
  await secureVault.setSecret(PKCE_VERIFIER_VAULT_KEY, verifier);

  const authUrl =
    `https://openrouter.ai/auth?callback_url=${encodeURIComponent(OPENROUTER_CALLBACK_URL)}` +
    `&code_challenge=${encodeURIComponent(challenge)}` +
    `&code_challenge_method=S256`;

  await Linking.openURL(authUrl);
}

/**
 * Exchanges the authorization `code` returned by OpenRouter for a user-owned API key
 * and saves it directly into Android Keystore (`secureVault`) as the active provider.
 */
export async function completeOpenRouterOAuth(code: string): Promise<{ model: string }> {
  const trimmedCode = code.trim();
  if (!trimmedCode) {
    throw new Error('Missing OpenRouter authorization code.');
  }

  const verifier = await secureVault.getSecret(PKCE_VERIFIER_VAULT_KEY);
  if (!verifier) {
    throw new Error('Sign-in session expired. Please tap "1-Tap Connect (OpenRouter)" again.');
  }

  try {
    const res = await fetchWithTimeout(
      `${OPENROUTER_BASE_URL}/auth/keys`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: trimmedCode,
          code_verifier: verifier,
          code_challenge_method: 'S256',
        }),
      },
      12_000,
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        redactSecrets(body || `OpenRouter key exchange failed (HTTP ${res.status})`),
      );
    }

    const json = (await res.json()) as { key?: string };
    const apiKey = (json.key || '').trim();
    if (!apiKey) {
      throw new Error('OpenRouter did not return an API key.');
    }

    const defaultModel = 'google/gemini-2.5-flash';
    await saveAiProviderConfig({
      id: OPENROUTER_PROVIDER_ID,
      providerType: 'openai_compatible',
      displayName: 'OpenRouter (1-Tap)',
      baseUrl: OPENROUTER_BASE_URL,
      defaultModel,
      extraHeaders: {
        'HTTP-Referer': 'https://kallie.app',
        'X-Title': 'Kallie AI Companion',
      },
      apiKey,
      setActive: true,
    });

    return { model: defaultModel };
  } finally {
    await secureVault.deleteSecret(PKCE_VERIFIER_VAULT_KEY).catch(() => {});
  }
}
