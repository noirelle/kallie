import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export interface CallSessionRow {
  id: string;
  schedule_id: string | null;
  user_id: string;
  room_name: string;
  title: string;
  ai_prompt: string;
  status: 'ringing' | 'accepted' | 'in_progress' | 'completed' | 'missed' | 'declined';
  created_at: string;
}

export interface CallScheduleRow {
  id: string;
  title: string;
  ai_prompt: string;
  next_run_at: string | null;
  recurrence: string;
  status: string;
}

export interface JoinCallResponse {
  session: CallSessionRow;
  livekitUrl: string;
  roomName: string;
  token: string;
}

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

async function authorizedPost<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('Please sign in first.');
  }

  const res = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body || {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const kallieApi = {
  startCall: (voice?: string) =>
    authorizedPost<JoinCallResponse>('/calls/test', {
      title: 'Call with Kallie',
      ...(voice ? { voice } : {}),
    }),

  acceptCall: (sessionId: string) =>
    authorizedPost<JoinCallResponse>(`/calls/${sessionId}/accept`),

  declineCall: (sessionId: string) =>
    authorizedPost<{ ok: boolean }>(`/calls/${sessionId}/decline`),

  endCall: (sessionId: string) =>
    authorizedPost<{ ok: boolean }>(`/calls/${sessionId}/end`),
};
