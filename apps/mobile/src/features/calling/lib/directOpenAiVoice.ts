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
  tryResolveConfirmationFromTranscript,
} from '../../phoneControl/lib/phoneActionSafety';
import { directAudioBridge } from './directAudioBridge';
import { DirectVoiceCallbacks, DirectVoiceHandle } from './directGeminiVoice';

const DEFAULT_OPENAI_REALTIME_MODEL = 'gpt-4o-realtime-preview';
const MAX_RECONNECT_ATTEMPTS = 2;
const NON_FATAL_OPENAI_ERRORS = new Set([
  'conversation_already_has_active_response',
  'response_cancel_not_active',
  'input_audio_buffer_commit_empty',
]);

/**
 * 100% Serverless Direct-From-Android OpenAI Realtime WebSocket Voice Engine.
 * Streams 24kHz PCM16 audio directly to OpenAI using OkHttp WebSocket auth headers,
 * with hardware Android AEC + pre-roll noise gate, serialized tool calls, active-response
 * tracking, non-fatal conflict handling, and socket-generation guarded reconnects.
 */
export async function startDirectOpenAiVoiceSession(params: {
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
  let sessionReady = false;
  let everReady = false;
  let socketGen = 0;
  let serverResponseDone = true;
  let activeResponseInFlight = false;
  let playbackDraining = false;
  let endingCallPending = false;
  let lastEmittedState: 'connecting' | 'listening' | 'thinking' | 'speaking' | null = null;
  let lastMicEmitMs = 0;
  let speakingFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let agentTurnId = `oa_${Date.now()}`;
  let agentAccum = '';
  let hangupTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let ws: WebSocket | null = null;
  let pendingToolCount = 0;
  let toolChain: Promise<void> = Promise.resolve();
  const recentContextTurns: string[] = [];

  const model = params.model || DEFAULT_OPENAI_REALTIME_MODEL;
  const wsUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;

  const RNWebSocket = WebSocket as unknown as new (
    url: string,
    protocols?: string | string[] | null,
    options?: { headers?: Record<string, string> },
  ) => WebSocket;

  const instructions = buildVoiceSystemPrompt({
    title: params.title,
    aiPrompt: params.aiPrompt,
    memoryContext: params.memoryContext,
    isScheduledCallback: params.isScheduledCallback,
    includePhoneTools: true,
    includeDateTime: true,
  });

  const tools = getVoiceToolDefinitions().map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

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
      if (!closed && serverResponseDone) {
        playbackDraining = false;
        markListeningIfDone();
      }
    }, 1500);
  };

  const markListeningIfDone = () => {
    if (closed) return;
    if (serverResponseDone && !playbackDraining && pendingToolCount === 0) {
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

  const unsubChunk = directAudioBridge.onAudioChunk(({ pcmBase64, level }) => {
    if (closed || !sessionReady) return;
    safeSend({
      type: 'input_audio_buffer.append',
      audio: pcmBase64,
    });
    if (serverResponseDone && !playbackDraining && pendingToolCount === 0 && level > 0.01) {
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
    if (speakingFallbackTimer) clearTimeout(speakingFallbackTimer);
    if (hangupTimer) clearTimeout(hangupTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    params.signal?.removeEventListener('abort', cleanup);
    cancelActivePhoneAutomation('internal');
    unsubChunk();
    unsubPlayback();
    unsubPlaybackIdle();
    closeActiveSocket();
    void directAudioBridge.stop();
  };

  if (params.signal?.aborted) {
    cleanup();
    throw new Error('Voice session cancelled');
  }
  params.signal?.addEventListener('abort', cleanup, { once: true });

  const handleEvent = async (evt: Record<string, any>, evtSocketGen: number) => {
    if (closed || evtSocketGen !== socketGen) return;

    if (evt.type === 'session.updated' && !sessionReady) {
      const wasReconnect = everReady;
      sessionReady = true;
      everReady = true;
      reconnectAttempts = 0;
      params.callbacks.onReady();
      emitAgentState('listening');
      if (!wasReconnect) {
        safeSend({
          type: 'response.create',
          response: {
            instructions: buildVoiceGreetingPrompt({
              title: params.title,
              isScheduledCallback: params.isScheduledCallback,
            }),
          },
        });
      } else if (recentContextTurns.length > 0) {
        safeSend({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: `Reconnected after a brief network blip. Recent conversation:\n${recentContextTurns.join('\n')}`,
              },
            ],
          },
        });
      }
      return;
    }

    if (evt.type === 'response.created') {
      activeResponseInFlight = true;
      serverResponseDone = false;
      return;
    }

    if (evt.type === 'input_audio_buffer.speech_started') {
      directAudioBridge.clearPlayback();
      if (speakingFallbackTimer) {
        clearTimeout(speakingFallbackTimer);
        speakingFallbackTimer = null;
      }
      playbackDraining = false;
      serverResponseDone = true;
      activeResponseInFlight = false;
      emitAgentState('listening');
      params.callbacks.onAudioLevel(0.12);
      return;
    }

    if (
      (evt.type === 'response.audio.delta' || evt.type === 'response.output_audio.delta') &&
      typeof evt.delta === 'string'
    ) {
      serverResponseDone = false;
      playbackDraining = true;
      directAudioBridge.playPcmChunk(evt.delta);
      emitAgentState('speaking');
      resetSpeakingFallback();
      return;
    }

    if (
      (evt.type === 'response.audio_transcript.delta' ||
        evt.type === 'response.output_audio_transcript.delta') &&
      typeof evt.delta === 'string'
    ) {
      agentAccum += evt.delta;
      params.callbacks.onTranscriptDelta(agentTurnId, 'kallie', agentAccum, false);
      return;
    }

    if (evt.type === 'conversation.item.input_audio_transcription.completed' && evt.transcript) {
      const spoken = String(evt.transcript);
      pushRecentTurn('User', spoken);
      tryResolveConfirmationFromTranscript(spoken, true);
      params.callbacks.onTranscriptDelta(
        `ou_${evt.item_id || Date.now()}`,
        'user',
        spoken,
        true,
      );
      return;
    }

    if (evt.type === 'response.function_call_arguments.done') {
      const name = String(evt.name || '');
      const callId = String(evt.call_id || '');
      let args: Record<string, unknown> = {};
      try {
        args = evt.arguments ? JSON.parse(String(evt.arguments)) : {};
      } catch {
        args = {};
      }

      const callSocketGen = evtSocketGen;
      pendingToolCount += 1;
      toolChain = toolChain
        .then(async () => {
          try {
            if (closed || callSocketGen !== socketGen) return;
            emitAgentState('thinking');

            if (name === 'end_call') {
              endingCallPending = true;
              safeSend({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: callId,
                  output: JSON.stringify({ ok: true, ending: true }),
                },
              });
              if (!activeResponseInFlight) {
                safeSend({ type: 'response.create' });
              }
              if (!hangupTimer) {
                hangupTimer = setTimeout(() => {
                  finishCallNow();
                }, 5500);
              }
              return;
            }

            const epoch = getAutomationEpochSnapshot();
            const result = await executeLocalTool(name, args, null, {
              signal: params.signal,
              epoch,
            });
            if (!closed && callSocketGen === socketGen) {
              safeSend({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: callId,
                  output: JSON.stringify(result),
                },
              });
            }
          } finally {
            pendingToolCount = Math.max(0, pendingToolCount - 1);
            // Batch response.create until all queued tool calls finish and no response is already active
            if (
              !closed &&
              callSocketGen === socketGen &&
              pendingToolCount === 0 &&
              name !== 'end_call' &&
              !activeResponseInFlight
            ) {
              safeSend({ type: 'response.create' });
            }
          }
        })
        .catch(() => {
          // Keep toolChain alive on unexpected errors
        });
      return;
    }

    if (evt.type === 'response.done' || evt.type === 'response.cancelled') {
      activeResponseInFlight = false;
      serverResponseDone = true;
      if (agentAccum.trim()) {
        pushRecentTurn('Kallie', agentAccum);
        params.callbacks.onTranscriptDelta(agentTurnId, 'kallie', agentAccum, true);
        agentAccum = '';
        agentTurnId = `oa_${Date.now()}`;
      }
      markListeningIfDone();
      return;
    }

    if (evt.type === 'error') {
      const code = String(evt.error?.code || '');
      if (NON_FATAL_OPENAI_ERRORS.has(code)) {
        // Recoverable race (e.g. spoken confirmation triggered a response while tool finished)
        return;
      }
      const msg = evt.error?.message || 'OpenAI Realtime error';
      params.callbacks.onError(formatSafeError(msg, 'OpenAI Realtime error'));
    }
  };

  const connectSocket = () => {
    if (closed) return;
    closeActiveSocket();
    sessionReady = false;
    activeResponseInFlight = false;
    socketGen += 1;
    const currentGen = socketGen;

    const socket = new RNWebSocket(wsUrl, null, {
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });
    ws = socket;

    socket.onopen = () => {
      if (closed || ws !== socket || currentGen !== socketGen) {
        socket.close();
        return;
      }
      const openAiVoices = new Set([
        'alloy',
        'ash',
        'ballad',
        'coral',
        'echo',
        'sage',
        'shimmer',
        'verse',
      ]);
      const voice =
        params.voiceName && openAiVoices.has(params.voiceName.toLowerCase())
          ? params.voiceName.toLowerCase()
          : 'coral';

      safeSend({
        type: 'session.update',
        session: {
          modalities: ['audio', 'text'],
          instructions,
          voice,
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_noise_reduction: { type: 'near_field' },
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            silence_duration_ms: 500,
            prefix_padding_ms: 250,
            interrupt_response: true,
          },
          tools,
        },
      });
    };

    socket.onmessage = (event) => {
      if (closed || ws !== socket || currentGen !== socketGen || typeof event.data !== 'string') {
        return;
      }
      try {
        void handleEvent(JSON.parse(event.data), currentGen);
      } catch {
        // Ignore parse errors
      }
    };

    socket.onerror = () => {
      if (closed || ws !== socket || currentGen !== socketGen) return;
      if (!everReady) {
        cleanup();
        params.callbacks.onError(
          'Unable to connect to OpenAI Realtime. Check your OpenAI API key and internet connection.',
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
            'OpenAI Realtime rejected the connection. Verify your OpenAI API key in Settings.',
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
    inputSampleRate: 24000,
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
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: trimmed }],
        },
      });
      if (!activeResponseInFlight) {
        safeSend({ type: 'response.create' });
      }
    },
    setMuted(muted: boolean) {
      directAudioBridge.setMuted(muted);
    },
    setSpeakerphone(enabled: boolean) {
      directAudioBridge.setSpeakerphone(enabled);
    },
    close: cleanup,
  };
}
