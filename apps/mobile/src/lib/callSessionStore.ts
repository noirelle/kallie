import { JoinCallResponse } from '../types/database';

const pendingCalls = new Map<string, JoinCallResponse>();

export function setPendingCallConnection(data: JoinCallResponse): void {
  pendingCalls.set(data.session.id, data);
}

export function getPendingCallConnection(sessionId: string): JoinCallResponse | undefined {
  return pendingCalls.get(sessionId);
}

export function clearPendingCallConnection(sessionId: string): void {
  pendingCalls.delete(sessionId);
}
