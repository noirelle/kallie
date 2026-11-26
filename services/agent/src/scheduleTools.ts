import { llm } from '@livekit/agents';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let cachedSupabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (cachedSupabase) {
    return cachedSupabase;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }
  cachedSupabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedSupabase;
}

function formatManilaTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function createKallieScheduleTools(
  userId: string | undefined,
  onRequestEndCall?: () => void,
) {
  const scheduleCallback = llm.tool({
    name: 'schedule_callback',
    description:
      'Schedule an automated callback phone call or reminder from Kallie at a specific future time. Use this whenever the user asks to be called back, woken up, or reminded about something at a certain time (e.g. "call me in 2 minutes", "remind me at 8 PM", "call me back tomorrow at 9 AM").',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short friendly title for the call or reminder (e.g. "Drink Water Reminder", "Morning Call").',
        },
        reminderNote: {
          type: 'string',
          description:
            'Detailed note of what Kallie should say or remind the user about when initiating that future call.',
        },
        delayMinutes: {
          type: 'number',
          description:
            'Use for relative delays like "in 1 minute", "in 10 minutes", "in 2 hours" (e.g. 1, 10, 120). Omit if scheduledAtIso is provided.',
        },
        scheduledAtIso: {
          type: 'string',
          description:
            'Absolute ISO-8601 timestamp with +08:00 timezone offset for specific clock times like "tomorrow at 9 AM" (e.g. "2026-11-27T09:00:00+08:00"). Omit if delayMinutes is provided.',
        },
        recurrence: {
          type: 'string',
          enum: ['none', 'daily', 'weekly'],
          description: 'Repeat frequency. Defaults to "none".',
        },
      },
      required: ['title', 'reminderNote'],
    },
    execute: async (args) => {
      const supabase = getSupabase();
      if (!supabase || !userId) {
        return {
          ok: false,
          error: 'User identity or Supabase database is unavailable for scheduling.',
        };
      }

      const title = String(args.title || 'Kallie Reminder').trim();
      const reminderNote = String(args.reminderNote || title).trim();
      const recurrence =
        args.recurrence === 'daily' || args.recurrence === 'weekly' ? args.recurrence : 'none';

      let targetDate: Date | null = null;
      if (typeof args.delayMinutes === 'number' && args.delayMinutes > 0) {
        targetDate = new Date(Date.now() + Math.round(args.delayMinutes * 60_000));
      } else if (typeof args.scheduledAtIso === 'string' && args.scheduledAtIso.trim()) {
        const parsed = new Date(args.scheduledAtIso.trim());
        if (!Number.isNaN(parsed.getTime())) {
          targetDate = parsed;
        }
      }

      if (!targetDate) {
        return {
          ok: false,
          error: 'Could not determine a valid future time. Please ask the user to clarify the time.',
        };
      }

      const iso = targetDate.toISOString();
      const { data, error } = await supabase
        .from('call_schedules')
        .insert({
          user_id: userId,
          title,
          ai_prompt: reminderNote,
          scheduled_at: iso,
          next_run_at: iso,
          timezone: 'Asia/Manila',
          recurrence,
          status: 'active',
        })
        .select('id, title, next_run_at, recurrence')
        .single();

      if (error || !data) {
        return {
          ok: false,
          error: error?.message || 'Failed to save scheduled call.',
        };
      }

      return {
        ok: true,
        scheduleId: data.id,
        title: data.title,
        scheduledForLocal: formatManilaTime(data.next_run_at),
        recurrence: data.recurrence,
      };
    },
  });

  const listScheduledCalls = llm.tool({
    name: 'list_scheduled_calls',
    description:
      'List the user\'s upcoming active scheduled calls and reminders so Kallie can tell them what is scheduled.',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      const supabase = getSupabase();
      if (!supabase || !userId) {
        return { ok: false, reminders: [] };
      }

      const { data, error } = await supabase
        .from('call_schedules')
        .select('id, title, ai_prompt, next_run_at, recurrence')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('next_run_at', { ascending: true })
        .limit(10);

      if (error) {
        return { ok: false, error: error.message, reminders: [] };
      }

      return {
        ok: true,
        reminders: (data || []).map((row) => ({
          id: row.id,
          title: row.title,
          note: row.ai_prompt,
          scheduledForLocal: row.next_run_at ? formatManilaTime(row.next_run_at) : 'unscheduled',
          recurrence: row.recurrence,
        })),
      };
    },
  });

  const cancelScheduledCall = llm.tool({
    name: 'cancel_scheduled_call',
    description:
      'Cancel an upcoming scheduled call or reminder when the user asks to cancel or remove it.',
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: 'Optional keyword from the reminder title (e.g. "water", "morning"). If omitted, cancels the next upcoming call.',
        },
      },
    },
    execute: async (args) => {
      const supabase = getSupabase();
      if (!supabase || !userId) {
        return { ok: false, error: 'Database unavailable.' };
      }

      const { data: rows, error } = await supabase
        .from('call_schedules')
        .select('id, title, next_run_at')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('next_run_at', { ascending: true })
        .limit(10);

      if (error || !rows?.length) {
        return { ok: false, message: 'No active scheduled calls found to cancel.' };
      }

      const keyword = typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : '';
      const target =
        (keyword
          ? rows.find((r) => r.title.toLowerCase().includes(keyword))
          : rows[0]) || rows[0];

      const { error: deleteError } = await supabase
        .from('call_schedules')
        .delete()
        .eq('id', target.id);

      if (deleteError) {
        return { ok: false, error: deleteError.message };
      }

      return {
        ok: true,
        cancelledTitle: target.title,
        wasScheduledFor: target.next_run_at ? formatManilaTime(target.next_run_at) : '',
      };
    },
  });

  const endCall = llm.tool({
    name: 'end_call',
    description:
      'Immediately end and hang up the current phone call. Call this whenever the user asks to end the call, hang up, drop the call, or says goodbye for now (e.g. "end the call", "end muna yung call", "hang up", "baba ko na", "bye na").',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Optional brief reason (e.g. "user asked to hang up").',
        },
      },
    },
    execute: async () => {
      onRequestEndCall?.();
      return {
        ok: true,
        message: 'Call is disconnecting right after your short goodbye. Say a very brief 1-sentence goodbye.',
      };
    },
  });

  return [scheduleCallback, listScheduledCalls, cancelScheduledCall, endCall];
}
