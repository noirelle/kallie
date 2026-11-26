import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

let cachedClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient) {
    return cachedClient;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return null;
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedClient;
}

export async function markCallInProgress(sessionId: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client || !sessionId) {
    return;
  }

  const { error } = await client
    .from('call_sessions')
    .update({
      status: 'in_progress',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  if (error) {
    console.error(`[TranscriptSync] Failed to mark session ${sessionId} in_progress:`, error.message);
  }
}

export async function saveCallTranscript(
  sessionId: string,
  transcript: TranscriptEntry[],
): Promise<void> {
  const client = getSupabaseClient();
  if (!client || !sessionId) {
    return;
  }

  const { error } = await client
    .from('call_sessions')
    .update({
      status: 'completed',
      ended_at: new Date().toISOString(),
      transcript,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  if (error) {
    console.error(`[TranscriptSync] Failed to save transcript for session ${sessionId}:`, error.message);
  }
}
