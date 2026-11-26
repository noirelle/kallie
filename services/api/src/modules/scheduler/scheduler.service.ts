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
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private isPolling = false;

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
      await this.triggerDueCalls();
      await this.expireUnansweredCalls();
    } catch (error) {
      this.logger.error(
        'Scheduler cycle error',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isPolling = false;
    }
  }

  private async triggerDueCalls() {
    const { data, error } = await this.supabaseAdmin.client.rpc('claim_due_schedules', {
      batch_size: 20,
    });

    if (error) {
      this.logger.warn(`claim_due_schedules RPC skipped/failed: ${error.message}`);
      return;
    }

    const schedules = (data || []) as ClaimedSchedule[];
    if (schedules.length === 0) {
      return;
    }

    this.logger.log(`Claimed ${schedules.length} due call schedule(s).`);

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

      await this.notificationsService.notifyIncomingCall(schedule.user_id, {
        sessionId: session.id,
        roomName: session.room_name,
        title: session.title,
      });
    }
  }

  private async expireUnansweredCalls() {
    const cutoff = new Date(Date.now() - 35_000).toISOString();
    const { error } = await this.supabaseAdmin.client
      .from('call_sessions')
      .update({
        status: 'missed',
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'ringing')
      .lt('created_at', cutoff);

    if (error) {
      this.logger.warn(`Failed to expire unanswered calls: ${error.message}`);
    }
  }
}
