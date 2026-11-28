import { fetchWithTimeout } from '../../../lib/id';
import {
  deletePreferenceSync,
  getPreferenceSync,
  setPreferenceSync,
} from '../../../lib/storage/localDb';
import { redactSecrets } from '../../../lib/storage/secureVault';
import {
  deleteAiProviderConfig,
  getProviderApiKey,
  listAiProvidersSync,
  saveAiProviderConfig,
  setActiveAiProviderSync,
} from '../../ai/lib/providerStore';

export const DESKTOP_BRIDGE_PROVIDER_ID = 'provider-desktop-bridge';
const DESKTOP_BRIDGE_META_PREF = 'desktop_bridge_meta_v1';

export interface DesktopBridgeEngine {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  version: string | null;
  installHint: string;
  loginHint: string;
  models: Array<{ id: string; label: string }>;
}

export interface DesktopBridgeMeta {
  deviceName: string;
  baseUrl: string;
  pairedAt: string;
  lastSyncedAt: string;
  engines: DesktopBridgeEngine[];
}

export interface ParsedPairingPayload {
  baseUrl: string;
  token: string;
  deviceName: string;
}

/**
 * Normalizes a bridge URL so it always ends cleanly with `/v1`.
 */
export function normalizeBridgeBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

/**
 * Parses either a full `kallie://pair?url=...&token=...&name=...` URI
 * (scanned from the PC bridge QR code) or a pasted query/JSON payload.
 */
export function parsePairingUri(rawInput: string): ParsedPairingPayload | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const url = typeof parsed.url === 'string' ? normalizeBridgeBaseUrl(parsed.url) : '';
      const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
      const deviceName =
        typeof parsed.name === 'string' && parsed.name.trim()
          ? parsed.name.trim()
          : 'Desktop PC';
      if (url && token) return { baseUrl: url, token, deviceName };
      return null;
    }

    const queryIdx = trimmed.indexOf('?');
    if (queryIdx === -1) return null;

    const queryString = trimmed.slice(queryIdx + 1);
    const params = new URLSearchParams(queryString);
    const rawUrl = params.get('url') || '';
    const token = (params.get('token') || '').trim();
    const deviceName = (params.get('name') || 'Desktop PC').trim();
    const baseUrl = normalizeBridgeBaseUrl(rawUrl);

    if (!baseUrl || !/^https?:\/\//i.test(baseUrl) || token.length < 16) {
      return null;
    }
    return { baseUrl, token, deviceName };
  } catch {
    return null;
  }
}

export function getDesktopBridgeMetaSync(): DesktopBridgeMeta | null {
  return getPreferenceSync<DesktopBridgeMeta>(DESKTOP_BRIDGE_META_PREF);
}

export function isDesktopBridgeActiveSync(): boolean {
  const provider = listAiProvidersSync().find((p) => p.id === DESKTOP_BRIDGE_PROVIDER_ID);
  return Boolean(provider?.isActive);
}

export async function fetchBridgeEngines(
  baseUrl: string,
  token: string,
): Promise<{ deviceName: string; engines: DesktopBridgeEngine[] }> {
  const normalized = normalizeBridgeBaseUrl(baseUrl);
  const res = await fetchWithTimeout(
    `${normalized}/engines`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
    8_000,
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      redactSecrets(
        body ||
          (res.status === 401
            ? 'Pairing token rejected. Scan a fresh QR code from your PC.'
            : `Desktop bridge returned HTTP ${res.status}`),
      ),
    );
  }

  const json = (await res.json()) as {
    deviceName?: string;
    engines?: DesktopBridgeEngine[];
  };

  return {
    deviceName: json.deviceName || 'Desktop PC',
    engines: Array.isArray(json.engines) ? json.engines : [],
  };
}

function pickDefaultModelFromEngines(engines: DesktopBridgeEngine[]): string {
  for (const engine of engines) {
    if (engine.installed && engine.models.length > 0) {
      return engine.models[0].id;
    }
  }
  return 'cli/claude';
}

/**
 * Verifies connectivity to the PC bridge, saves the 256-bit Bearer token into
 * Android Keystore (`secureVault`), registers the bridge as an active
 * `openai_compatible` AI provider, and caches the detected PC CLI engines.
 */
export async function pairDesktopBridge(
  payload: ParsedPairingPayload,
): Promise<{ meta: DesktopBridgeMeta; selectedModel: string }> {
  const normalizedUrl = normalizeBridgeBaseUrl(payload.baseUrl);
  const fetched = await fetchBridgeEngines(normalizedUrl, payload.token);
  const deviceName = fetched.deviceName || payload.deviceName || 'Desktop PC';
  const selectedModel = pickDefaultModelFromEngines(fetched.engines);
  const now = new Date().toISOString();

  await saveAiProviderConfig({
    id: DESKTOP_BRIDGE_PROVIDER_ID,
    providerType: 'openai_compatible',
    displayName: `${deviceName} (PC Bridge)`,
    baseUrl: normalizedUrl,
    defaultModel: selectedModel,
    apiKey: payload.token,
    setActive: true,
  });

  const meta: DesktopBridgeMeta = {
    deviceName,
    baseUrl: normalizedUrl,
    pairedAt: getDesktopBridgeMetaSync()?.pairedAt || now,
    lastSyncedAt: now,
    engines: fetched.engines,
  };
  setPreferenceSync(DESKTOP_BRIDGE_META_PREF, meta);

  return { meta, selectedModel };
}

/**
 * Re-queries the already paired PC bridge for newly installed/logged-in CLI engines.
 */
export async function refreshDesktopBridgeEngines(): Promise<DesktopBridgeMeta> {
  const provider = listAiProvidersSync().find((p) => p.id === DESKTOP_BRIDGE_PROVIDER_ID);
  const existingMeta = getDesktopBridgeMetaSync();
  const baseUrl = provider?.baseUrl || existingMeta?.baseUrl;
  if (!provider || !baseUrl) {
    throw new Error('No desktop bridge paired yet. Scan the QR code from your PC first.');
  }
  const token = await getProviderApiKey(provider);
  if (!token) {
    throw new Error('Missing bridge pairing token. Please re-scan the QR code.');
  }

  const fetched = await fetchBridgeEngines(baseUrl, token);
  const now = new Date().toISOString();
  const updatedMeta: DesktopBridgeMeta = {
    deviceName: fetched.deviceName || existingMeta?.deviceName || 'Desktop PC',
    baseUrl: normalizeBridgeBaseUrl(baseUrl),
    pairedAt: existingMeta?.pairedAt || now,
    lastSyncedAt: now,
    engines: fetched.engines,
  };
  setPreferenceSync(DESKTOP_BRIDGE_META_PREF, updatedMeta);
  return updatedMeta;
}

/**
 * Switches the active AI provider to the paired Desktop Bridge using the chosen
 * PC CLI or Ollama model (e.g. `cli/agy`, `cli/claude`, `cli/codex`, `cli/gemini`, `ollama/llama3.2`).
 */
export async function selectDesktopEngineModel(modelId: string): Promise<void> {
  const provider = listAiProvidersSync().find((p) => p.id === DESKTOP_BRIDGE_PROVIDER_ID);
  if (!provider) {
    throw new Error('Desktop bridge is not paired.');
  }

  await saveAiProviderConfig({
    id: DESKTOP_BRIDGE_PROVIDER_ID,
    providerType: 'openai_compatible',
    displayName: provider.displayName,
    baseUrl: provider.baseUrl,
    defaultModel: modelId,
    setActive: true,
  });
}

export async function unpairDesktopBridge(): Promise<void> {
  await deleteAiProviderConfig(DESKTOP_BRIDGE_PROVIDER_ID);
  deletePreferenceSync(DESKTOP_BRIDGE_META_PREF);
}
