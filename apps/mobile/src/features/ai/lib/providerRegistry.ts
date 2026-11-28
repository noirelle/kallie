import { AiProviderConfig, AiProviderType } from '../../../types/database';
import { anthropicProvider } from './providers/anthropicProvider';
import { geminiProvider } from './providers/geminiProvider';
import { openaiCompatibleProvider, openaiProvider } from './providers/openaiProvider';
import { getActiveAiProviderSync, getProviderApiKey } from './providerStore';
import {
  AiModelDescriptor,
  AiProviderAdapter,
  ConnectionTestResult,
  ProviderRuntimeConfig,
  StreamCallbacks,
  UnifiedChatRequest,
  UnifiedChatResponse,
} from './providerTypes';

const ADAPTERS: Record<AiProviderType, AiProviderAdapter> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  openai_compatible: openaiCompatibleProvider,
};

export function getProviderAdapter(type: AiProviderType): AiProviderAdapter {
  return ADAPTERS[type] || openaiCompatibleProvider;
}

export async function resolveActiveRuntime(): Promise<ProviderRuntimeConfig | null> {
  const config = getActiveAiProviderSync();
  if (!config) return null;
  const apiKey = await getProviderApiKey(config);
  return { config, apiKey };
}

export async function testProviderConfig(
  config: AiProviderConfig,
  apiKey: string | null,
): Promise<ConnectionTestResult> {
  return getProviderAdapter(config.providerType).testConnection({ config, apiKey });
}

export async function discoverProviderModels(
  config: AiProviderConfig,
  apiKey: string | null,
): Promise<AiModelDescriptor[]> {
  return getProviderAdapter(config.providerType).listModels({ config, apiKey });
}

export async function streamWithActiveProvider(
  request: Omit<UnifiedChatRequest, 'model'> & { model?: string },
  callbacks?: StreamCallbacks,
  signal?: AbortSignal,
  resolvedRuntime?: ProviderRuntimeConfig | null,
): Promise<UnifiedChatResponse> {
  const runtime = resolvedRuntime ?? (await resolveActiveRuntime());
  if (!runtime) {
    throw new Error('No AI provider configured. Open Settings → AI Provider to connect one.');
  }
  const adapter = getProviderAdapter(runtime.config.providerType);
  return adapter.streamChat(
    {
      ...request,
      model: request.model || runtime.config.defaultModel,
    },
    runtime,
    callbacks,
    signal,
  );
}

export async function embedWithAvailableProvider(
  text: string,
): Promise<{
  vector: Float32Array;
  provider: string;
  model: string;
} | null> {
  const runtime = await resolveActiveRuntime();
  if (!runtime) return null;
  const adapter = getProviderAdapter(runtime.config.providerType);
  if (!adapter.embedText) return null;
  const vec = await adapter.embedText(text, runtime);
  if (!vec) return null;
  return {
    vector: vec,
    provider: runtime.config.providerType,
    model: runtime.config.embeddingModel || 'default',
  };
}
