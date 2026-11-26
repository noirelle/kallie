import { Injectable, Logger } from '@nestjs/common';
import { SupabaseAdminService } from '../../common/supabase/supabaseAdmin.service';
import { ApnsVoipService } from './apnsVoip.service';
import {
  CallEndedPushPayload,
  CallReminderPushPayload,
  FcmPushService,
  IncomingCallPushPayload,
} from './fcmPush.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly fcmPush: FcmPushService,
    private readonly apnsVoip: ApnsVoipService,
  ) {}

  private async getUserDevices(userId: string) {
    const { data: tokens, error } = await this.supabaseAdmin.client
      .from('device_tokens')
      .select('platform, voip_token, fcm_token')
      .eq('user_id', userId);

    if (error || !tokens?.length) {
      return [];
    }
    return tokens;
  }

  async notifyIncomingCall(
    userId: string,
    payload: IncomingCallPushPayload,
  ): Promise<void> {
    if (!this.fcmPush.isEnabled() && !this.apnsVoip.isEnabled()) {
      this.logger.debug(
        `Mobile pushes disabled; relying on Supabase Realtime for session ${payload.sessionId}`,
      );
      return;
    }

    const tokens = await this.getUserDevices(userId);
    if (!tokens.length) return;

    await Promise.all(
      tokens.map(async (device) => {
        if (device.platform === 'android' && device.fcm_token) {
          await this.fcmPush.sendIncomingCall(device.fcm_token, payload);
        } else if (device.platform === 'ios' && device.voip_token) {
          await this.apnsVoip.sendVoipCall(device.voip_token, payload);
        }
      }),
    );
  }

  async notifyCallReminder(
    userId: string,
    payload: CallReminderPushPayload,
  ): Promise<void> {
    if (!this.fcmPush.isEnabled()) {
      return;
    }

    const tokens = await this.getUserDevices(userId);
    if (!tokens.length) return;

    await Promise.all(
      tokens.map(async (device) => {
        if (device.platform === 'android' && device.fcm_token) {
          await this.fcmPush.sendCallReminder(device.fcm_token, payload);
        }
      }),
    );
  }

  async notifyCallEnded(
    userId: string,
    payload: CallEndedPushPayload,
  ): Promise<void> {
    if (!this.fcmPush.isEnabled()) {
      return;
    }

    const tokens = await this.getUserDevices(userId);
    if (!tokens.length) return;

    await Promise.all(
      tokens.map(async (device) => {
        if (device.platform === 'android' && device.fcm_token) {
          await this.fcmPush.sendCallEnded(device.fcm_token, payload);
        }
      }),
    );
  }
}
