import { llm } from '@livekit/agents';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedSupabase: SupabaseClient | null = null;

function getSupabaseAdmin(): SupabaseClient | null {
  if (cachedSupabase) {
    return cachedSupabase;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }
  cachedSupabase = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cachedSupabase;
}

function formatManilaTime(isoString: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(isoString));
}

function resolveScheduledDate(args: {
  delayMinutes?: number;
  scheduledAtIso?: string;
}): Date | null {
  if (
    typeof args.delayMinutes === 'number' &&
    Number.isFinite(args.delayMinutes) &&
    args.delayMinutes > 0
  ) {
    return new Date(Date.now() + args.delayMinutes * 60_000);
  }

  if (args.scheduledAtIso) {
    const raw = args.scheduledAtIso.trim();
    const hasOffset = /([zZ]|[+-]\d{2}:\d{2})$/.test(raw);
    const normalized = hasOffset ? raw : `${raw}+08:00`;
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

export function createKallieScheduleTools(
  userId: string | undefined,
  onRequestEndCall?: (reason?: string) => void,
) {
  const scheduleCallback = llm.tool({
    name: 'schedule_callback',
    description:
      'Schedule an automatic AI callback or reminder call from Kallie to the user. Use whenever the user says things like "call me at 8 PM", "remind me to drink water in 2 minutes", or "call me back tomorrow at 9 AM".',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short label for the call or reminder (e.g., "Morning Call", "Drink Water Reminder").',
        },
        reminderNote: {
          type: 'string',
          description:
            'Exact note or instruction for what Kallie should say or remind the user about when calling back.',
        },
        delayMinutes: {
          type: 'number',
          description:
            'Relative delay in minutes (e.g. 2 for "in 2 minutes", 60 for "in 1 hour"). Prefer this for relative times.',
        },
        scheduledAtIso: {
          type: 'string',
          description:
            'ISO-8601 datetime with +08:00 timezone offset for Asia/Manila (e.g. "2026-11-27T09:00:00+08:00") for specific clock times/dates.',
        },
        recurrence: {
          type: 'string',
          enum: ['none', 'daily', 'weekly'],
          description: 'Whether this reminder repeats. Defaults to "none".',
        },
      },
      required: ['title', 'reminderNote'],
    },
    execute: async (args: {
      title: string;
      reminderNote: string;
      delayMinutes?: number;
      scheduledAtIso?: string;
      recurrence?: 'none' | 'daily' | 'weekly';
    }) => {
      if (!userId) {
        return {
          ok: false,
          error: 'Unable to save schedule because user session is missing.',
        };
      }

      const supabase = getSupabaseAdmin();
      if (!supabase) {
        return {
          ok: false,
          error: 'Database is not configured on the agent worker.',
        };
      }

      const targetDate = resolveScheduledDate(args);
      if (!targetDate) {
        return {
          ok: false,
          error: 'Could not understand the requested time. Please ask the user to clarify.',
        };
      }

      const iso = targetDate.toISOString();
      const recurrence =
        args.recurrence === 'daily' || args.recurrence === 'weekly' ? args.recurrence : 'none';

      const { data, error } = await supabase
        .from('call_schedules')
        .insert({
          user_id: userId,
          title: args.title.trim(),
          ai_prompt: args.reminderNote.trim(),
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
          error: error?.message || 'Database insert failed',
        };
      }

      return {
        ok: true,
        id: data.id,
        title: data.title,
        scheduledForLocal: formatManilaTime(data.next_run_at),
        recurrence: data.recurrence,
      };
    },
  });

  const listScheduledCalls = llm.tool({
    name: 'list_scheduled_calls',
    description:
      'List the user\'s upcoming scheduled callbacks and reminders so Kallie can tell them what is scheduled.',
    execute: async () => {
      const supabase = getSupabaseAdmin();
      if (!supabase || !userId) {
        return { ok: false, schedules: [] };
      }

      const { data, error } = await supabase
        .from('call_schedules')
        .select('id, title, ai_prompt, next_run_at, recurrence')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('next_run_at', { ascending: true })
        .limit(10);

      if (error) {
        return { ok: false, error: error.message, schedules: [] };
      }

      return {
        ok: true,
        schedules: (data || []).map((row) => ({
          id: row.id,
          title: row.title,
          note: row.ai_prompt,
          whenLocal: row.next_run_at ? formatManilaTime(row.next_run_at) : 'unscheduled',
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
        titleQuery: {
          type: 'string',
          description:
            'Keyword or title of the call/reminder to cancel, or "all" to cancel all active reminders.',
        },
      },
      required: ['titleQuery'],
    },
    execute: async (args: { titleQuery: string }) => {
      const supabase = getSupabaseAdmin();
      if (!supabase || !userId) {
        return { ok: false, cancelledCount: 0 };
      }

      const query = args.titleQuery.trim();
      let request = supabase
        .from('call_schedules')
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('status', 'active');

      if (query.toLowerCase() !== 'all') {
        request = request.ilike('title', `%${query}%`);
      }

      const { data, error } = await request.select('id, title');
      if (error) {
        return { ok: false, error: error.message, cancelledCount: 0 };
      }

      return {
        ok: true,
        cancelledCount: data?.length || 0,
        cancelledTitles: (data || []).map((d) => d.title),
      };
    },
  });

  const endCall = llm.tool({
    name: 'end_call',
    description:
      'End the current voice call cleanly after saying goodbye when the user asks to hang up or says bye.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Brief reason for ending the call.',
        },
      },
    },
    execute: async (args: { reason?: string }) => {
      onRequestEndCall?.(args?.reason);
      return { ok: true, ending: true };
    },
  });

  return [scheduleCallback, listScheduledCalls, cancelScheduledCall, endCall];
}
