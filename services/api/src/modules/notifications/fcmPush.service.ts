import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export interface IncomingCallPushPayload {
  sessionId: string;
  roomName: string;
  title: string;
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
}
