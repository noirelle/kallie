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
  return (runtime.config.baseUrl || PROVIDER_PRESETS.gemini.defaultBaseUrl).replace(/\/$/, '');
}

function buildHeaders(runtime: ProviderRuntimeConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(runtime.apiKey ? { 'x-goog-api-key': runtime.apiKey } : {}),
    ...runtime.config.extraHeaders,
  };
}

export const geminiProvider: AiProviderAdapter = {
  type: 'gemini',

  async listModels(runtime: ProviderRuntimeConfig): Promise<AiModelDescriptor[]> {
    if (!runtime.apiKey) {
      return PROVIDER_PRESETS.gemini.suggestedModels;
    }
    try {
      const res = await fetchWithTimeout(`${resolveBaseUrl(runtime)}/models`, {
        headers: buildHeaders(runtime),
      }, 10_000);
      if (!res.ok) return PROVIDER_PRESETS.gemini.suggestedModels;
      const json = (await res.json()) as {
        models?: Array<{
          name: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
        }>;
      };
      const models = (json.models || [])
        .filter(
          (m) =>
            m.supportedGenerationMethods?.includes('generateContent') &&
            /gemini/i.test(m.name),
        )
        .slice(0, 20)
        .map((m) => {
          const id = m.name.replace(/^models\//, '');
          return {
            id,
            label: m.displayName || id,
            supportsTools: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsJson: true,
          };
        });
      return models.length > 0 ? models : PROVIDER_PRESETS.gemini.suggestedModels;
    } catch {
      return PROVIDER_PRESETS.gemini.suggestedModels;
    }
  },

  async testConnection(runtime: ProviderRuntimeConfig): Promise<ConnectionTestResult> {
    const t0 = Date.now();
    if (!runtime.apiKey) {
      return { ok: false, latencyMs: 0, message: 'Google Gemini API key is required.' };
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
          message: redactSecrets(text || `Gemini returned HTTP ${res.status}`),
        };
      }
      const json = (await res.json()) as { models?: unknown[] };
      return {
        ok: true,
        latencyMs,
        modelsCount: json.models?.length ?? 0,
        message: `Connected to Gemini (${latencyMs} ms).`,
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
    if (!runtime.apiKey) {
      throw new Error('Missing Gemini API key. Configure it in Settings → AI Provider.');
    }

    const contents: Array<Record<string, unknown>> = [];
    for (const msg of request.messages) {
      if (msg.role === 'system') continue;
      if (msg.role === 'tool' && msg.toolName) {
        let parsedResp: Record<string, unknown>;
        try {
          parsedResp = JSON.parse(msg.content);
        } catch {
          parsedResp = { result: msg.content };
        }
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: msg.toolName,
                response: parsedResp,
              },
            },
          ],
        });
      } else if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const parts: Array<Record<string, unknown>> = [];
        if (msg.content.trim()) parts.push({ text: msg.content });
        for (const call of msg.toolCalls) {
          parts.push({
            functionCall: {
              name: call.name,
              args: call.arguments,
            },
          });
        }
        contents.push({ role: 'model', parts });
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }
    }

    const body: Record<string, unknown> = {
      contents,
      ...(request.systemPrompt
        ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } }
        : {}),
      generationConfig: {
        ...(typeof request.temperature === 'number'
          ? { temperature: request.temperature }
          : {}),
        ...(typeof request.maxTokens === 'number'
          ? { maxOutputTokens: request.maxTokens }
          : {}),
        ...(request.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
      ...(request.tools?.length
        ? {
            tools: [
              {
                functionDeclarations: request.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                })),
              },
            ],
          }
        : {}),
    };

    const modelId = request.model.replace(/^models\//, '');
    let fullText = '';
    const toolCalls: UnifiedToolCall[] = [];
    let usage: TokenUsage | undefined;
    let finishReason: string | undefined;

    await streamSseRequest({
      url: `${resolveBaseUrl(runtime)}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`,
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
        if (chunk.usageMetadata) {
          usage = {
            inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: chunk.usageMetadata.totalTokenCount ?? 0,
          };
          callbacks?.onUsage?.(usage);
        }
        const candidate = chunk.candidates?.[0];
        if (!candidate) return;
        if (candidate.finishReason) {
          finishReason = candidate.finishReason;
        }
        const parts = candidate.content?.parts;
        if (!Array.isArray(parts)) return;
        for (const part of parts) {
          if (typeof part.text === 'string' && part.text) {
            fullText += part.text;
            callbacks?.onTextDelta?.(part.text);
          }
          if (part.functionCall?.name) {
            const call: UnifiedToolCall = {
              id: `gemini_${Date.now()}_${toolCalls.length}`,
              name: part.functionCall.name,
              arguments: (part.functionCall.args || {}) as Record<string, unknown>,
            };
            toolCalls.push(call);
            callbacks?.onToolCall?.(call);
          }
        }
      },
    });

    return { text: fullText, toolCalls, usage, finishReason };
  },

  async embedText(
    text: string,
    runtime: ProviderRuntimeConfig,
  ): Promise<Float32Array | null> {
    if (!runtime.apiKey) return null;
    const model = (runtime.config.embeddingModel || 'text-embedding-004').replace(/^models\//, '');
    try {
      const res = await fetchWithTimeout(
        `${resolveBaseUrl(runtime)}/models/${encodeURIComponent(model)}:embedContent`,
        {
          method: 'POST',
          headers: buildHeaders(runtime),
          body: JSON.stringify({
            model: `models/${model}`,
            content: { parts: [{ text }] },
          }),
        },
        8_000,
      );
      if (!res.ok) return null;
      const json = (await res.json()) as { embedding?: { values?: number[] } };
      const values = json.embedding?.values;
      return Array.isArray(values) && values.length > 0 ? new Float32Array(values) : null;
    } catch {
      return null;
    }
  },
};
