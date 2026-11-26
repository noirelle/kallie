import 'dotenv/config';
import { cli, defineAgent, type JobContext, ServerOptions } from '@livekit/agents';
import { fileURLToPath } from 'node:url';
import { runKallieVoiceSession } from './agentSession.js';

export default defineAgent({
  prewarm: async () => {
    // Keep dependencies warm in idle worker processes for near-instant call joins
    await import('@livekit/agents-plugin-google');
  },
  entry: async (ctx: JobContext) => {
    await runKallieVoiceSession(ctx);
  },
});

const agentName = process.env.LIVEKIT_AGENT_NAME || 'kallie-voice-agent';

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName,
    numIdleProcesses: 1,
    initializeProcessTimeout: 30_000,
  }),
);
