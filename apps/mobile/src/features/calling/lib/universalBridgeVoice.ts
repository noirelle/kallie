import {
  buildUniversalVoiceGreeting,
  buildVoiceSystemPrompt,
} from '../../ai/lib/kalliePersona';
import {
  resolveActiveRuntime,
  streamWithActiveProvider,
} from '../../ai/lib/providerRegistry';
import { UnifiedChatMessage } from '../../ai/lib/providerTypes';
import { compactOlderScreenDumps } from '../../ai/lib/toolLoop';
import {
  executeLocalTool,
  getAutomationEpochSnapshot,
  getVoiceToolDefinitions,
  isPhoneControlTool,
} from '../../ai/lib/toolRegistry';
import {
  cancelActivePhoneAutomation,
  isConfirmationPending,
  subscribeConfirmationState,
  subscribePhoneAutomationStop,
  tryResolveConfirmationFromTranscript,
} from '../../phoneControl/lib/phoneActionSafety';
import { directAudioBridge } from './directAudioBridge';
import { DirectVoiceCallbacks, DirectVoiceHandle } from './directGeminiVoice';

const ANDROID_SPEECH_ERROR_TIMEOUT = 6;
const ANDROID_SPEECH_ERROR_NO_MATCH = 7;
const ANDROID_SPEECH_ERROR_BUSY = 8;
const MAX_VOICE_TOOL_ROUNDS = 10;

function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*#_~>[\]]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Universal Voice Session fallback for providers without native bidirectional
 * audio WebSockets (Desktop Bridge CLI `agy`/`claude`/`gemini`, 1-Tap OpenRouter,
 * Anthropic Claude, Ollama, and Custom OpenAI-compatible endpoints).
 *
 * Uses native Android SpeechRecognizer + streaming Android TTS routed through
 * MODE_IN_COMMUNICATION + AudioFocus + speakerphone, with full phone-control
 * tool loop, `end_call`, confirmation-gate mic resume, and transient error recovery.
 */
export async function startUniversalVoiceSession(params: {
  providerLabel: string;
  title?: string;
  aiPrompt?: string;
  memoryContext?: string;
  isScheduledCallback?: boolean;
  speakerphone?: boolean;
  callbacks: DirectVoiceCallbacks;
}): Promise<DirectVoiceHandle> {
  let closed = false;
  let muted = false;
  let busyThinkingOrSpeaking = false;
  let streamingComplete = true;
  let endingCallPending = false;
  let consecutiveSpeechErrors = 0;
  let currentTurnAbort: AbortController | null = null;
  let listenRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let speakingPulseTimer: ReturnType<typeof setInterval> | null = null;
  let hangupTimer: ReturnType<typeof setTimeout> | null = null;
  let userTurnId = `uv_u_${Date.now()}`;
  const pendingUtterances = new Set<string>();
  const history: UnifiedChatMessage[] = [];

  const systemPrompt = buildVoiceSystemPrompt({
    title: params.title,
    aiPrompt: params.aiPrompt,
    memoryContext: params.memoryContext,
    isScheduledCallback: params.isScheduledCallback,
    includePhoneTools: true,
    includeDateTime: true,
  });
  const nativeVoiceReady = directAudioBridge.isSpeechAndTtsAvailable();

  // Acquire communication AudioFocus + speakerphone route so TTS plays loudly (not earpiece)
  if (nativeVoiceReady) {
    directAudioBridge.prepareVoiceAudioRoute(params.speakerphone !== false);
  }

  const stopSpeakingPulse = () => {
    if (speakingPulseTimer) {
      clearInterval(speakingPulseTimer);
      speakingPulseTimer = null;
    }
  };

  const startSpeakingPulse = () => {
    stopSpeakingPulse();
    let tick = 0;
    speakingPulseTimer = setInterval(() => {
      if (closed) {
        stopSpeakingPulse();
        return;
      }
      tick += 1;
      const wave = 0.42 + 0.34 * Math.abs(Math.sin(tick * 0.7));
      params.callbacks.onAudioLevel(wave);
    }, 120);
  };

  const finishCallNow = () => {
    if (closed) return;
    cleanup();
    params.callbacks.onEnded('ended_by_voice');
  };

  const scheduleListening = (delayMs = 120, allowDuringConfirm = false) => {
    if (closed || muted || !nativeVoiceReady) return;
    if (busyThinkingOrSpeaking && !(allowDuringConfirm && isConfirmationPending())) return;
    if (listenRetryTimer) clearTimeout(listenRetryTimer);
    listenRetryTimer = setTimeout(() => {
      if (closed || muted) return;
      if (busyThinkingOrSpeaking && !(allowDuringConfirm && isConfirmationPending())) return;
      if (!busyThinkingOrSpeaking) {
        params.callbacks.onAgentState('listening');
        params.callbacks.onAudioLevel(0.1);
      }
      userTurnId = `uv_u_${Date.now()}`;
      void directAudioBridge.startSpeechListening('en-US').catch(() => {
        if (!closed && !muted) {
          consecutiveSpeechErrors = Math.min(consecutiveSpeechErrors + 1, 5);
          const backoff = Math.min(4000, 300 * 2 ** (consecutiveSpeechErrors - 1));
          scheduleListening(backoff, allowDuringConfirm);
        }
      });
    }, delayMs);
  };

  const checkTurnFinished = () => {
    if (closed) return;
    if (streamingComplete && pendingUtterances.size === 0) {
      stopSpeakingPulse();
      busyThinkingOrSpeaking = false;
      if (endingCallPending) {
        finishCallNow();
        return;
      }
      params.callbacks.onAudioLevel(0.08);
      params.callbacks.onAgentState('listening');
      // 320ms post-TTS echo guard prevents STT from re-transcribing trailing speaker reverb
      scheduleListening(320);
    }
  };

  const queueSentenceToTts = (rawSentence: string, isFirst: boolean) => {
    const clean = sanitizeForSpeech(rawSentence);
    if (!clean || closed || !nativeVoiceReady) return;
    const utteranceId = `utt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    pendingUtterances.add(utteranceId);
    void directAudioBridge.speakText(clean, utteranceId, isFirst).catch(() => {
      pendingUtterances.delete(utteranceId);
      checkTurnFinished();
    });
  };

  // Re-enable mic while a Send Confirmation card is open so spoken "Send"/"Cancel" works
  const unsubConfirmState = subscribeConfirmationState((pending) => {
    if (closed || muted || !nativeVoiceReady) return;
    if (pending) {
      // Clear pendingUtterances immediately so stopSpeaking() can never deadlock checkTurnFinished()
      pendingUtterances.clear();
      stopSpeakingPulse();
      directAudioBridge.stopSpeaking();
      // Full 320ms post-TTS echo guard before opening confirmation STT
      scheduleListening(320, true);
    } else if (busyThinkingOrSpeaking) {
      directAudioBridge.stopSpeechListening();
    }
  });

  const handleUserTurn = async (text: string) => {
    const cleaned = text.trim();
    if (!cleaned || closed) return;

    if (isConfirmationPending() && tryResolveConfirmationFromTranscript(cleaned, true)) {
      return;
    }

    if (listenRetryTimer) clearTimeout(listenRetryTimer);
    directAudioBridge.stopSpeechListening();
    directAudioBridge.stopSpeaking();
    pendingUtterances.clear();
    stopSpeakingPulse();
    currentTurnAbort?.abort();
    // Internal cancellation stops in-flight automation without hanging up the active call
    cancelActivePhoneAutomation('internal');

    busyThinkingOrSpeaking = true;
    streamingComplete = false;
    consecutiveSpeechErrors = 0;
    params.callbacks.onTranscriptDelta(userTurnId, 'user', cleaned, true);
    userTurnId = `uv_u_${Date.now()}`;
    params.callbacks.onAgentState('thinking');
    params.callbacks.onAudioLevel(0.16);

    history.push({ role: 'user', content: cleaned });
    if (history.length > 16) {
      history.splice(0, history.length - 16);
    }

    const controller = new AbortController();
    currentTurnAbort = controller;
    const agentTurnId = `uv_a_${Date.now()}`;

    let spokenBuffer = '';
    let sentFirstSentence = false;
    const startEpoch = getAutomationEpochSnapshot();
    let stoppedByNotch = false;
    const unsubStop = subscribePhoneAutomationStop(() => {
      stoppedByNotch = true;
    });

    try {
      const runtime = await resolveActiveRuntime();
      const tools = runtime?.config.capabilities.tools ? getVoiceToolDefinitions() : undefined;
      const workingHistory: UnifiedChatMessage[] = [...history];
      let finalReply = '';
      let endingCall = false;

      for (let round = 0; round < MAX_VOICE_TOOL_ROUNDS; round++) {
        if (closed || controller.signal.aborted) return;
        if (stoppedByNotch || getAutomationEpochSnapshot() !== startEpoch) {
          finalReply = finalReply.trim() || 'Okay love, stopped.';
          break;
        }
        compactOlderScreenDumps(workingHistory);

        let roundAccum = '';
        let detectedToolCallInRound = false;
        const response = await streamWithActiveProvider(
          {
            systemPrompt,
            messages: workingHistory,
            tools,
            temperature: 0.7,
            maxTokens: 320,
          },
          {
            onToolCall: () => {
              detectedToolCallInRound = true;
            },
            onTextDelta: (delta) => {
              if (closed || controller.signal.aborted) return;
              roundAccum += delta;
              spokenBuffer += delta;
              params.callbacks.onTranscriptDelta(agentTurnId, 'kallie', roundAccum, false);

              if (detectedToolCallInRound) return;

              const sentenceMatch = spokenBuffer.match(/^([\s\S]*?[.!?\n])(?:\s+|$)([\s\S]*)$/);
              if (sentenceMatch && sentenceMatch[1].trim().length >= 6) {
                const sentence = sentenceMatch[1].trim();
                spokenBuffer = sentenceMatch[2] || '';
                queueSentenceToTts(sentence, !sentFirstSentence);
                sentFirstSentence = true;
                return;
              }
              if (!sentFirstSentence && spokenBuffer.length >= 28) {
                const clauseMatch = spokenBuffer.match(/^([\s\S]{18,}?[,;:])\s+([\s\S]*)$/);
                if (clauseMatch) {
                  const clause = clauseMatch[1].trim();
                  spokenBuffer = clauseMatch[2] || '';
                  queueSentenceToTts(clause, true);
                  sentFirstSentence = true;
                }
              }
            },
          },
          controller.signal,
          runtime,
        );

        if (closed || controller.signal.aborted) return;

        finalReply = (response.text || roundAccum).trim();
        if (!response.toolCalls.length) {
          break;
        }

        if (spokenBuffer.trim()) {
          queueSentenceToTts(spokenBuffer.trim(), !sentFirstSentence);
          sentFirstSentence = true;
          spokenBuffer = '';
        }

        workingHistory.push({
          role: 'assistant',
          content: response.text,
          toolCalls: response.toolCalls,
        });

        params.callbacks.onAgentState('thinking');
        for (const call of response.toolCalls) {
          if (call.name === 'end_call') {
            endingCall = true;
            workingHistory.push({
              role: 'tool',
              toolCallId: call.id,
              toolName: call.name,
              content: JSON.stringify({ ok: true, ending: true }),
            });
            continue;
          }

          if (
            isPhoneControlTool(call.name) &&
            (stoppedByNotch || getAutomationEpochSnapshot() !== startEpoch)
          ) {
            workingHistory.push({
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

          const result = await executeLocalTool(call.name, call.arguments, null, {
            signal: controller.signal,
            epoch: startEpoch,
          });
          workingHistory.push({
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: JSON.stringify(result),
          });
        }

        if (endingCall) {
          if (!finalReply) finalReply = 'Bye love, talk soon!';
          break;
        }
      }

      if (finalReply) {
        params.callbacks.onTranscriptDelta(agentTurnId, 'kallie', finalReply, true);
        history.push({ role: 'assistant', content: finalReply });
      }

      const remainder = (spokenBuffer.trim() || (!sentFirstSentence ? finalReply : '')).trim();
      if (remainder) {
        queueSentenceToTts(remainder, !sentFirstSentence);
        sentFirstSentence = true;
      }

      streamingComplete = true;
      if (endingCall) {
        endingCallPending = true;
        if (!hangupTimer) {
          hangupTimer = setTimeout(() => {
            finishCallNow();
          }, 5500);
        }
      }
      checkTurnFinished();
    } catch {
      if (closed || controller.signal.aborted) return;
      // Recover gracefully from transient turn errors instead of abruptly hanging up the call
      pendingUtterances.clear();
      stopSpeakingPulse();
      const recoveryMsg = 'Sorry, I had a quick connection hiccup. Can you say that again?';
      params.callbacks.onTranscriptDelta(agentTurnId, 'kallie', recoveryMsg, true);
      streamingComplete = true;
      if (nativeVoiceReady) {
        queueSentenceToTts(recoveryMsg, true);
      } else {
        busyThinkingOrSpeaking = false;
        params.callbacks.onAgentState('listening');
      }
      checkTurnFinished();
    } finally {
      unsubStop();
    }
  };

  const unsubPartial = directAudioBridge.onSpeechPartial(({ text }) => {
    if (closed || muted) return;
    if (text.trim() && tryResolveConfirmationFromTranscript(text, false)) return;
    if (busyThinkingOrSpeaking) return;
    if (text.trim()) {
      params.callbacks.onTranscriptDelta(userTurnId, 'user', text.trim(), false);
    }
  });

  const unsubResult = directAudioBridge.onSpeechResult(({ text }) => {
    if (closed || muted) return;
    consecutiveSpeechErrors = 0;
    if (text.trim() && tryResolveConfirmationFromTranscript(text, true)) return;
    if (busyThinkingOrSpeaking) {
      if (isConfirmationPending()) scheduleListening(220, true);
      return;
    }
    if (text.trim()) {
      void handleUserTurn(text);
    } else {
      scheduleListening(180);
    }
  });

  const unsubRms = directAudioBridge.onSpeechRms(({ level }) => {
    if (closed || muted || busyThinkingOrSpeaking) return;
    params.callbacks.onAudioLevel(Math.max(0.08, Math.min(0.95, level)));
  });

  const unsubSpeechError = directAudioBridge.onSpeechError(({ code }) => {
    if (closed || muted) return;
    const allowConfirm = isConfirmationPending();
    if (busyThinkingOrSpeaking && !allowConfirm) return;
    consecutiveSpeechErrors = Math.min(consecutiveSpeechErrors + 1, 5);
    const baseDelay =
      code === ANDROID_SPEECH_ERROR_NO_MATCH || code === ANDROID_SPEECH_ERROR_TIMEOUT
        ? 240
        : code === ANDROID_SPEECH_ERROR_BUSY
          ? 450
          : 600;
    const delay = Math.min(4000, baseDelay * Math.pow(1.6, consecutiveSpeechErrors - 1));
    scheduleListening(Math.round(delay), allowConfirm);
  });

  const unsubTtsStart = directAudioBridge.onTtsStart(() => {
    if (closed) return;
    params.callbacks.onAgentState('speaking');
    startSpeakingPulse();
  });

  const unsubTtsDone = directAudioBridge.onTtsDone(({ utteranceId }) => {
    if (closed) return;
    pendingUtterances.delete(utteranceId);
    checkTurnFinished();
  });

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (listenRetryTimer) clearTimeout(listenRetryTimer);
    if (hangupTimer) clearTimeout(hangupTimer);
    stopSpeakingPulse();
    currentTurnAbort?.abort();
    cancelActivePhoneAutomation('internal');
    pendingUtterances.clear();
    unsubConfirmState();
    unsubPartial();
    unsubResult();
    unsubRms();
    unsubSpeechError();
    unsubTtsStart();
    unsubTtsDone();
    directAudioBridge.stopSpeechListening();
    directAudioBridge.stopSpeaking();
    directAudioBridge.releaseVoiceAudioRoute();
  };

  params.callbacks.onReady();
  params.callbacks.onAgentState('listening');

  if (nativeVoiceReady) {
    const greeting = buildUniversalVoiceGreeting({
      title: params.title,
      isScheduledCallback: params.isScheduledCallback,
    });
    params.callbacks.onTranscriptDelta(`uv_greet_${Date.now()}`, 'kallie', greeting, true);
    busyThinkingOrSpeaking = true;
    streamingComplete = true;
    queueSentenceToTts(greeting, true);
  } else {
    params.callbacks.onTranscriptDelta(
      `uv_info_${Date.now()}`,
      'kallie',
      `Connected to ${params.providerLabel}. Type below or rebuild APK for native voice.`,
      true,
    );
  }

  return {
    sendText: (text: string) => {
      if (closed) return;
      void handleUserTurn(text);
    },
    setMuted: (nextMuted: boolean) => {
      muted = nextMuted;
      if (muted) {
        if (listenRetryTimer) clearTimeout(listenRetryTimer);
        directAudioBridge.stopSpeechListening();
      } else if (!busyThinkingOrSpeaking || isConfirmationPending()) {
        scheduleListening(180, true);
      }
    },
    setSpeakerphone: (enabled: boolean) => {
      directAudioBridge.setSpeakerphone(enabled);
    },
    close: cleanup,
  };
}
