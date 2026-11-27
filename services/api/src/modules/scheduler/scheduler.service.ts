import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { SupabaseAdminService } from '../../common/supabase/supabaseAdmin.service';
import { NotificationsService } from '../notifications/notifications.service';

interface ClaimedSchedule {
  id: string;
  user_id: string;
  title: string;
  ai_prompt: string;
  next_run_at: string | null;
  timezone: string | null;
  reminder_offset_minutes?: number | null;
}

function formatScheduledTime(iso: string, timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'Asia/Manila',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  }
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private isPolling = false;
  private readonly fallbackSentReminders = new Map<string, number>();
  private hasPendingRingingCalls = false;
  private lastExpirySweepAt = 0;

  constructor(
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Cron('*/15 * * * * *')
  async processDueSchedules() {
    if (this.isPolling) {
      return;
    }
    this.isPolling = true;

    try {
      await this.sendDueReminders();
      const triggeredCount = await this.triggerDueCalls();
      if (triggeredCount > 0) {
        this.hasPendingRingingCalls = true;
      }

      // Avoid running an UPDATE scan on call_sessions every 15s during idle periods:
      // sweep immediately when ringing calls exist, otherwise run a 60s safety sweep.
      const now = Date.now();
      if (this.hasPendingRingingCalls || now - this.lastExpirySweepAt >= 60_000) {
        this.lastExpirySweepAt = now;
        await this.expireUnansweredCalls();
      }
    } catch (error) {
      this.logger.error(
        'Scheduler cycle error',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isPolling = false;
    }
  }

  private async sendDueReminders() {
    const { data, error } = await this.supabaseAdmin.client.rpc('claim_due_reminders', {
      batch_size: 20,
    });

    let schedules: ClaimedSchedule[] = [];

    if (error) {
      // Fallback when 002_schedule_reminders.sql has not been applied yet:
      // query active schedules due within the next 10 minutes and deduplicate in memory.
      const now = Date.now();
      const minWindow = new Date(now + 30_000).toISOString();
      const maxWindow = new Date(now + 10 * 60_000).toISOString();

      const { data: fallbackRows, error: fallbackError } = await this.supabaseAdmin.client
        .from('call_schedules')
        .select('id, user_id, title, ai_prompt, next_run_at, timezone')
        .eq('status', 'active')
        .gt('next_run_at', minWindow)
        .lte('next_run_at', maxWindow)
        .limit(20);

      if (fallbackError || !fallbackRows?.length) {
        return;
      }

      // Prune stale deduplication keys older than 24h
      for (const [key, ts] of this.fallbackSentReminders.entries()) {
        if (now - ts > 24 * 60 * 60_000) {
          this.fallbackSentReminders.delete(key);
        }
      }

      schedules = (fallbackRows as ClaimedSchedule[]).filter((row) => {
        if (!row.next_run_at) return false;
        const key = `${row.id}:${row.next_run_at}`;
        if (this.fallbackSentReminders.has(key)) {
          return false;
        }
        this.fallbackSentReminders.set(key, now);
        return true;
      });
    } else {
      schedules = (data || []) as ClaimedSchedule[];
    }

    if (schedules.length === 0) {
      return;
    }

    this.logger.log(`Claimed ${schedules.length} due call reminder(s).`);

    for (const schedule of schedules) {
      if (!schedule.next_run_at) continue;
      const msUntil = new Date(schedule.next_run_at).getTime() - Date.now();
      const minutesUntil = Math.max(1, Math.round(msUntil / 60_000));
      const formattedTime = formatScheduledTime(schedule.next_run_at, schedule.timezone);

      await this.notificationsService.notifyCallReminder(schedule.user_id, {
        scheduleId: schedule.id,
        title: schedule.title,
        scheduledAt: schedule.next_run_at,
        minutesUntil,
        formattedTime,
      });
    }
  }

  private async triggerDueCalls(): Promise<number> {
    const { data, error } = await this.supabaseAdmin.client.rpc('claim_due_schedules', {
      batch_size: 20,
    });

    if (error) {
      this.logger.warn(`claim_due_schedules RPC skipped/failed: ${error.message}`);
      return 0;
    }

    const schedules = (data || []) as ClaimedSchedule[];
    if (schedules.length === 0) {
      return 0;
    }

    this.logger.log(`Claimed ${schedules.length} due call schedule(s).`);

    let triggered = 0;
    for (const schedule of schedules) {
      const roomName = `kallie-${crypto.randomUUID()}`;
      const { data: session, error: insertError } = await this.supabaseAdmin.client
        .from('call_sessions')
        .insert({
          schedule_id: schedule.id,
          user_id: schedule.user_id,
          room_name: roomName,
          title: schedule.title,
          ai_prompt: schedule.ai_prompt,
          status: 'ringing',
        })
        .select('id, room_name, title')
        .single();

      if (insertError || !session) {
        this.logger.error(
          `Failed to create ringing session for schedule ${schedule.id}: ${insertError?.message}`,
        );
        continue;
      }

      triggered += 1;
      await this.notificationsService.notifyIncomingCall(schedule.user_id, {
        sessionId: session.id,
        roomName: session.room_name,
        title: session.title,
      });
    }
    return triggered;
  }

  private async expireUnansweredCalls() {
    const cutoff = new Date(Date.now() - 35_000).toISOString();
    const { data: expired, error } = await this.supabaseAdmin.client
      .from('call_sessions')
      .update({
        status: 'missed',
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'ringing')
      .lt('created_at', cutoff)
      .select('id, user_id');

    if (error) {
      this.logger.warn(`Failed to expire unanswered calls: ${error.message}`);
      return;
    }

    if (expired && expired.length > 0) {
      await Promise.all(
        expired.map((row: { id: string; user_id: string }) =>
          this.notificationsService.notifyCallEnded(row.user_id, {
            sessionId: row.id,
            reason: 'missed',
          }),
        ),
      );
    } else {
      this.hasPendingRingingCalls = false;
    }
  }
}
