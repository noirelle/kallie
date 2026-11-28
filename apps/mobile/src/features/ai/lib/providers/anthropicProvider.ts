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
  return (runtime.config.baseUrl || PROVIDER_PRESETS.anthropic.defaultBaseUrl).replace(/\/$/, '');
}

function buildHeaders(runtime: ProviderRuntimeConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    ...(runtime.apiKey ? { 'x-api-key': runtime.apiKey } : {}),
    ...runtime.config.extraHeaders,
  };
}

export const anthropicProvider: AiProviderAdapter = {
  type: 'anthropic',

  async listModels(runtime: ProviderRuntimeConfig): Promise<AiModelDescriptor[]> {
    if (!runtime.apiKey) {
      return PROVIDER_PRESETS.anthropic.suggestedModels;
    }
    try {
      const res = await fetchWithTimeout(`${resolveBaseUrl(runtime)}/models`, {
        headers: buildHeaders(runtime),
      }, 10_000);
      if (!res.ok) {
        return PROVIDER_PRESETS.anthropic.suggestedModels;
      }
      const json = (await res.json()) as {
        data?: Array<{ id: string; display_name?: string }>;
      };
      const models = (json.data || []).map((m) => ({
        id: m.id,
        label: m.display_name || m.id,
        supportsTools: true,
        supportsStreaming: true,
        supportsVision: true,
        supportsJson: true,
      }));
      return models.length > 0 ? models : PROVIDER_PRESETS.anthropic.suggestedModels;
    } catch {
      return PROVIDER_PRESETS.anthropic.suggestedModels;
    }
  },

  async testConnection(runtime: ProviderRuntimeConfig): Promise<ConnectionTestResult> {
    const t0 = Date.now();
    if (!runtime.apiKey) {
      return { ok: false, latencyMs: 0, message: 'Anthropic API key is required.' };
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
          message: redactSecrets(text || `Anthropic returned HTTP ${res.status}`),
        };
      }
      const json = (await res.json()) as { data?: unknown[] };
      return {
        ok: true,
        latencyMs,
        modelsCount: json.data?.length ?? 0,
        message: `Connected to Anthropic (${latencyMs} ms).`,
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
      throw new Error('Missing Anthropic API key. Configure it in Settings → AI Provider.');
    }

    const anthropicMessages: Array<Record<string, unknown>> = [];
    for (const msg of request.messages) {
      if (msg.role === 'system') continue;
      if (msg.role === 'tool' && msg.toolCallId) {
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId,
              content: msg.content,
            },
          ],
        });
      } else if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const blocks: Array<Record<string, unknown>> = [];
        if (msg.content.trim()) {
          blocks.push({ type: 'text', text: msg.content });
        }
        for (const call of msg.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.arguments,
          });
        }
        anthropicMessages.push({ role: 'assistant', content: blocks });
      } else {
        anthropicMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content,
        });
      }
    }

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens ?? 1024,
      stream: true,
      messages: anthropicMessages,
      ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
      ...(typeof request.temperature === 'number'
        ? { temperature: request.temperature }
        : {}),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
            })),
          }
        : {}),
    };

    let fullText = '';
    const toolBlocks = new Map<
      number,
      { id: string; name: string; partialJson: string }
    >();
    const finalizedToolCalls: UnifiedToolCall[] = [];
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let finishReason: string | undefined;

    await streamSseRequest({
      url: `${resolveBaseUrl(runtime)}/messages`,
      headers: buildHeaders(runtime),
      body: JSON.stringify(body),
      signal,
      onEvent: (raw) => {
        let evt: Record<string, any>;
        try {
          evt = JSON.parse(raw);
        } catch {
          return;
        }
        if (evt.type === 'message_start' && evt.message?.usage) {
          usage.inputTokens = evt.message.usage.input_tokens ?? 0;
        } else if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
          toolBlocks.set(evt.index, {
            id: evt.content_block.id || `tool_${Date.now()}`,
            name: evt.content_block.name || '',
            partialJson: '',
          });
        } else if (evt.type === 'content_block_delta') {
          if (evt.delta?.type === 'text_delta' && evt.delta.text) {
            fullText += evt.delta.text;
            callbacks?.onTextDelta?.(evt.delta.text);
          } else if (
            evt.delta?.type === 'input_json_delta' &&
            typeof evt.delta.partial_json === 'string'
          ) {
            const block = toolBlocks.get(evt.index);
            if (block) {
              block.partialJson += evt.delta.partial_json;
            }
          }
        } else if (evt.type === 'content_block_stop') {
          const block = toolBlocks.get(evt.index);
          if (block) {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = block.partialJson ? JSON.parse(block.partialJson) : {};
            } catch {
              parsedArgs = {};
            }
            const call: UnifiedToolCall = {
              id: block.id,
              name: block.name,
              arguments: parsedArgs,
            };
            finalizedToolCalls.push(call);
            callbacks?.onToolCall?.(call);
            toolBlocks.delete(evt.index);
          }
        } else if (evt.type === 'message_delta') {
          if (evt.delta?.stop_reason) {
            finishReason = evt.delta.stop_reason;
          }
          if (evt.usage?.output_tokens) {
            usage.outputTokens = evt.usage.output_tokens;
            usage.totalTokens = usage.inputTokens + usage.outputTokens;
            callbacks?.onUsage?.({ ...usage });
          }
        }
      },
    });

    usage.totalTokens = usage.inputTokens + usage.outputTokens;
    return {
      text: fullText,
      toolCalls: finalizedToolCalls,
      usage: usage.totalTokens > 0 ? usage : undefined,
      finishReason,
    };
  },
};
