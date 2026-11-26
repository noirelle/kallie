import { App } from '@/components/app/app';

export default function CallPage() {
  return <App agentName={process.env.AGENT_NAME || 'kallie-voice-agent'} />;
}
