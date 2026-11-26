import 'dotenv/config';
import { cli, defineAgent, type JobContext, ServerOptions } from '@livekit/agents';
import { fileURLToPath } from 'node:url';
import { runKallieVoiceSession } from './agentSession.js';

export default defineAgent({
  prewarm: async () => {
    // Keep heavy dependencies warm in idle worker processes to avoid
    // event-loop stalls during initial call audio setup
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

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName,
    numIdleProcesses: 2,
    initializeProcessTimeout: 30_000,
  }),
);
