import { JoinCallResponse } from '../types/database';
import { appEnv } from './env';
import { supabase } from './supabaseClient';

async function authorizedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('You must be signed in to perform this action.');
  }

  const response = await fetch(`${appEnv.apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `API request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  createTestCall: (payload?: { title?: string; aiPrompt?: string; voice?: string }) =>
    authorizedFetch<JoinCallResponse>('/calls/test', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),

  acceptCall: (sessionId: string) =>
    authorizedFetch<JoinCallResponse>(`/calls/${sessionId}/accept`, {
      method: 'POST',
    }),

  declineCall: (sessionId: string) =>
    authorizedFetch<{ ok: boolean }>(`/calls/${sessionId}/decline`, {
      method: 'POST',
    }),

  endCall: (sessionId: string) =>
    authorizedFetch<{ ok: boolean }>(`/calls/${sessionId}/end`, {
      method: 'POST',
    }),

  registerDevice: (payload: {
    platform: 'ios' | 'android' | 'web';
    voipToken?: string;
    fcmToken?: string;
    deviceName?: string;
  }) =>
    authorizedFetch('/devices/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
