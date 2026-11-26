import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export interface IncomingCallPushPayload {
  sessionId: string;
  roomName: string;
  title: string;
}

export interface CallReminderPushPayload {
  scheduleId: string;
  title: string;
  scheduledAt: string;
  minutesUntil: number;
  formattedTime: string;
}

export interface CallEndedPushPayload {
  sessionId: string;
  reason: 'missed' | 'declined' | 'ended';
}

@Injectable()
export class FcmPushService implements OnModuleInit {
  private readonly logger = new Logger(FcmPushService.name);
  private enabled = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.configService
      .get<string>('FIREBASE_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        'Android FCM push disabled (FIREBASE_* env vars not configured). Falling back to Supabase Realtime for open apps.',
      );
      return;
    }

    if (getApps().length === 0) {
      initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    }

    this.enabled = true;
    this.logger.log('Android FCM high-priority push service enabled.');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async sendIncomingCall(fcmToken: string, payload: IncomingCallPushPayload): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      await getMessaging().send({
        token: fcmToken,
        android: {
          priority: 'high',
          ttl: 35 * 1000,
          collapseKey: `call_${payload.sessionId}`,
        },
        data: {
          type: 'incoming_call',
          sessionId: payload.sessionId,
          roomName: payload.roomName,
          title: payload.title,
        },
      });
      this.logger.log(`Sent Android FCM incoming call push for session ${payload.sessionId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send Android FCM push for session ${payload.sessionId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async sendCallReminder(fcmToken: string, payload: CallReminderPushPayload): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const mins = Math.max(1, Math.round(payload.minutesUntil));
    const unit = mins === 1 ? 'minute' : 'minutes';
    const body = `Kallie will call you in ${mins} ${unit} (${payload.formattedTime}).`;

    try {
      await getMessaging().send({
        token: fcmToken,
        notification: {
          title: 'Kallie',
          body,
        },
        android: {
          priority: 'high',
          ttl: mins * 60 * 1000,
          collapseKey: `reminder_${payload.scheduleId}`,
          notification: {
            channelId: 'kallie_reminders',
            tag: `reminder_${payload.scheduleId}`,
            priority: 'high',
            defaultSound: true,
          },
        },
        data: {
          type: 'call_reminder',
          scheduleId: payload.scheduleId,
          title: payload.title,
          scheduledAt: payload.scheduledAt,
          minutesUntil: String(mins),
          formattedTime: payload.formattedTime,
          body,
        },
      });
      this.logger.log(
        `Sent Android FCM reminder push for schedule ${payload.scheduleId} (${mins}m before)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send Android FCM reminder for schedule ${payload.scheduleId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async sendCallEnded(fcmToken: string, payload: CallEndedPushPayload): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      await getMessaging().send({
        token: fcmToken,
        android: {
          priority: 'high',
          ttl: 30 * 1000,
        },
        data: {
          type: 'call_ended',
          sessionId: payload.sessionId,
          reason: payload.reason,
        },
      });
    } catch (error) {
      this.logger.debug(
        `Failed to send call_ended FCM for session ${payload.sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
