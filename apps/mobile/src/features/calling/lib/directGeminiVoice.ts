import { formatSafeError } from '../../../lib/errors';
import {
  buildVoiceGreetingPrompt,
  buildVoiceSystemPrompt,
} from '../../ai/lib/kalliePersona';
import {
  executeLocalTool,
  getAutomationEpochSnapshot,
  getVoiceToolDefinitions,
} from '../../ai/lib/toolRegistry';
import {
  cancelActivePhoneAutomation,
  isConfirmationPending,
  subscribeConfirmationState,
  tryResolveConfirmationFromTranscript,
} from '../../phoneControl/lib/phoneActionSafety';
import { directAudioBridge } from './directAudioBridge';

export interface DirectVoiceCallbacks {
  onReady: () => void;
  onAgentState: (state: 'connecting' | 'listening' | 'thinking' | 'speaking') => void;
  onTranscriptDelta: (
    id: string,
    sender: 'user' | 'kallie',
    text: string,
    isFinal: boolean,
  ) => void;
  onAudioLevel: (level: number) => void;
  onEnded: (reason?: string) => void;
  onError: (message: string) => void;
}

export interface DirectVoiceHandle {
  sendText: (text: string) => void;
  setMuted: (muted: boolean) => void;
  setSpeakerphone: (enabled: boolean) => void;
  close: () => void;
}

const DEFAULT_GEMINI_LIVE_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';
const MAX_RECONNECT_ATTEMPTS = 2;

/**
 * 100% Serverless Direct-From-Android Google Gemini Live WebSocket Voice Engine.
 * Streams 16kHz PCM16 mic audio with hardware Android AEC + native pre-roll noise gate
 * directly to Google's edge and plays 24kHz PCM16 responses with instant barge-in,
 * serialized phone tools, local-STT confirmation support (avoiding Gemini barge-in
 * toolCallCancellation), and socket-generation guarded reconnect resilience.
 */
export async function startDirectGeminiVoiceSession(params: {
  apiKey: string;
  voiceName?: string;
  model?: string;
  title?: string;
  aiPrompt?: string;
  memoryContext?: string;
  isScheduledCallback?: boolean;
  speakerphone?: boolean;
  signal?: AbortSignal;
  callbacks: DirectVoiceCallbacks;
}): Promise<DirectVoiceHandle> {
  let closed = false;
  let muted = false;
  let setupComplete = false;
  let everReady = false;
  let socketGen = 0;
  let serverTurnComplete = true;
  let playbackDraining = false;
  let confirmListeningActive = false;
  let endingCallPending = false;
  let lastEmittedState: 'connecting' | 'listening' | 'thinking' | 'speaking' | null = null;
  let lastMicEmitMs = 0;
  let speakingFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let confirmSttTimer: ReturnType<typeof setTimeout> | null = null;
  let hangupTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentUserTurnId = `u_${Date.now()}`;
  let currentAgentTurnId = `a_${Date.now()}`;
  let userAccum = '';
  let agentAccum = '';
  let reconnectAttempts = 0;
  let ws: WebSocket | null = null;
  let toolChain: Promise<void> = Promise.resolve();
  const cancelledToolIds = new Set<string>();
  const recentContextTurns: string[] = [];

  const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(
    params.apiKey,
  )}`;

  const systemInstruction = buildVoiceSystemPrompt({
    title: params.title,
    aiPrompt: params.aiPrompt,
    memoryContext: params.memoryContext,
    isScheduledCallback: params.isScheduledCallback,
    includePhoneTools: true,
    includeDateTime: true,
  });

  const localTools = getVoiceToolDefinitions();

  const emitAgentState = (next: 'connecting' | 'listening' | 'thinking' | 'speaking') => {
    if (closed || lastEmittedState === next) return;
    lastEmittedState = next;
    params.callbacks.onAgentState(next);
  };

  const safeSend = (payload: Record<string, unknown>): boolean => {
    if (closed || !ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  };

  const pushRecentTurn = (who: 'User' | 'Kallie', text: string) => {
    const clean = text.trim();
    if (!clean) return;
    recentContextTurns.push(`${who}: ${clean.slice(0, 140)}`);
    if (recentContextTurns.length > 6) {
      recentContextTurns.splice(0, recentContextTurns.length - 6);
    }
  };

  const finishCallNow = () => {
    if (closed) return;
    cleanup();
    params.callbacks.onEnded('ended_by_voice');
  };

  const resetSpeakingFallback = () => {
    if (speakingFallbackTimer) clearTimeout(speakingFallbackTimer);
    speakingFallbackTimer = setTimeout(() => {
      if (!closed && serverTurnComplete) {
        playbackDraining = false;
        markListeningIfDone();
      }
    }, 1500);
  };

  const markListeningIfDone = () => {
    if (closed) return;
    if (serverTurnComplete && !playbackDraining) {
      if (speakingFallbackTimer) {
        clearTimeout(speakingFallbackTimer);
        speakingFallbackTimer = null;
      }
      if (endingCallPending) {
        finishCallNow();
        return;
      }
      emitAgentState('listening');
      params.callbacks.onAudioLevel(0.12);
    }
  };

  const closeActiveSocket = () => {
    const active = ws;
    ws = null;
    if (!active) return;
    try {
      active.onopen = null;
      active.onmessage = null;
      active.onerror = null;
      active.onclose = null;
      if (active.readyState === WebSocket.OPEN || active.readyState === WebSocket.CONNECTING) {
        active.close();
      }
    } catch {
      // Ignore socket close race
    }
  };

  const startLocalConfirmStt = (delayMs = 240) => {
    if (confirmSttTimer) clearTimeout(confirmSttTimer);
    if (closed || muted || !confirmListeningActive || !directAudioBridge.isSpeechAndTtsAvailable()) {
      return;
    }
    confirmSttTimer = setTimeout(() => {
      if (closed || muted || !confirmListeningActive || !isConfirmationPending()) return;
      void directAudioBridge.startSpeechListening('en-US').catch(() => {});
    }, delayMs);
  };

  // While a Send confirmation card is open, pause Gemini PCM uplink so spoken "Yes, send it"
  // never triggers Gemini server-side toolCallCancellation, and resolve via local Android STT.
  const unsubConfirmState = subscribeConfirmationState((pending) => {
    if (closed) return;
    confirmListeningActive = pending;
    if (confirmSttTimer) {
      clearTimeout(confirmSttTimer);
      confirmSttTimer = null;
    }
    if (pending) {
      startLocalConfirmStt(240);
    } else {
      directAudioBridge.stopSpeechListening();
    }
  });

  const unsubConfirmPartial = directAudioBridge.onSpeechPartial(({ text }) => {
    if (closed || !confirmListeningActive || !isConfirmationPending()) return;
    if (text.trim()) {
      tryResolveConfirmationFromTranscript(text, false);
    }
  });

  const unsubConfirmResult = directAudioBridge.onSpeechResult(({ text }) => {
    if (closed || !confirmListeningActive || !isConfirmationPending()) return;
    if (text.trim() && tryResolveConfirmationFromTranscript(text, true)) {
      return;
    }
    if (isConfirmationPending()) {
      startLocalConfirmStt(260);
    }
  });

  const unsubConfirmError = directAudioBridge.onSpeechError(() => {
    if (closed || !confirmListeningActive || !isConfirmationPending()) return;
    startLocalConfirmStt(380);
  });

  const unsubChunk = directAudioBridge.onAudioChunk(({ pcmBase64, level }) => {
    if (closed || !setupComplete || confirmListeningActive) return;
    safeSend({
      realtimeInput: {
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: pcmBase64,
        },
      },
    });
    // Publish throttled mic level while listening so Aura & Orb pulse with user voice
    if (serverTurnComplete && !playbackDraining && level > 0.01) {
      const now = Date.now();
      if (now - lastMicEmitMs >= 100) {
        lastMicEmitMs = now;
        params.callbacks.onAudioLevel(Math.max(0.14, Math.min(0.95, level * 1.45)));
      }
    }
  });

  const unsubPlayback = directAudioBridge.onPlaybackLevel(({ level }) => {
    if (closed) return;
    playbackDraining = true;
    resetSpeakingFallback();
    params.callbacks.onAudioLevel(Math.max(0.28, Math.min(1, level)));
  });

  const unsubPlaybackIdle = directAudioBridge.onPlaybackIdle(() => {
    if (closed) return;
    playbackDraining = false;
    markListeningIfDone();
  });

  const cleanup = () => {
    if (closed) return;
    closed = true;
    confirmListeningActive = false;
    if (speakingFallbackTimer) clearTimeout(speakingFallbackTimer);
    if (confirmSttTimer) clearTimeout(confirmSttTimer);
    if (hangupTimer) clearTimeout(hangupTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    params.signal?.removeEventListener('abort', cleanup);
    cancelActivePhoneAutomation('internal');
    unsubConfirmState();
    unsubConfirmPartial();
    unsubConfirmResult();
    unsubConfirmError();
    unsubChunk();
    unsubPlayback();
    unsubPlaybackIdle();
    directAudioBridge.stopSpeechListening();
    closeActiveSocket();
    void directAudioBridge.stop();
  };

  if (params.signal?.aborted) {
    cleanup();
    throw new Error('Voice session cancelled');
  }
  params.signal?.addEventListener('abort', cleanup, { once: true });

  const handleParsedMessage = async (msg: Record<string, any>, msgSocketGen: number) => {
    if (closed || msgSocketGen !== socketGen) return;

    if (msg.setupComplete) {
      const wasReconnect = everReady;
      setupComplete = true;
      everReady = true;
      reconnectAttempts = 0;
      params.callbacks.onReady();
      emitAgentState('listening');

      if (!wasReconnect) {
        const greetingPrompt = buildVoiceGreetingPrompt({
          title: params.title,
          isScheduledCallback: params.isScheduledCallback,
        });
        safeSend({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text: greetingPrompt }] }],
            turnComplete: true,
          },
        });
      } else if (recentContextTurns.length > 0) {
        // Restore short conversational continuity after a transient reconnect without re-greeting
        safeSend({
          clientContent: {
            turns: [
              {
                role: 'user',
                parts: [
                  {
                    text: `[Brief connection blip recovered. Recent call context:\n${recentContextTurns.join('\n')}\nContinue listening quietly until the user speaks.]`,
                  },
                ],
              },
            ],
            turnComplete: false,
          },
        });
      }
      return;
    }

    if (msg.toolCallCancellation?.ids && Array.isArray(msg.toolCallCancellation.ids)) {
      for (const rawId of msg.toolCallCancellation.ids) {
        if (rawId) cancelledToolIds.add(String(rawId));
      }
      cancelActivePhoneAutomation('internal');
      return;
    }

    if (msg.toolCall?.functionCalls && Array.isArray(msg.toolCall.functionCalls)) {
      // Flush any accumulated user utterance so prior words never bleed into subsequent turns
      if (userAccum.trim()) {
        pushRecentTurn('User', userAccum);
        params.callbacks.onTranscriptDelta(currentUserTurnId, 'user', userAccum, true);
        userAccum = '';
        currentUserTurnId = `u_${Date.now()}`;
      }

      const calls = msg.toolCall.functionCalls as Array<Record<string, any>>;
      const callSocketGen = msgSocketGen;
      toolChain = toolChain
        .then(async () => {
          if (closed || callSocketGen !== socketGen) return;
          emitAgentState('thinking');
          const epoch = getAutomationEpochSnapshot();
          const functionResponses: Array<Record<string, unknown>> = [];

          for (const call of calls) {
            const name = String(call.name || '');
            const id = call.id ? String(call.id) : undefined;
            const args = (call.args || {}) as Record<string, unknown>;

            if (id && cancelledToolIds.has(id)) {
              cancelledToolIds.delete(id);
              continue;
            }

            if (name === 'end_call') {
              endingCallPending = true;
              functionResponses.push({
                ...(id ? { id } : {}),
                name,
                response: { ok: true, ending: true },
              });
              if (!hangupTimer) {
                hangupTimer = setTimeout(() => {
                  finishCallNow();
                }, 5500);
              }
              continue;
            }

            const result = await executeLocalTool(name, args, null, {
              signal: params.signal,
              epoch,
            });

            if (closed || callSocketGen !== socketGen) return;

            if (id && cancelledToolIds.has(id)) {
              cancelledToolIds.delete(id);
              continue;
            }

            functionResponses.push({
              ...(id ? { id } : {}),
              name,
              response: result,
            });
          }

          if (!closed && callSocketGen === socketGen && functionResponses.length > 0) {
            safeSend({ toolResponse: { functionResponses } });
          }
        })
        .catch(() => {
          // Keep toolChain alive even if an individual tool or send throws
        });
      return;
    }

    const sc = msg.serverContent;
    if (!sc) return;

    if (sc.interrupted) {
      directAudioBridge.clearPlayback();
      if (speakingFallbackTimer) {
        clearTimeout(speakingFallbackTimer);
        speakingFallbackTimer = null;
      }
      playbackDraining = false;
      serverTurnComplete = true;
      emitAgentState('listening');
      params.callbacks.onAudioLevel(0.12);
      if (agentAccum.trim()) {
        pushRecentTurn('Kallie', agentAccum);
        params.callbacks.onTranscriptDelta(currentAgentTurnId, 'kallie', agentAccum, true);
        agentAccum = '';
        currentAgentTurnId = `a_${Date.now()}`;
      }
    }

    if (sc.inputTranscription?.text) {
      userAccum += sc.inputTranscription.text;
      tryResolveConfirmationFromTranscript(userAccum, false);
      params.callbacks.onTranscriptDelta(currentUserTurnId, 'user', userAccum, false);
    }

    if (sc.outputTranscription?.text) {
      agentAccum += sc.outputTranscription.text;
      params.callbacks.onTranscriptDelta(currentAgentTurnId, 'kallie', agentAccum, false);
    }

    const parts = sc.modelTurn?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        const audioData = part.inlineData?.data;
        if (typeof audioData === 'string' && audioData.length > 0) {
          if (userAccum.trim()) {
            pushRecentTurn('User', userAccum);
            tryResolveConfirmationFromTranscript(userAccum, true);
            params.callbacks.onTranscriptDelta(currentUserTurnId, 'user', userAccum, true);
            userAccum = '';
            currentUserTurnId = `u_${Date.now()}`;
          }
          serverTurnComplete = false;
          playbackDraining = true;
          directAudioBridge.playPcmChunk(audioData);
          emitAgentState('speaking');
          resetSpeakingFallback();
        }
      }
    }

    if (sc.turnComplete) {
      serverTurnComplete = true;
      if (userAccum.trim()) {
        pushRecentTurn('User', userAccum);
        tryResolveConfirmationFromTranscript(userAccum, true);
        params.callbacks.onTranscriptDelta(currentUserTurnId, 'user', userAccum, true);
        userAccum = '';
        currentUserTurnId = `u_${Date.now()}`;
      }
      if (agentAccum.trim()) {
        pushRecentTurn('Kallie', agentAccum);
        params.callbacks.onTranscriptDelta(currentAgentTurnId, 'kallie', agentAccum, true);
        agentAccum = '';
        currentAgentTurnId = `a_${Date.now()}`;
      }
      markListeningIfDone();
    }
  };

  const connectSocket = () => {
    if (closed) return;
    closeActiveSocket();
    setupComplete = false;
    socketGen += 1;
    const currentGen = socketGen;
    const socket = new WebSocket(wsUrl);
    ws = socket;

    socket.onopen = () => {
      if (closed || ws !== socket || currentGen !== socketGen) {
        socket.close();
        return;
      }
      const modelName = params.model?.startsWith('models/')
        ? params.model
        : params.model
          ? `models/${params.model}`
          : DEFAULT_GEMINI_LIVE_MODEL;

      safeSend({
        setup: {
          model: modelName,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: params.voiceName || 'Aoede',
                },
              },
            },
          },
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
              endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
              prefixPaddingMs: 250,
              silenceDurationMs: 500,
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [
            {
              functionDeclarations: localTools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
            },
          ],
        },
      });
    };

    socket.onmessage = (event) => {
      if (closed || ws !== socket || currentGen !== socketGen) return;
      try {
        if (typeof event.data === 'string') {
          void handleParsedMessage(JSON.parse(event.data), currentGen);
        } else if (event.data instanceof ArrayBuffer) {
          const text =
            typeof TextDecoder !== 'undefined'
              ? new TextDecoder().decode(new Uint8Array(event.data))
              : String.fromCharCode(...Array.from(new Uint8Array(event.data)));
          void handleParsedMessage(JSON.parse(text), currentGen);
        }
      } catch {
        // Ignore malformed frame
      }
    };

    socket.onerror = () => {
      if (closed || ws !== socket || currentGen !== socketGen) return;
      if (!everReady) {
        cleanup();
        params.callbacks.onError(
          'Unable to connect to Gemini Live. Check your Gemini API key and internet connection.',
        );
      }
    };

    socket.onclose = (event) => {
      if (closed || ws !== socket || currentGen !== socketGen) return;
      if (!everReady) {
        cleanup();
        params.callbacks.onError(
          formatSafeError(
            event.reason,
            'Gemini Live rejected the session. Verify your Gemini API key in Settings.',
          ),
        );
        return;
      }
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && event.code !== 1000) {
        reconnectAttempts += 1;
        emitAgentState('connecting');
        reconnectTimer = setTimeout(() => {
          if (!closed) connectSocket();
        }, 700 * reconnectAttempts);
        return;
      }
      cleanup();
      params.callbacks.onEnded(event.reason || 'closed');
    };
  };

  // Start WebSocket handshake and hardware audio capture in parallel
  connectSocket();
  const audioStartPromise = directAudioBridge.start({
    inputSampleRate: 16000,
    outputSampleRate: 24000,
    speakerphone: params.speakerphone !== false,
  });

  try {
    await audioStartPromise;
  } catch (err) {
    cleanup();
    throw err;
  }

  if (closed) {
    void directAudioBridge.stop();
    throw new Error('Voice session closed during startup');
  }

  return {
    sendText(text: string) {
      if (closed) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      if (tryResolveConfirmationFromTranscript(trimmed, true)) return;
      pushRecentTurn('User', trimmed);
      safeSend({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: trimmed }] }],
          turnComplete: true,
        },
      });
    },
    setMuted(nextMuted: boolean) {
      muted = nextMuted;
      directAudioBridge.setMuted(nextMuted);
      if (nextMuted) {
        directAudioBridge.stopSpeechListening();
      } else if (confirmListeningActive && isConfirmationPending()) {
        startLocalConfirmStt(160);
      }
    },
    setSpeakerphone(enabled: boolean) {
      directAudioBridge.setSpeakerphone(enabled);
    },
    close: cleanup,
  };
}
