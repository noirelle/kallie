import { UnifiedChatMessage } from './providerTypes';

/**
 * Compacts older `get_screen_ui` tool outputs in a multi-step conversation history
 * so subsequent LLM rounds only carry the latest screen snapshot (cuts token latency ~60%).
 */
export function compactOlderScreenDumps(messages: UnifiedChatMessage[]): void {
  let latestScreenIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'tool' && messages[i].toolName === 'get_screen_ui') {
      latestScreenIdx = i;
      break;
    }
  }
  if (latestScreenIdx <= 0) return;

  for (let i = 0; i < latestScreenIdx; i++) {
    if (
      messages[i].role === 'tool' &&
      messages[i].toolName === 'get_screen_ui' &&
      messages[i].content.length > 120
    ) {
      messages[i] = {
        ...messages[i],
        content: '{"ok":true,"note":"earlier screen snapshot omitted for speed"}',
      };
    }
  }
}
