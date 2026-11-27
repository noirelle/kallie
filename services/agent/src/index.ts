import 'dotenv/config';
import { cli, defineAgent, type JobContext, ServerOptions } from '@livekit/agents';
import { fileURLToPath } from 'node:url';
import { runKallieVoiceSession } from './agentSession.js';
import { prewarmSpeechGate } from './speechGate.js';

export default defineAgent({
  prewarm: async () => {
    // Keep heavy dependencies and native Silero VAD warm in idle worker processes
    // to eliminate event-loop stalls during initial call audio setup
    prewarmSpeechGate();
    await Promise.all([
      import('@livekit/agents-plugin-google'),
      import('@supabase/supabase-js'),
      import('./agentSession.js'),
    ]);
  },
  entry: async (ctx: JobContext) => {
    await runKallieVoiceSession(ctx);
  },
});

const agentName = process.env.LIVEKIT_AGENT_NAME || 'kallie-voice-agent';
const parsedIdleProcesses = Number.parseInt(process.env.LIVEKIT_NUM_IDLE_PROCESSES || '1', 10);
// Default to 1 warm idle worker (saves ~185MB RAM on 1GB hosts to prevent swap stalls)
const numIdleProcesses = Number.isFinite(parsedIdleProcesses)
  ? Math.max(1, Math.min(4, parsedIdleProcesses))
  : 1;

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName,
    numIdleProcesses,
    initializeProcessTimeout: 30_000,
  }),
);
