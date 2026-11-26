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
}

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
 * Wait until the caller's WebRTC audio track is subscribed in the room
 * (proving ICE/DTLS + Android AudioSession/AEC are established on the device)
 * before triggering Kallie's opening greeting. Prevents initial words from
 * stuttering, cutting off, or being interrupted during client SDP setup.
 */
async function waitForCallerMediaReady(
  ctx: JobContext,
  timeoutMs = 2500,
): Promise<void> {
  const isAudioKind = (kind: unknown) =>
    kind === 1 || String(kind).toLowerCase().includes('audio');

  const hasSubscribedRemoteAudio = () =>
    Array.from(ctx.room.remoteParticipants.values()).some((participant) =>
      Array.from(participant.trackPublications.values()).some(
        (pub) => pub.subscribed && isAudioKind(pub.kind),
      ),
    );

  if (hasSubscribedRemoteAudio()) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.room.off('trackSubscribed', onTrackSubscribed);
      ctx.room.off('disconnected', finish);
      resolve();
    };
    const onTrackSubscribed = (track: { kind?: unknown }) => {
      if (isAudioKind(track?.kind)) {
        finish();
      }
    };
    const timer = setTimeout(finish, timeoutMs);
    ctx.room.on('trackSubscribed', onTrackSubscribed);
    ctx.room.on('disconnected', finish);
  });
}

export async function runKallieVoiceSession(ctx: JobContext): Promise<void> {
  const metadata = parseJobMetadata(ctx.job.metadata);
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

  const model = new google.realtime.RealtimeModel({
    model: selectedModel,
    voice: selectedVoice,
    instructions,
    apiKey: process.env.GOOGLE_API_KEY,
    ...(supportsAffectiveDialog ? { enableAffectiveDialog: true } : {}),
  });

  const session = new voice.AgentSession({
    llm: model,
  });

  const transcript: TranscriptEntry[] = [];

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
    if (metadata.sessionId) {
      await saveCallTranscript(metadata.sessionId, transcript);
    }
  });

  await ctx.connect();

  await session.start({
    agent,
    room: ctx.room,
  });

  if (metadata.sessionId) {
    void markCallInProgress(metadata.sessionId);
  }

  if (ctx.room.remoteParticipants.size === 0) {
    await ctx.waitForParticipant();
  }

  // Wait for bidirectional WebRTC audio readiness before greeting so first syllables
  // play smoothly into an already-settled, echo-cancelled audio stream
  await waitForCallerMediaReady(ctx, 2500);

  if (!ctx.room.isConnected) {
    return;
  }

  const openingInstruction = metadata.isScheduledCallback
    ? `You are calling the user back right now for their scheduled reminder: "${title}" (${customPrompt}). Speak FIRST right now as Kallie (their sweet girlfriend) and deliver this reminder warmly in 1 to 2 short sentences.`
    : `The user just started a voice call with you! Speak FIRST right now as Kallie (their sweet girlfriend) with a warm, natural greeting. Keep it short (1 to 2 sentences) so they can reply.`;

  try {
    session.generateReply({
      instructions: openingInstruction,
    });
  } catch (err) {
    console.warn('[KallieAgent] Skipping initial greeting (session already closed):', err);
  }
}
