import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

type SecureStoreModule = typeof import('expo-secure-store');

const CHUNK_SIZE = 1800; // Safely below Android/iOS 2048-byte SecureStore limit
const CHUNK_META_SUFFIX = '__chunks';
const VAULT_PREFIX = 'kallie_vault_';

let secureStoreMod: SecureStoreModule | null | undefined;

function getSecureStore(): SecureStoreModule | null {
  if (Platform.OS === 'web') return null;
  if (secureStoreMod !== undefined) return secureStoreMod;
  if (!requireOptionalNativeModule('ExpoSecureStore')) {
    secureStoreMod = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-secure-store') as SecureStoreModule;
    if (
      typeof mod.getItemAsync === 'function' &&
      typeof mod.setItemAsync === 'function' &&
      typeof mod.deleteItemAsync === 'function'
    ) {
      secureStoreMod = mod;
      return mod;
    }
  } catch {
    // Native module not linked yet in older dev binary
  }
  secureStoreMod = null;
  return null;
}

function sanitizeKey(raw: string): string {
  return `${VAULT_PREFIX}${raw}`.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function readFromSecureStore(
  mod: SecureStoreModule,
  safeKey: string,
): Promise<string | null> {
  const opts = { keychainAccessible: mod.AFTER_FIRST_UNLOCK };
  const chunkCountRaw = await mod.getItemAsync(`${safeKey}${CHUNK_META_SUFFIX}`, opts);
  if (chunkCountRaw) {
    const count = Number.parseInt(chunkCountRaw, 10);
    if (!Number.isFinite(count) || count <= 0) return null;
    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) => mod.getItemAsync(`${safeKey}__${i}`, opts)),
    );
    if (parts.some((part) => part === null)) {
      return null;
    }
    return parts.join('');
  }
  return mod.getItemAsync(safeKey, opts);
}

async function writeToSecureStore(
  mod: SecureStoreModule,
  safeKey: string,
  value: string,
): Promise<void> {
  const opts = { keychainAccessible: mod.AFTER_FIRST_UNLOCK };
  const prevCountRaw = await mod.getItemAsync(`${safeKey}${CHUNK_META_SUFFIX}`, opts);
  const prevCount = prevCountRaw ? Number.parseInt(prevCountRaw, 10) || 0 : 0;

  if (value.length <= CHUNK_SIZE) {
    await mod.setItemAsync(safeKey, value, opts);
    if (prevCount > 0) {
      await Promise.all([
        mod.deleteItemAsync(`${safeKey}${CHUNK_META_SUFFIX}`, opts).catch(() => {}),
        ...Array.from({ length: prevCount }, (_, i) =>
          mod.deleteItemAsync(`${safeKey}__${i}`, opts).catch(() => {}),
        ),
      ]);
    }
    return;
  }

  const totalChunks = Math.ceil(value.length / CHUNK_SIZE);
  await Promise.all(
    Array.from({ length: totalChunks }, (_, i) => {
      const slice = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      return mod.setItemAsync(`${safeKey}__${i}`, slice, opts);
    }),
  );
  await Promise.all([
    mod.setItemAsync(`${safeKey}${CHUNK_META_SUFFIX}`, String(totalChunks), opts),
    mod.deleteItemAsync(safeKey, opts).catch(() => {}),
    ...Array.from({ length: Math.max(0, prevCount - totalChunks) }, (_, offset) =>
      mod.deleteItemAsync(`${safeKey}__${totalChunks + offset}`, opts).catch(() => {}),
    ),
  ]);
}

async function deleteFromSecureStore(
  mod: SecureStoreModule,
  safeKey: string,
): Promise<void> {
  const opts = { keychainAccessible: mod.AFTER_FIRST_UNLOCK };
  const chunkCountRaw = await mod
    .getItemAsync(`${safeKey}${CHUNK_META_SUFFIX}`, opts)
    .catch(() => null);
  const count = chunkCountRaw ? Number.parseInt(chunkCountRaw, 10) || 0 : 0;
  await Promise.all([
    mod.deleteItemAsync(safeKey, opts).catch(() => {}),
    mod.deleteItemAsync(`${safeKey}${CHUNK_META_SUFFIX}`, opts).catch(() => {}),
    ...Array.from({ length: count }, (_, i) =>
      mod.deleteItemAsync(`${safeKey}__${i}`, opts).catch(() => {}),
    ),
  ]);
}

/**
 * Strips provider API keys, Bearer tokens, and secret headers from error/log strings
 * so secrets are never leaked into Metro logs, crash reports, or UI error banners.
 */
export function redactSecrets(input: string): string {
  return input
    .replace(/\b(sk-[a-zA-Z0-9_-]{12,})\b/g, 'sk-***REDACTED***')
    .replace(/\b(AIza[0-9A-Za-z_-]{20,})\b/g, 'AIza***REDACTED***')
    .replace(/\b(AQ\.[0-9A-Za-z._-]{20,})\b/g, 'AQ.***REDACTED***')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1***REDACTED***')
    .replace(/(x-api-key["':=\s]+)[A-Za-z0-9._~+/=-]{10,}/gi, '$1***REDACTED***');
}

/**
 * Masks an API key for display in Settings (e.g., "sk-ant-...9f2a").
 */
export function maskSecretForDisplay(secret: string | null | undefined): string {
  if (!secret || secret.length < 10) {
    return secret ? '••••••••' : '';
  }
  return `${secret.slice(0, 6)}••••••${secret.slice(-4)}`;
}

/**
 * Hardware-backed encrypted credential vault powered by Android Keystore / iOS Keychain
 * (`expo-secure-store`) with automatic chunking for values > 1.8 KB.
 * Used exclusively for AI provider API keys and the local device identity secret.
 */
export const secureVault = {
  isHardwareBacked(): boolean {
    return getSecureStore() !== null;
  },

  async getSecret(key: string): Promise<string | null> {
    const safeKey = sanitizeKey(key);
    const mod = getSecureStore();
    if (!mod) {
      return AsyncStorage.getItem(safeKey);
    }
    try {
      return await readFromSecureStore(mod, safeKey);
    } catch {
      return AsyncStorage.getItem(safeKey);
    }
  },

  async setSecret(key: string, value: string): Promise<void> {
    const safeKey = sanitizeKey(key);
    const mod = getSecureStore();
    if (!mod) {
      await AsyncStorage.setItem(safeKey, value);
      return;
    }
    try {
      await writeToSecureStore(mod, safeKey, value);
      await AsyncStorage.removeItem(safeKey).catch(() => {});
    } catch {
      await AsyncStorage.setItem(safeKey, value);
    }
  },

  async deleteSecret(key: string): Promise<void> {
    const safeKey = sanitizeKey(key);
    const mod = getSecureStore();
    if (mod) {
      await deleteFromSecureStore(mod, safeKey).catch(() => {});
    }
    await AsyncStorage.removeItem(safeKey).catch(() => {});
  },
};
