import { MemoryType } from '../../../types/database';
import { streamWithActiveProvider } from '../../ai/lib/providerRegistry';
import { isAutoLearnEnabledSync, localMemoryEngine } from './memoryRepository';

interface ExtractedCandidate {
  content: string;
  memoryType?: MemoryType;
  entities?: string[];
  confidence?: number;
}

const EXTRACTION_SYSTEM_PROMPT = [
  'You extract durable, personal long-term memories from a user message for a private local AI companion.',
  'Only extract genuinely useful, stable facts, preferences, routines, relationships, or goals.',
  'Ignore greetings, filler ("ok", "thanks", "lol"), or one-off transient questions.',
  'Respond ONLY with a valid JSON object of the form: {"memories": [{"content": string, "memoryType": "preference"|"fact"|"episodic"|"procedural", "entities": string[], "confidence": number}]}.',
  'If nothing worth remembering was shared, respond with {"memories": []}.',
].join('\n');

/**
 * Runs asynchronous post-turn memory extraction using whichever AI provider is active.
 * Memories are stored as canonical text + metadata so they survive provider switches.
 */
export async function extractMemoriesFromTurn(
  userMessage: string,
  assistantReply: string,
  conversationId: string,
): Promise<number> {
  if (!isAutoLearnEnabledSync()) return 0;
  const trimmed = userMessage.trim();
  if (trimmed.length < 18) return 0;

  try {
    const response = await streamWithActiveProvider({
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `User said: "${trimmed}"\nAssistant replied: "${assistantReply.slice(0, 400)}"`,
        },
      ],
      temperature: 0.1,
      maxTokens: 320,
      jsonMode: true,
    });

    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return 0;
    const parsed = JSON.parse(jsonMatch[0]) as { memories?: ExtractedCandidate[] };
    const candidates = Array.isArray(parsed.memories) ? parsed.memories : [];

    let saved = 0;
    for (const candidate of candidates.slice(0, 3)) {
      if (!candidate?.content || candidate.content.trim().length < 6) continue;
      await localMemoryEngine.ingest({
        content: candidate.content,
        memoryType: candidate.memoryType || 'fact',
        entities: Array.isArray(candidate.entities) ? candidate.entities : [],
        confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 0.78,
        sourceConversationId: conversationId,
      });
      saved += 1;
    }
    return saved;
  } catch {
    return 0;
  }
}
