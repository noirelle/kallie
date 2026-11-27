export type RecurrenceType = 'none' | 'daily' | 'weekly';
export type ScheduleStatus = 'active' | 'paused' | 'completed';
export type CallSessionStatus =
  | 'ringing'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'missed'
  | 'declined';

export interface CallSchedule {
  id: string;
  user_id: string;
  title: string;
  ai_prompt: string;
  scheduled_at: string;
  timezone: string;
  recurrence: RecurrenceType;
  next_run_at: string | null;
  status: ScheduleStatus;
  reminder_offset_minutes?: number;
  reminder_sent_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export interface CallSession {
  id: string;
  schedule_id: string | null;
  user_id: string;
  room_name: string;
  title: string;
  ai_prompt: string;
  status: CallSessionStatus;
  started_at: string | null;
  ended_at: string | null;
  transcript: TranscriptEntry[];
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface JoinCallResponse {
  session: CallSession;
  livekitUrl: string;
  roomName: string;
  token: string;
}
