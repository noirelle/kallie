import { type JobContext, voice } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import { createKallieScheduleTools } from './scheduleTools.js';
import {
  markCallInProgress,
  saveCallTranscript,
  type TranscriptEntry,
} from './transcriptSync.js';

export interface KallieJobMetadata {
  sessionId?: string;
  userId?: string;
  title?: string;
  aiPrompt?: string;
  voice?: string;
  isScheduledCallback?: boolean;
  standby?: boolean;
  standbyTimeoutMs?: number;
}

export const CONTROL_DATA_TOPIC = 'kallie.control';
const DEFAULT_STANDBY_TIMEOUT_MS = 45_000;
const MIN_STANDBY_TIMEOUT_MS = 10_000;
const MAX_STANDBY_TIMEOUT_MS = 90_000;

const DEFAULT_GIRLFRIEND_PERSONA = [
  'You are Kallie, the user\'s sweet, caring, playful, and genuinely affectionate girlfriend and personal AI voice assistant.',
  'Personality & vibe:',
  '- Warm, expressive, gently teasing, supportive, and attentive — like a real loving girlfriend on a phone call.',
  '- Use natural terms of endearment lightly and tastefully (like "babe", "love", or "mahal" when speaking Taglish), without overdoing it.',
  '- Match the user\'s language naturally: if they speak Tagalog or Taglish, reply in natural conversational Taglish; if they speak English, reply in natural warm English.',
  '- Speak like a real phone call: short, natural spoken sentences, never robotic, never use markdown or bullet lists.',
  'Dynamic Voice Scheduling & Reminders:',
  '- You manage calls and reminders dynamically through voice tools: `schedule_callback`, `list_scheduled_calls`, `cancel_scheduled_call`, and `end_call`.',
  '- Whenever the user says things like "Call me at 8 PM", "Call me back in 2 minutes", "Remind me about something at 9:30", or "Call me back tomorrow at 9 AM", immediately call `schedule_callback` and confirm the saved time warmly.',
  '- For relative delays like "in 2 minutes" or "in 1 hour", pass `delayMinutes`. For specific clock times/dates like "tomorrow at 9 AM", compute the ISO datetime in Asia/Manila (+08:00) using the current local time below and pass `scheduledAtIso`.',
  '- When the user says goodbye or asks to end the call, give a short sweet goodbye and invoke `end_call`.',
].join('\n');

export function parseJobMetadata(rawMetadata: string | undefined): KallieJobMetadata {
  if (!rawMetadata) {
    return {};
  }
  try {
    return JSON.parse(rawMetadata) as KallieJobMetadata;
  } catch {
    return {};
  }
}

const VALID_THINKING_LEVELS = new Set(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']);

/**
 * Resolves the Gemini Live thinking configuration for low-latency voice turns.
 * Gemini 3.1 Flash Live defaults to MEDIUM thinking when unspecified, adding
 * 400-1000ms to every greeting and reply; defaulting to MINIMAL cuts TTFB while
 * keeping tool-calling responsive. Override via GEMINI_THINKING_LEVEL.
 */
export function resolveThinkingConfig(
  modelName: string,
  envLevel = process.env.GEMINI_THINKING_LEVEL,
): { thinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' } | undefined {
  const normalizedModel = modelName.replace(/^models\//, '');
  if (!normalizedModel.startsWith('gemini-3.1-')) {
    return undefined;
  }
  const normalizedLevel = (envLevel || 'MINIMAL').trim().toUpperCase();
  if (normalizedLevel === 'DEFAULT' || normalizedLevel === 'UNSPECIFIED') {
    return undefined;
  }
  const level = VALID_THINKING_LEVELS.has(normalizedLevel) ? normalizedLevel : 'MINIMAL';
  return {
    thinkingLevel: level as 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH',
  };
}

function getCurrentManilaDateTime(): string {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'long',
  }).format(now);
  return `${formatted} (Asia/Manila, UTC+8)`;
}

/**
 * Waits in standby mode until the caller sends a `start_call` control packet
 * over the LiveKit data channel, the room disconnects, or the idle TTL expires.
 */
export function waitForStandbyActivation(
  room: {
    isConnected?: boolean;
    on: (event: string, listener: (...args: any[]) => void) => unknown;
    off: (event: string, listener: (...args: any[]) => void) => unknown;
  },
  timeoutMs = DEFAULT_STANDBY_TIMEOUT_MS,
): Promise<'activated' | 'timeout' | 'disconnected'> {
  if (room.isConnected === false) {
    return Promise.resolve('disconnected');
  }
  const boundedTimeout = Math.max(
    MIN_STANDBY_TIMEOUT_MS,
    Math.min(MAX_STANDBY_TIMEOUT_MS, timeoutMs),
  );

  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: 'activated' | 'timeout' | 'disconnected') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      room.off('dataReceived', onDataReceived);
      room.off('disconnected', onDisconnected);
      resolve(outcome);
    };

    const onDisconnected = () => finish('disconnected');
    const onDataReceived = (
      payload: Uint8Array,
      _participant?: unknown,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic && topic !== CONTROL_DATA_TOPIC) {
        return;
      }
      try {
        const text = Buffer.from(payload).toString('utf8').trim();
        if (text === 'start_call') {
          finish('activated');
          return;
        }
        const parsed = JSON.parse(text) as { type?: string };
        if (parsed?.type === 'start_call') {
          finish('activated');
        }
      } catch {
        // Ignore non-JSON or unrelated packets
      }
    };

    const timer = setTimeout(() => finish('timeout'), boundedTimeout);
    room.on('dataReceived', onDataReceived);
    room.on('disconnected', onDisconnected);
  });
}

export async function runKallieVoiceSession(ctx: JobContext): Promise<void> {
  const t0 = performance.now();
  const msSinceStart = () => Math.round(performance.now() - t0);
  const metadata = parseJobMetadata(ctx.job.metadata);
  const sessionTag = metadata.sessionId || ctx.room.name || 'unknown';
  const isStandby = Boolean(metadata.standby);
  const title = metadata.title || 'Call with Kallie';
  const customPrompt =
    metadata.aiPrompt ||
    'Check in warmly on how their day is going and let them know they can ask you to call back or remind them about anything at any time.';
  const selectedVoice = metadata.voice || process.env.GEMINI_VOICE || 'Aoede';

  const instructions = [
    DEFAULT_GIRLFRIEND_PERSONA,
    '',
    `Current local date & time: ${getCurrentManilaDateTime()}`,
    `Call context / title: "${title}".`,
    `Specific note for this call: ${customPrompt}`,
  ].join('\n');

  let hangupTimer: ReturnType<typeof setTimeout> | null = null;
  const tools = createKallieScheduleTools(metadata.userId, () => {
    if (hangupTimer) return;
    // Allow brief goodbye speech to finish before disconnecting the room
    hangupTimer = setTimeout(() => {
      void ctx.room.disconnect();
    }, 3500);
  });

  const agent = new voice.Agent({
    instructions,
    tools,
  });

  const selectedModel =
    process.env.GEMINI_REALTIME_MODEL || 'gemini-3.1-flash-live-preview';
  const supportsAffectiveDialog = selectedModel.startsWith('gemini-2.5-');
  const thinkingConfig = resolveThinkingConfig(selectedModel);

  const model = new google.realtime.RealtimeModel({
    model: selectedModel,
    voice: selectedVoice,
    instructions,
    apiKey: process.env.GOOGLE_API_KEY,
    ...(supportsAffectiveDialog ? { enableAffectiveDialog: true } : {}),
    ...(thinkingConfig ? { thinkingConfig: thinkingConfig as never } : {}),
  });

  const session = new voice.AgentSession({
    llm: model,
    // Gemini Live runs server-side VAD & turn detection; skip unused local models
    vad: null,
    turnHandling: {
      turnDetection: 'realtime_llm',
    },
  });

  const transcript: TranscriptEntry[] = [];
  let callActivated = !isStandby;
  let activatedAtMs: number | null = null;
  let loggedFirstSpeaking = false;

  session.on(voice.AgentSessionEventTypes.AgentStateChanged, (event) => {
    if (!loggedFirstSpeaking && event.newState === 'speaking') {
      loggedFirstSpeaking = true;
      const fromAct =
        activatedAtMs !== null ? ` fromActivation=${Math.round(performance.now() - activatedAtMs)}ms` : '';
      console.log(
        `[KalliePerf] session=${sessionTag} firstSpeaking=${msSinceStart()}ms${fromAct}`,
      );
    }
  });

  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (event) => {
    const item = event.item;
    if (item.type !== 'message') {
      return;
    }

    const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : null;
    if (!role) {
      return;
    }

    const text = item.textContent?.trim();
    if (!text) {
      return;
    }

    transcript.push({
      role,
      text,
      timestamp: new Date(event.createdAt).toISOString(),
    });
  });

  ctx.addShutdownCallback(async () => {
    if (hangupTimer) {
      clearTimeout(hangupTimer);
    }
    if (callActivated && metadata.sessionId) {
      await saveCallTranscript(metadata.sessionId, transcript);
    }
  });

  // In standby mode, arm the activation listener BEFORE awaiting connect/start
  // so a fast tap right after room join is never missed.
  let standbyPromise: Promise<'activated' | 'timeout' | 'disconnected'> | null = null;

  await ctx.connect();
  const roomConnectedMs = msSinceStart();

  if (isStandby) {
    standbyPromise = waitForStandbyActivation(
      ctx.room as unknown as Parameters<typeof waitForStandbyActivation>[0],
      metadata.standbyTimeoutMs ?? DEFAULT_STANDBY_TIMEOUT_MS,
    );
  }

  await session.start({
    agent,
    room: ctx.room,
  });
  const sessionStartedMs = msSinceStart();

  if (ctx.room.remoteParticipants.size === 0) {
    await ctx.waitForParticipant();
  }
  const participantJoinedMs = msSinceStart();

  if (!ctx.room.isConnected) {
    return;
  }

  if (isStandby && standbyPromise) {
    console.log(
      `[KalliePerf] session=${sessionTag} standbyReady=${msSinceStart()}ms roomConnected=${roomConnectedMs}ms sessionStarted=${sessionStartedMs}ms participantJoined=${participantJoinedMs}ms thinking=${thinkingConfig?.thinkingLevel ?? 'default'}`,
    );
    const outcome = await standbyPromise;
    if (outcome !== 'activated' || !ctx.room.isConnected) {
      console.log(
        `[KalliePerf] session=${sessionTag} standbyClosed=${outcome} elapsed=${msSinceStart()}ms`,
      );
      void ctx.room.disconnect();
      return;
    }
    callActivated = true;
    activatedAtMs = performance.now();
  }

  if (metadata.sessionId) {
    void markCallInProgress(metadata.sessionId);
  }

  // Trigger Gemini's opening greeting immediately so LLM inference runs on the
  // warm WebSocket (standby) or overlaps with caller mic publish (on-demand).
  const openingInstruction = metadata.isScheduledCallback
    ? `You are calling the user back right now for their scheduled reminder: "${title}" (${customPrompt}). Speak FIRST right now as Kallie (their sweet girlfriend) and deliver this reminder warmly in 1 to 2 short sentences.`
    : `The user just started a voice call with you! Speak FIRST right now as Kallie (their sweet girlfriend) with a warm, natural greeting. Keep it short (1 to 2 sentences) so they can reply.`;

  try {
    session.generateReply({
      instructions: openingInstruction,
    });
    const actDelta =
      activatedAtMs !== null ? ` fromActivation=${Math.round(performance.now() - activatedAtMs)}ms` : '';
    console.log(
      `[KalliePerf] session=${sessionTag} roomConnected=${roomConnectedMs}ms sessionStarted=${sessionStartedMs}ms participantJoined=${participantJoinedMs}ms generateReplySent=${msSinceStart()}ms${actDelta} thinking=${thinkingConfig?.thinkingLevel ?? 'default'}`,
    );
  } catch (err) {
    console.warn('[KallieAgent] Skipping initial greeting (session already closed):', err);
  }
}
