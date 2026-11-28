import {
  AiProviderCapabilities,
  AiProviderConfig,
  AiProviderType,
} from '../../../types/database';

export interface UnifiedToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface UnifiedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface UnifiedChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: UnifiedToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UnifiedChatRequest {
  model: string;
  systemPrompt?: string;
  messages: UnifiedChatMessage[];
  tools?: UnifiedToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface UnifiedChatResponse {
  text: string;
  toolCalls: UnifiedToolCall[];
  usage?: TokenUsage;
  finishReason?: string;
}

export interface StreamCallbacks {
  onTextDelta?: (delta: string) => void;
  onToolCall?: (call: UnifiedToolCall) => void;
  onUsage?: (usage: TokenUsage) => void;
}

export interface AiModelDescriptor {
  id: string;
  label: string;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsJson: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  modelsCount?: number;
  message: string;
}

export interface ProviderRuntimeConfig {
  config: AiProviderConfig;
  apiKey: string | null;
}

export interface AiProviderAdapter {
  readonly type: AiProviderType;
  listModels(runtime: ProviderRuntimeConfig): Promise<AiModelDescriptor[]>;
  testConnection(runtime: ProviderRuntimeConfig): Promise<ConnectionTestResult>;
  streamChat(
    request: UnifiedChatRequest,
    runtime: ProviderRuntimeConfig,
    callbacks?: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<UnifiedChatResponse>;
  embedText?(text: string, runtime: ProviderRuntimeConfig): Promise<Float32Array | null>;
}

export interface ProviderPreset {
  type: AiProviderType;
  displayName: string;
  subtitle: string;
  defaultBaseUrl: string;
  defaultModel: string;
  embeddingModel: string | null;
  requiresApiKey: boolean;
  keyPlaceholder: string;
  capabilities: AiProviderCapabilities;
  suggestedModels: AiModelDescriptor[];
}

export const PROVIDER_PRESETS: Record<AiProviderType, ProviderPreset> = {
  gemini: {
    type: 'gemini',
    displayName: 'Google Gemini',
    subtitle: 'Fast multimodal & direct real-time voice',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    embeddingModel: 'text-embedding-004',
    requiresApiKey: true,
    keyPlaceholder: 'AIza...',
    capabilities: {
      streaming: true,
      tools: true,
      structuredJson: true,
      vision: true,
      embeddings: true,
      realtimeVoice: true,
    },
    suggestedModels: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', supportsTools: true, supportsStreaming: true, supportsVision: true, supportsJson: true },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', supportsTools: true, supportsStreaming: true, supportsVision: true, supportsJson: true },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', supportsTools: true, supportsStreaming: true, supportsVision: true, supportsJson: true },
    ],
  },
  openai: {
    type: 'openai',
    displayName: 'OpenAI',
    subtitle: 'GPT models, strict tools & embeddings',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    embeddingModel: 'text-embedding-3-small',
    requiresApiKey: true,
    keyPlaceholder: 'sk-...',
    capabilities: {
      streaming: true,
      tools: true,
      structuredJson: true,
      vision: true,
      embeddings: true,
      realtimeVoice: true,
    },
    suggestedModels: [
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', supportsTools: true, supportsStreaming: true, supportsVision: true, supportsJson: true },
      { id: 'gpt-4.1', label: 'GPT-4.1', supportsTools: true, supportsStreaming: true, supportsVision: true, supportsJson: true },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini', supportsTools: true, supportsStreaming: true, supportsVision: true, supportsJson: true },
    ],
  },
  anthropic: {
    type: 'anthropic',
    displayName: 'Anthropic Claude',
    subtitle: 'Deep reasoning & reliable tool calling',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    embeddingModel: null,
    requiresApiKey: true,
    keyPlaceholder: 'sk-ant-...',
    capabilities: {
      streaming: true,
      tools: true,
      structuredJson: true,
      vision: true,
      embeddings: false,
      realtimeVoice: false,
    },
    suggestedModels: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', supportsTools: true, supportsStreaming: true, supportsVision: true, supportsJson: true },
      { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet', supportsTools: true, supportsStreaming: true, supportsVision: true, supportsJson: true },
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', supportsTools: true, supportsStreaming: true, supportsVision: false, supportsJson: true },
    ],
  },
  openai_compatible: {
    type: 'openai_compatible',
    displayName: 'Custom / OpenAI-Compatible',
    subtitle: 'Ollama, OpenRouter, LM Studio, Groq, DeepSeek',
    defaultBaseUrl: 'http://192.168.1.10:11434/v1',
    defaultModel: 'llama3.2',
    embeddingModel: null,
    requiresApiKey: false,
    keyPlaceholder: 'Optional API key',
    capabilities: {
      streaming: true,
      tools: true,
      structuredJson: false,
      vision: false,
      embeddings: false,
      realtimeVoice: false,
    },
    suggestedModels: [
      { id: 'llama3.2', label: 'Llama 3.2 (Local)', supportsTools: true, supportsStreaming: true, supportsVision: false, supportsJson: false },
      { id: 'qwen2.5:7b', label: 'Qwen 2.5 7B (Local)', supportsTools: true, supportsStreaming: true, supportsVision: false, supportsJson: false },
    ],
  },
};
