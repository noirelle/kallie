import { extractMemoriesFromTurn } from '../../memory/lib/memoryExtractor';
import { localMemoryEngine } from '../../memory/lib/memoryRepository';
import { subscribePhoneAutomationStop } from '../../phoneControl/lib/phoneActionSafety';
import {
  appendConversationMessageSync,
  getConversationMessagesSync,
} from './conversationRepository';
import { buildCompanionChatSystemPrompt } from './kalliePersona';
import { resolveActiveRuntime, streamWithActiveProvider } from './providerRegistry';
import { TokenUsage, UnifiedChatMessage } from './providerTypes';
import { compactOlderScreenDumps } from './toolLoop';
import {
  executeLocalTool,
  getAllToolDefinitions,
  getAutomationEpochSnapshot,
  isPhoneControlTool,
} from './toolRegistry';

const MAX_TOOL_ROUNDS = 15;

export interface SendCompanionTurnCallbacks {
  onTextDelta?: (accumulatedText: string) => void;
  onToolActivity?: (toolName: string) => void;
  onUsage?: (usage: TokenUsage) => void;
}

/**
 * Orchestrates a complete local-first AI turn:
 * 1. Persists the user message into local SQLite.
 * 2. Recalls top relevant memories from the local hybrid memory engine.
 * 3. Streams from whichever AI provider is active (Anthropic, OpenAI, Gemini, Custom).
 * 4. Executes any requested local tools (bounded loop) and feeds results back.
 * 5. Persists final assistant reply and triggers non-blocking memory extraction.
 */
export async function runLocalCompanionTurn(
  conversationId: string,
  userText: string,
  callbacks?: SendCompanionTurnCallbacks,
  signal?: AbortSignal,
): Promise<{ assistantText: string; usage?: TokenUsage }> {
  const trimmed = userText.trim();
  appendConversationMessageSync({
    conversationId,
    role: 'user',
    content: trimmed,
    source: 'text',
  });

  const runtime = await resolveActiveRuntime();
  if (!runtime) {
    throw new Error('Connect an AI provider in Settings to start chatting.');
  }

  // Instant local FTS5 SQLite recall (<2ms) instead of blocking on a network embedding round-trip
  const recalledMemory = localMemoryEngine.buildFastPromptContextSync(trimmed, 6);
  const systemPrompt = buildCompanionChatSystemPrompt(recalledMemory);

  const history = getConversationMessagesSync(conversationId, 24);
  const workingMessages: UnifiedChatMessage[] = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));

  const tools = runtime.config.capabilities.tools ? getAllToolDefinitions() : undefined;
  let finalText = '';
  let lastUsage: TokenUsage | undefined;
  const startEpoch = getAutomationEpochSnapshot();
  let stoppedByNotch = false;

  const unsubStop = subscribePhoneAutomationStop(() => {
    stoppedByNotch = true;
  });

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (stoppedByNotch || getAutomationEpochSnapshot() !== startEpoch) {
        finalText = finalText.trim() || 'Stopped phone action.';
        break;
      }
      compactOlderScreenDumps(workingMessages);

      let roundText = '';
      const response = await streamWithActiveProvider(
        {
          systemPrompt,
          messages: workingMessages,
          tools,
          temperature: 0.7,
          maxTokens: 1024,
        },
        {
          onTextDelta: (delta) => {
            roundText += delta;
            callbacks?.onTextDelta?.(roundText);
          },
          onUsage: (u) => {
            lastUsage = u;
            callbacks?.onUsage?.(u);
          },
        },
        signal,
        runtime,
      );

      finalText = response.text || roundText;
      if (response.usage) lastUsage = response.usage;

      if (!response.toolCalls.length) {
        break;
      }

      workingMessages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls,
      });

      for (const call of response.toolCalls) {
        if (
          isPhoneControlTool(call.name) &&
          (stoppedByNotch || getAutomationEpochSnapshot() !== startEpoch)
        ) {
          workingMessages.push({
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: JSON.stringify({
              ok: false,
              cancelled: true,
              error: 'User stopped automation via Floating Orb.',
            }),
          });
          continue;
        }
        callbacks?.onToolActivity?.(call.name);
        if (signal?.aborted) break;
        const toolOutput = await executeLocalTool(call.name, call.arguments, conversationId, {
          signal,
          epoch: startEpoch,
        });
        workingMessages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: JSON.stringify(toolOutput),
        });
      }
    }
  } finally {
    unsubStop();
  }

  appendConversationMessageSync({
    conversationId,
    role: 'assistant',
    content: finalText.trim() || 'Done.',
    tokenUsageJson: lastUsage ? JSON.stringify(lastUsage) : null,
    source: 'text',
  });

  // Fire-and-forget post-turn memory consolidation
  void extractMemoriesFromTurn(trimmed, finalText, conversationId).catch(() => {});

  return { assistantText: finalText, usage: lastUsage };
}
