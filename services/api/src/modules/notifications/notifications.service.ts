import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { signCallDeclineToken } from '../../common/security/callActionToken';
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
  private readonly signingSecret: string;
  private readonly apiPublicUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly fcmPush: FcmPushService,
    private readonly apnsVoip: ApnsVoipService,
  ) {
    this.signingSecret =
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.configService.get<string>('LIVEKIT_API_SECRET') ||
      '';
    this.apiPublicUrl = (
      this.configService.get<string>('API_PUBLIC_URL') ||
      'https://kallie.nozorin.com/api'
    ).replace(/\/$/, '');
  }

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

    const enrichedPayload: IncomingCallPushPayload = {
      ...payload,
      ...(this.signingSecret
        ? {
            declineToken: signCallDeclineToken(
              this.signingSecret,
              payload.sessionId,
              userId,
            ),
            declineUrl: `${this.apiPublicUrl}/calls/${payload.sessionId}/decline-push`,
          }
        : {}),
    };

    await Promise.all(
      tokens.map(async (device) => {
        if (device.platform === 'android' && device.fcm_token) {
          await this.fcmPush.sendIncomingCall(device.fcm_token, enrichedPayload);
        } else if (device.platform === 'ios' && device.voip_token) {
          await this.apnsVoip.sendVoipCall(device.voip_token, enrichedPayload);
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
