import { fetchWithTimeout } from '../../../../lib/id';
import { redactSecrets } from '../../../../lib/storage/secureVault';
import {
  AiModelDescriptor,
  AiProviderAdapter,
  ConnectionTestResult,
  PROVIDER_PRESETS,
  ProviderRuntimeConfig,
  StreamCallbacks,
  TokenUsage,
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedToolCall,
} from '../providerTypes';
import { streamSseRequest } from '../sseStream';

function resolveBaseUrl(runtime: ProviderRuntimeConfig): string {
  const fallback =
    runtime.config.providerType === 'openai'
      ? PROVIDER_PRESETS.openai.defaultBaseUrl
      : PROVIDER_PRESETS.openai_compatible.defaultBaseUrl;
  return (runtime.config.baseUrl || fallback).replace(/\/$/, '');
}

function buildHeaders(runtime: ProviderRuntimeConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {}),
    ...runtime.config.extraHeaders,
  };
}

function createOpenAiAdapter(type: 'openai' | 'openai_compatible'): AiProviderAdapter {
  return {
    type,

    async listModels(runtime: ProviderRuntimeConfig): Promise<AiModelDescriptor[]> {
      const fallback = PROVIDER_PRESETS[type].suggestedModels;
      try {
        const res = await fetchWithTimeout(`${resolveBaseUrl(runtime)}/models`, {
          headers: buildHeaders(runtime),
        }, 10_000);
        if (!res.ok) return fallback;
        const json = (await res.json()) as { data?: Array<{ id: string }> };
        const raw = (json.data || []).map((m) => m.id).filter(Boolean);
        const filtered =
          type === 'openai'
            ? raw.filter((id) => /^(gpt-|o1|o3|o4|chatgpt-)/i.test(id)).slice(0, 25)
            : raw.slice(0, 40);
        const models = filtered.map((id) => ({
          id,
          label: id,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: /gpt-4o|gpt-4\.1|vision|vl/i.test(id),
          supportsJson: type === 'openai',
        }));
        return models.length > 0 ? models : fallback;
      } catch {
        return fallback;
      }
    },

    async testConnection(runtime: ProviderRuntimeConfig): Promise<ConnectionTestResult> {
      const t0 = Date.now();
      if (type === 'openai' && !runtime.apiKey) {
        return { ok: false, latencyMs: 0, message: 'OpenAI API key is required.' };
      }
      try {
        const res = await fetchWithTimeout(`${resolveBaseUrl(runtime)}/models`, {
          headers: buildHeaders(runtime),
        }, 10_000);
        const latencyMs = Date.now() - t0;
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return {
            ok: false,
            latencyMs,
            message: redactSecrets(text || `Endpoint returned HTTP ${res.status}`),
          };
        }
        const json = (await res.json().catch(() => ({}))) as { data?: unknown[] };
        return {
          ok: true,
          latencyMs,
          modelsCount: json.data?.length ?? 0,
          message: `Connected (${latencyMs} ms, ${json.data?.length ?? 0} models found).`,
        };
      } catch (err) {
        return {
          ok: false,
          latencyMs: Date.now() - t0,
          message: redactSecrets(err instanceof Error ? err.message : 'Connection failed'),
        };
      }
    },

    async streamChat(
      request: UnifiedChatRequest,
      runtime: ProviderRuntimeConfig,
      callbacks?: StreamCallbacks,
      signal?: AbortSignal,
    ): Promise<UnifiedChatResponse> {
      if (type === 'openai' && !runtime.apiKey) {
        throw new Error('Missing OpenAI API key. Configure it in Settings → AI Provider.');
      }

      const openAiMessages: Array<Record<string, unknown>> = [];
      if (request.systemPrompt) {
        openAiMessages.push({ role: 'system', content: request.systemPrompt });
      }
      for (const msg of request.messages) {
        if (msg.role === 'tool' && msg.toolCallId) {
          openAiMessages.push({
            role: 'tool',
            tool_call_id: msg.toolCallId,
            content: msg.content,
          });
        } else if (msg.role === 'assistant' && msg.toolCalls?.length) {
          openAiMessages.push({
            role: 'assistant',
            content: msg.content || null,
            tool_calls: msg.toolCalls.map((call) => ({
              id: call.id,
              type: 'function',
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments),
              },
            })),
          });
        } else {
          openAiMessages.push({
            role: msg.role,
            content: msg.content,
          });
        }
      }

      const body: Record<string, unknown> = {
        model: request.model,
        messages: openAiMessages,
        stream: true,
        ...(type === 'openai' ? { stream_options: { include_usage: true } } : {}),
        ...(typeof request.temperature === 'number'
          ? { temperature: request.temperature }
          : {}),
        ...(typeof request.maxTokens === 'number' ? { max_tokens: request.maxTokens } : {}),
        ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...(request.tools?.length
          ? {
              tools: request.tools.map((t) => ({
                type: 'function',
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                },
              })),
            }
          : {}),
      };

      let fullText = '';
      const toolAccum = new Map<number, { id: string; name: string; argsRaw: string }>();
      let usage: TokenUsage | undefined;
      let finishReason: string | undefined;

      await streamSseRequest({
        url: `${resolveBaseUrl(runtime)}/chat/completions`,
        headers: buildHeaders(runtime),
        body: JSON.stringify(body),
        signal,
        onEvent: (raw) => {
          let chunk: Record<string, any>;
          try {
            chunk = JSON.parse(raw);
          } catch {
            return;
          }
          if (chunk.usage) {
            usage = {
              inputTokens: chunk.usage.prompt_tokens ?? 0,
              outputTokens: chunk.usage.completion_tokens ?? 0,
              totalTokens: chunk.usage.total_tokens ?? 0,
            };
            callbacks?.onUsage?.(usage);
          }
          const choice = chunk.choices?.[0];
          if (!choice) return;
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
          const delta = choice.delta;
          if (!delta) return;

          if (typeof delta.content === 'string' && delta.content) {
            fullText += delta.content;
            callbacks?.onTextDelta?.(delta.content);
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = typeof tc.index === 'number' ? tc.index : 0;
              const existing = toolAccum.get(idx) || {
                id: tc.id || `call_${idx}_${Date.now()}`,
                name: '',
                argsRaw: '',
              };
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name += tc.function.name;
              if (tc.function?.arguments) existing.argsRaw += tc.function.arguments;
              toolAccum.set(idx, existing);
            }
          }
        },
      });

      const toolCalls: UnifiedToolCall[] = [];
      for (const item of toolAccum.values()) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = item.argsRaw ? JSON.parse(item.argsRaw) : {};
        } catch {
          parsedArgs = {};
        }
        const call: UnifiedToolCall = {
          id: item.id,
          name: item.name,
          arguments: parsedArgs,
        };
        toolCalls.push(call);
        callbacks?.onToolCall?.(call);
      }

      return { text: fullText, toolCalls, usage, finishReason };
    },

    async embedText(
      text: string,
      runtime: ProviderRuntimeConfig,
    ): Promise<Float32Array | null> {
      const model = runtime.config.embeddingModel;
      if (!model) return null;
      try {
        const res = await fetchWithTimeout(
          `${resolveBaseUrl(runtime)}/embeddings`,
          {
            method: 'POST',
            headers: buildHeaders(runtime),
            body: JSON.stringify({ model, input: text }),
          },
          8_000,
        );
        if (!res.ok) return null;
        const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
        const vec = json.data?.[0]?.embedding;
        return Array.isArray(vec) && vec.length > 0 ? new Float32Array(vec) : null;
      } catch {
        return null;
      }
    },
  };
}

export const openaiProvider = createOpenAiAdapter('openai');
export const openaiCompatibleProvider = createOpenAiAdapter('openai_compatible');
