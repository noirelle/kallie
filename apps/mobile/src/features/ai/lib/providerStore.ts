import { getLocalDb } from '../../../lib/storage/localDb';
import { secureVault } from '../../../lib/storage/secureVault';
import { AiProviderConfig, AiProviderType } from '../../../types/database';
import { PROVIDER_PRESETS } from './providerTypes';

interface ProviderRow {
  id: string;
  provider_type: AiProviderType;
  display_name: string;
  base_url: string | null;
  default_model: string;
  embedding_model: string | null;
  extra_headers_json: string;
  capabilities_json: string;
  is_active: number;
  secret_key_ref: string | null;
  created_at: string;
  updated_at: string;
}

const fallbackProviders = new Map<string, AiProviderConfig>();
const apiKeyMemoryCache = new Map<string, string | null>();
let cachedProviders: AiProviderConfig[] | null = null;
const listeners = new Set<() => void>();

function notifyProviderListeners(): void {
  cachedProviders = null;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore subscriber error
    }
  });
}

export function subscribeAiProviders(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function rowToConfig(row: ProviderRow): AiProviderConfig {
  const preset = PROVIDER_PRESETS[row.provider_type] || PROVIDER_PRESETS.openai_compatible;
  let extraHeaders: Record<string, string> = {};
  let capabilities = preset.capabilities;
  try {
    extraHeaders = JSON.parse(row.extra_headers_json || '{}') as Record<string, string>;
  } catch {
    extraHeaders = {};
  }
  try {
    const parsedCaps = JSON.parse(row.capabilities_json || '{}');
    capabilities = { ...preset.capabilities, ...parsedCaps };
  } catch {
    capabilities = preset.capabilities;
  }

  return {
    id: row.id,
    providerType: row.provider_type,
    displayName: row.display_name,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    embeddingModel: row.embedding_model,
    extraHeaders,
    capabilities,
    isActive: row.is_active === 1,
    secretKeyRef: row.secret_key_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAiProvidersSync(): AiProviderConfig[] {
  if (cachedProviders) return cachedProviders;
  const db = getLocalDb();
  if (!db) {
    cachedProviders = Array.from(fallbackProviders.values()).sort((a, b) =>
      a.isActive === b.isActive ? a.displayName.localeCompare(b.displayName) : a.isActive ? -1 : 1,
    );
    return cachedProviders;
  }
  try {
    const rows = db.getAllSync<ProviderRow>(
      `SELECT * FROM ai_providers ORDER BY is_active DESC, updated_at DESC`,
    );
    cachedProviders = rows.map(rowToConfig);
    return cachedProviders;
  } catch {
    return [];
  }
}

export function getActiveAiProviderSync(): AiProviderConfig | null {
  const all = listAiProvidersSync();
  return all.find((p) => p.isActive) ?? all[0] ?? null;
}

export interface SaveProviderInput {
  id?: string;
  providerType: AiProviderType;
  displayName?: string;
  baseUrl?: string | null;
  defaultModel: string;
  embeddingModel?: string | null;
  extraHeaders?: Record<string, string>;
  apiKey?: string | null;
  setActive?: boolean;
}

export async function saveAiProviderConfig(
  input: SaveProviderInput,
): Promise<AiProviderConfig> {
  const preset = PROVIDER_PRESETS[input.providerType];
  const id = input.id || `provider-${input.providerType}`;
  const secretKeyRef = `ai_key_${id}`;
  const now = new Date().toISOString();

  // Persist secret strictly in Android Keystore / iOS Keychain
  if (input.apiKey !== undefined) {
    const trimmedKey = (input.apiKey || '').trim();
    if (trimmedKey) {
      await secureVault.setSecret(secretKeyRef, trimmedKey);
      apiKeyMemoryCache.set(secretKeyRef, trimmedKey);
    } else {
      await secureVault.deleteSecret(secretKeyRef);
      apiKeyMemoryCache.delete(secretKeyRef);
    }
  }

  const existing = listAiProvidersSync().find((p) => p.id === id) ?? null;
  const shouldActivate = input.setActive ?? true;

  const config: AiProviderConfig = {
    id,
    providerType: input.providerType,
    displayName: input.displayName?.trim() || preset.displayName,
    baseUrl: input.baseUrl?.trim() ? input.baseUrl.trim().replace(/\/$/, '') : null,
    defaultModel: input.defaultModel.trim() || preset.defaultModel,
    embeddingModel:
      input.embeddingModel !== undefined
        ? input.embeddingModel
        : existing?.embeddingModel ?? preset.embeddingModel,
    extraHeaders: input.extraHeaders ?? existing?.extraHeaders ?? {},
    capabilities: preset.capabilities,
    isActive: shouldActivate ? true : existing?.isActive ?? false,
    secretKeyRef,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const db = getLocalDb();
  if (!db) {
    if (shouldActivate) {
      for (const [k, item] of fallbackProviders.entries()) {
        fallbackProviders.set(k, { ...item, isActive: false });
      }
    }
    fallbackProviders.set(id, config);
  } else {
    db.withTransactionSync(() => {
      if (shouldActivate) {
        db.runSync('UPDATE ai_providers SET is_active = 0');
      }
      db.runSync(
        `INSERT INTO ai_providers (
           id, provider_type, display_name, base_url, default_model, embedding_model,
           extra_headers_json, capabilities_json, is_active, secret_key_ref,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider_type = excluded.provider_type,
           display_name = excluded.display_name,
           base_url = excluded.base_url,
           default_model = excluded.default_model,
           embedding_model = excluded.embedding_model,
           extra_headers_json = excluded.extra_headers_json,
           capabilities_json = excluded.capabilities_json,
           is_active = excluded.is_active,
           secret_key_ref = excluded.secret_key_ref,
           updated_at = excluded.updated_at`,
        [
          config.id,
          config.providerType,
          config.displayName,
          config.baseUrl,
          config.defaultModel,
          config.embeddingModel,
          JSON.stringify(config.extraHeaders),
          JSON.stringify(config.capabilities),
          config.isActive ? 1 : 0,
          config.secretKeyRef,
          config.createdAt,
          config.updatedAt,
        ],
      );
    });
  }

  notifyProviderListeners();
  return config;
}

export async function getProviderApiKey(
  config: AiProviderConfig | null,
): Promise<string | null> {
  if (!config?.secretKeyRef) return null;
  if (apiKeyMemoryCache.has(config.secretKeyRef)) {
    return apiKeyMemoryCache.get(config.secretKeyRef) ?? null;
  }
  const secret = await secureVault.getSecret(config.secretKeyRef);
  apiKeyMemoryCache.set(config.secretKeyRef, secret);
  return secret;
}

export function clearProviderKeyCache(): void {
  apiKeyMemoryCache.clear();
  fallbackProviders.clear();
  notifyProviderListeners();
}

export function setActiveAiProviderSync(providerId: string): void {
  const db = getLocalDb();
  if (!db) {
    for (const [k, item] of fallbackProviders.entries()) {
      fallbackProviders.set(k, { ...item, isActive: k === providerId });
    }
  } else {
    db.withTransactionSync(() => {
      db.runSync('UPDATE ai_providers SET is_active = 0');
      db.runSync('UPDATE ai_providers SET is_active = 1, updated_at = ? WHERE id = ?', [
        new Date().toISOString(),
        providerId,
      ]);
    });
  }
  notifyProviderListeners();
}

export async function deleteAiProviderConfig(providerId: string): Promise<void> {
  const existing = listAiProvidersSync().find((p) => p.id === providerId);
  if (existing?.secretKeyRef) {
    await secureVault.deleteSecret(existing.secretKeyRef);
    apiKeyMemoryCache.delete(existing.secretKeyRef);
  }
  const db = getLocalDb();
  if (!db) {
    fallbackProviders.delete(providerId);
  } else {
    db.runSync('DELETE FROM ai_providers WHERE id = ?', [providerId]);
  }
  notifyProviderListeners();
}
