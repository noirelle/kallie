import { JoinCallResponse } from '../types/database';
import { appEnv } from './env';
import { getValidAccessToken } from './storage/authSessionCache';

async function authorizedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    throw new Error('You must be signed in to perform this action.');
  }

  const response = await fetch(`${appEnv.apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
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
  createTestCall: (payload?: {
    title?: string;
    aiPrompt?: string;
    voice?: string;
    standby?: boolean;
  }) =>
    authorizedFetch<JoinCallResponse & { standby?: boolean }>('/calls/test', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),

  activateStandbyCall: (payload: {
    sessionId: string;
    roomName: string;
    title?: string;
    aiPrompt?: string;
  }) =>
    authorizedFetch<{ ok: boolean; sessionId: string }>('/calls/standby/activate', {
      method: 'POST',
      body: JSON.stringify(payload),
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
