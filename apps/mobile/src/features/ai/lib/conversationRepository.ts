import { generatePrefixedId } from '../../../lib/id';
import { getLocalDb } from '../../../lib/storage/localDb';
import { ChatMessageRecord, ConversationRecord } from '../../../types/database';

interface ConversationRow {
  id: string;
  title: string;
  mode: 'chat' | 'voice' | 'hybrid';
  provider_id: string | null;
  model_id: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  token_usage_json: string | null;
  source: 'text' | 'voice_transcript' | 'automation';
  created_at: string;
}

const fallbackConversations = new Map<string, ConversationRecord>();
const fallbackMessages = new Map<string, ChatMessageRecord[]>();

const generateId = generatePrefixedId;

export function getOrCreateDefaultConversationSync(
  providerId: string | null,
  modelId: string | null,
): ConversationRecord {
  const existing = listConversationsSync(1)[0];
  if (existing) return existing;
  return createConversationSync('Kallie Chat', 'chat', providerId, modelId);
}

export function createConversationSync(
  title: string,
  mode: 'chat' | 'voice' | 'hybrid' = 'chat',
  providerId: string | null = null,
  modelId: string | null = null,
): ConversationRecord {
  const now = new Date().toISOString();
  const record: ConversationRecord = {
    id: generateId('conv'),
    title: title.trim() || 'Kallie Chat',
    mode,
    providerId,
    modelId,
    summary: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  const db = getLocalDb();
  if (!db) {
    fallbackConversations.set(record.id, record);
    return record;
  }
  db.runSync(
    `INSERT INTO conversations (id, title, mode, provider_id, model_id, summary, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    [record.id, record.title, record.mode, record.providerId, record.modelId, now, now],
  );
  return record;
}

export function listConversationsSync(limit = 30): ConversationRecord[] {
  const db = getLocalDb();
  if (!db) {
    return Array.from(fallbackConversations.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }
  try {
    const rows = db.getAllSync<ConversationRow>(
      `SELECT * FROM conversations WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT ?`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      mode: r.mode,
      providerId: r.provider_id,
      modelId: r.model_id,
      summary: r.summary,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      archivedAt: r.archived_at,
    }));
  } catch {
    return [];
  }
}

export function getConversationMessagesSync(
  conversationId: string,
  limit = 80,
): ChatMessageRecord[] {
  const db = getLocalDb();
  if (!db) {
    return (fallbackMessages.get(conversationId) || []).slice(-limit);
  }
  try {
    const rows = db.getAllSync<MessageRow>(
      `SELECT * FROM (
         SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
       ) ORDER BY created_at ASC`,
      [conversationId, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role,
      content: r.content,
      toolCallsJson: r.tool_calls_json,
      toolCallId: r.tool_call_id,
      tokenUsageJson: r.token_usage_json,
      source: r.source,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

export function appendConversationMessageSync(
  input: Omit<ChatMessageRecord, 'id' | 'createdAt'>,
): ChatMessageRecord {
  const now = new Date().toISOString();
  const msg: ChatMessageRecord = {
    ...input,
    id: generateId('msg'),
    createdAt: now,
  };
  const db = getLocalDb();
  if (!db) {
    const list = fallbackMessages.get(msg.conversationId) || [];
    list.push(msg);
    fallbackMessages.set(msg.conversationId, list);
    return msg;
  }
  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO messages (
         id, conversation_id, role, content, tool_calls_json, tool_call_id,
         token_usage_json, source, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        msg.id,
        msg.conversationId,
        msg.role,
        msg.content,
        msg.toolCallsJson ?? null,
        msg.toolCallId ?? null,
        msg.tokenUsageJson ?? null,
        msg.source,
        msg.createdAt,
      ],
    );
    db.runSync('UPDATE conversations SET updated_at = ? WHERE id = ?', [
      now,
      msg.conversationId,
    ]);
  });
  return msg;
}
