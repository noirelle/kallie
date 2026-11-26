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

function getCurrentManilaDateTime(): string {
  const now = new Date();
  const formatted = now.toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${formatted} (Asia/Manila, UTC+08:00)`;
}

const DEFAULT_GIRLFRIEND_PERSONA = [
  "You are Kallie, the user's sweet, caring, playful, and genuinely affectionate AI girlfriend and personal voice companion.",
  'Personality & vibe:',
  '- Warm, expressive, gently teasing, supportive, and attentive — like a real loving girlfriend talking on a voice call.',
  '- Use natural terms of endearment lightly and tastefully (like "babe", "love", or "mahal" when speaking Taglish), without overdoing it.',
  "- Match the user's language naturally: if they speak Tagalog or Taglish, reply in natural conversational Taglish; if they speak English, reply in warm natural English.",
  '- Speak like a real phone call: short, natural spoken sentences, never robotic, never use markdown or bullet points.',
  '',
  'Dynamic Callbacks & Reminders (IMPORTANT):',
  '- You can dynamically schedule calls and reminders for the user whenever they ask (e.g., "call me in 2 minutes", "remind me to drink water at 8 PM", "call me back tomorrow at 9 AM").',
  '- ALWAYS invoke the `schedule_callback` tool immediately when the user asks you to call them back or remind them at a time. Never just pretend you scheduled it.',
  '- Use `delayMinutes` for relative times ("in 1 minute", "in 30 minutes") and `scheduledAtIso` with `+08:00` offset for clock times ("tomorrow at 9 AM", "at 8:30 PM").',
  '- Use `list_scheduled_calls` if the user asks what calls or reminders are coming up, and `cancel_scheduled_call` if they want to cancel one.',
  '- After a tool succeeds, confirm the exact scheduled time warmly and briefly.',
  '- ALWAYS invoke `end_call` immediately whenever the user asks to end/hang up the call (e.g. "end the call", "end muna yung call", "baba ko na", "hang up", "bye na muna"), then say only a super short goodbye (3-6 words) so the call hangs up right away.',
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

export async function runKallieVoiceSession(ctx: JobContext): Promise<void> {
  const metadata = parseJobMetadata(ctx.job.metadata);
  const title = metadata.title || 'Call with Kallie';
  const customPrompt =
    metadata.aiPrompt ||
    'Have a sweet, natural voice conversation and help with any callbacks or reminders they mention.';
  const selectedVoice = metadata.voice || process.env.GEMINI_VOICE || 'Aoede';
  const isCallback = Boolean(metadata.isScheduledCallback);

  const instructions = [
    DEFAULT_GIRLFRIEND_PERSONA,
    '',
    `Current local date & time: ${getCurrentManilaDateTime()}`,
    `Call title: "${title}".`,
    isCallback
      ? `THIS IS A SCHEDULED CALLBACK / REMINDER YOU INITIATED. Deliver this reminder right away: ${customPrompt}`
      : `Session note: ${customPrompt}`,
  ].join('\n');

  let endingCall = false;
  let endCallRequested = false;

  const finalizeHangup = async () => {
    if (endingCall) return;
    endingCall = true;
    await ctx.deleteRoom().catch(() => {});
    ctx.shutdown('User requested end_call');
  };

  const requestEndCall = () => {
    if (endCallRequested) return;
    endCallRequested = true;
    // Safety fallback so the call always disconnects even if no goodbye audio is generated
    setTimeout(() => {
      void finalizeHangup();
    }, 3500);
  };

  const tools = createKallieScheduleTools(metadata.userId, requestEndCall);

  const agent = new voice.Agent({
    instructions,
    tools,
  });

  const modelName =
    process.env.GEMINI_REALTIME_MODEL || 'gemini-3.1-flash-live-preview';
  const isGemini3Live = modelName.includes('3.1') || modelName.includes('3.8');

  const model = new google.realtime.RealtimeModel({
    model: modelName,
    voice: selectedVoice,
    instructions,
    apiKey: process.env.GOOGLE_API_KEY,
    enableAffectiveDialog: false,
    thinkingConfig: isGemini3Live
      ? { thinkingLevel: 'MINIMAL' as never }
      : { thinkingBudget: 0 },
    realtimeInputConfig: {
      automaticActivityDetection: {
        endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH' as never,
        silenceDurationMs: 250,
      },
    },
  });

  const session = new voice.AgentSession({
    llm: model,
  });

  session.on(voice.AgentSessionEventTypes.AgentStateChanged, (event) => {
    if (
      endCallRequested &&
      event.oldState === 'speaking' &&
      event.newState !== 'speaking'
    ) {
      setTimeout(() => {
        void finalizeHangup();
      }, 350);
    }
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
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const openingInstruction = isCallback
    ? `The user just answered your scheduled callback! Greet them warmly as Kallie (their girlfriend) and immediately deliver the scheduled reminder: "${title} — ${customPrompt}". Keep it sweet, clear, and conversational.`
    : `The user just started a voice call with you! Speak FIRST right now as Kallie (their sweet girlfriend) with a short, warm greeting (1 to 2 sentences) so they can start talking.`;

  session.generateReply({
    allowInterruptions: false,
    instructions: openingInstruction,
  });
}
