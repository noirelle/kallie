export type RecurrenceType = 'none' | 'daily' | 'weekly';
export type ScheduleStatus = 'active' | 'paused' | 'completed';
export type CallSessionStatus =
  | 'ringing'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'missed'
  | 'declined';

export type AiProviderType = 'anthropic' | 'openai' | 'gemini' | 'openai_compatible';

export interface AiProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  structuredJson: boolean;
  vision: boolean;
  embeddings: boolean;
  realtimeVoice: boolean;
}

export interface AiProviderConfig {
  id: string;
  providerType: AiProviderType;
  displayName: string;
  baseUrl: string | null;
  defaultModel: string;
  embeddingModel: string | null;
  extraHeaders: Record<string, string>;
  capabilities: AiProviderCapabilities;
  isActive: boolean;
  secretKeyRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceSettings {
  liveVoiceEnabled: boolean;
  voiceName: string;
  useByokForVoice: boolean;
  customTokenServerUrl: string | null;
  preferredAudioOutput: 'speaker' | 'earpiece';
}

export interface ConversationRecord {
  id: string;
  title: string;
  mode: 'chat' | 'voice' | 'hybrid';
  providerId: string | null;
  modelId: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ChatMessageRecord {
  id: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallsJson?: string | null;
  toolCallId?: string | null;
  tokenUsageJson?: string | null;
  source: 'text' | 'voice_transcript' | 'automation';
  createdAt: string;
}

export type MemoryType = 'preference' | 'fact' | 'episodic' | 'procedural';

export interface MemoryRecord {
  id: string;
  memoryType: MemoryType;
  content: string;
  normalizedHash: string;
  entities: string[];
  sourceConversationId: string | null;
  confidence: number;
  importance: number;
  reinforcementCount: number;
  lastAccessedAt: string | null;
  pinned: boolean;
  status: 'active' | 'superseded' | 'archived';
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ToolPermissionPolicy = 'allow' | 'ask' | 'deny';

export interface ToolPermissionRecord {
  toolId: string;
  policy: ToolPermissionPolicy;
  updatedAt: string;
}

export interface AutomationRunRecord {
  id: string;
  toolId: string;
  conversationId: string | null;
  inputJson: string;
  outputJson: string | null;
  status: 'pending' | 'approved' | 'executed' | 'denied' | 'failed';
  createdAt: string;
}

export interface CallSchedule {
  id: string;
  user_id: string;
  title: string;
  ai_prompt: string;
  scheduled_at: string;
  timezone: string;
  recurrence: RecurrenceType;
  next_run_at: string | null;
  status: ScheduleStatus;
  reminder_offset_minutes?: number;
  reminder_sent_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export interface CallSession {
  id: string;
  schedule_id: string | null;
  user_id?: string;
  device_id?: string;
  room_name: string;
  title: string;
  ai_prompt: string;
  status: CallSessionStatus;
  started_at: string | null;
  ended_at: string | null;
  transcript: TranscriptEntry[];
  summary: string | null;
  created_at: string;
  updated_at: string;
}
