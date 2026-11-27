import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

type SecureStoreModule = typeof import('expo-secure-store');

const CHUNK_SIZE = 1800; // Safely below Android/iOS 2048-byte SecureStore limit
const CHUNK_META_SUFFIX = '__chunks';

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
  // expo-secure-store keys only allow [a-zA-Z0-9._-]
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_');
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
  const chunkCountRaw = await mod.getItemAsync(`${safeKey}${CHUNK_META_SUFFIX}`, opts).catch(() => null);
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
 * Supabase Auth storage adapter backed by hardware-encrypted expo-secure-store
 * (Android Keystore / iOS Keychain) with automatic chunking (>2KB sessions) and
 * transparent one-time migration from legacy AsyncStorage.
 * Falls back cleanly to AsyncStorage if running on an un-rebuilt dev binary.
 */
export const secureAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    const mod = getSecureStore();
    if (!mod) {
      return AsyncStorage.getItem(key);
    }

    const safeKey = sanitizeKey(key);
    try {
      const secureValue = await readFromSecureStore(mod, safeKey);
      if (secureValue !== null) {
        return secureValue;
      }

      // One-time transparent migration from legacy unencrypted AsyncStorage
      const legacyValue = await AsyncStorage.getItem(key);
      if (legacyValue !== null) {
        await writeToSecureStore(mod, safeKey, legacyValue).catch(() => {});
        await AsyncStorage.removeItem(key).catch(() => {});
        return legacyValue;
      }
      return null;
    } catch {
      return AsyncStorage.getItem(key);
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    const mod = getSecureStore();
    if (!mod) {
      await AsyncStorage.setItem(key, value);
      return;
    }
    const safeKey = sanitizeKey(key);
    try {
      await writeToSecureStore(mod, safeKey, value);
      // Remove any leftover legacy copy
      await AsyncStorage.removeItem(key).catch(() => {});
    } catch {
      await AsyncStorage.setItem(key, value);
    }
  },

  async removeItem(key: string): Promise<void> {
    const mod = getSecureStore();
    if (mod) {
      await deleteFromSecureStore(mod, sanitizeKey(key)).catch(() => {});
    }
    await AsyncStorage.removeItem(key).catch(() => {});
  },
};
