import { Linking } from 'react-native';
import { maskSecretForDisplay } from '../../../lib/storage/secureVault';
import { AiProviderType } from '../../../types/database';
import { directAudioBridge } from '../../calling/lib/directAudioBridge';
import { OPENROUTER_PROVIDER_ID } from './openRouterAuth';
import {
  getProviderApiKey,
  listAiProvidersSync,
  saveAiProviderConfig,
} from './providerStore';
import { PROVIDER_PRESETS } from './providerTypes';

export const FREE_GEMINI_KEY_URL = 'https://aistudio.google.com/apikey';

export interface DetectedClipboardKey {
  providerId?: string;
  providerType: AiProviderType;
  label: string;
  displayName?: string;
  apiKey: string;
  masked: string;
  baseUrl?: string | null;
  defaultModel: string;
  extraHeaders?: Record<string, string>;
}

/**
 * Inspects arbitrary clipboard text and extracts a supported AI provider API key
 * if one is present. Never logs or exposes the raw key outside the return payload.
 */
export function detectApiKeyFromText(rawText: string): DetectedClipboardKey | null {
  const trimmed = rawText.trim();
  if (!trimmed || trimmed.length > 512) return null;

  const geminiMatch = trimmed.match(/\b(AIza[0-9A-Za-z_-]{35})\b/);
  if (geminiMatch) {
    const apiKey = geminiMatch[1];
    return {
      providerType: 'gemini',
      label: 'Gemini',
      apiKey,
      masked: maskSecretForDisplay(apiKey),
      defaultModel: PROVIDER_PRESETS.gemini.defaultModel,
    };
  }

  const openRouterMatch = trimmed.match(/\b(sk-or-v1-[0-9a-fA-F]{40,})\b/);
  if (openRouterMatch) {
    const apiKey = openRouterMatch[1];
    return {
      providerId: OPENROUTER_PROVIDER_ID,
      providerType: 'openai_compatible',
      label: 'OpenRouter',
      displayName: 'OpenRouter',
      apiKey,
      masked: maskSecretForDisplay(apiKey),
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'google/gemini-2.5-flash',
      extraHeaders: {
        'HTTP-Referer': 'https://kallie.app',
        'X-Title': 'Kallie AI Companion',
      },
    };
  }

  const anthropicMatch = trimmed.match(/\b(sk-ant-[0-9A-Za-z_-]{20,})\b/);
  if (anthropicMatch) {
    const apiKey = anthropicMatch[1];
    return {
      providerType: 'anthropic',
      label: 'Claude',
      apiKey,
      masked: maskSecretForDisplay(apiKey),
      defaultModel: PROVIDER_PRESETS.anthropic.defaultModel,
    };
  }

  const openAiMatch = trimmed.match(/\b(sk-(?:proj-)?[0-9A-Za-z_-]{20,})\b/);
  if (openAiMatch) {
    const apiKey = openAiMatch[1];
    return {
      providerType: 'openai',
      label: 'OpenAI',
      apiKey,
      masked: maskSecretForDisplay(apiKey),
      defaultModel: PROVIDER_PRESETS.openai.defaultModel,
    };
  }

  return null;
}

/**
 * Checks the Android clipboard for an unsaved AI API key so non-tech users
 * returning from Google AI Studio or OpenAI can connect in a single tap.
 */
export async function checkClipboardForApiKey(): Promise<DetectedClipboardKey | null> {
  const clipText = await directAudioBridge.getClipboardText();
  const detected = detectApiKeyFromText(clipText);
  if (!detected) return null;

  const existing = listAiProvidersSync().find((p) =>
    detected.providerId
      ? p.id === detected.providerId
      : p.providerType === detected.providerType,
  );
  if (existing) {
    const savedKey = await getProviderApiKey(existing);
    if (savedKey && savedKey.trim() === detected.apiKey) {
      return null;
    }
  }

  return detected;
}

export async function saveDetectedClipboardKey(
  detected: DetectedClipboardKey,
  options?: { setActive?: boolean },
) {
  return saveAiProviderConfig({
    id: detected.providerId,
    providerType: detected.providerType,
    displayName: detected.displayName,
    baseUrl: detected.baseUrl ?? null,
    defaultModel: detected.defaultModel,
    extraHeaders: detected.extraHeaders,
    apiKey: detected.apiKey,
    setActive: options?.setActive ?? true,
  });
}

export async function openFreeGeminiKeyPage(): Promise<void> {
  await Linking.openURL(FREE_GEMINI_KEY_URL);
}
