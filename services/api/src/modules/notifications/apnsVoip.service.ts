import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http2 from 'http2';
import * as path from 'path';
import { IncomingCallPushPayload } from './fcmPush.service';

@Injectable()
export class ApnsVoipService implements OnModuleInit {
  private readonly logger = new Logger(ApnsVoipService.name);
  private enabled = false;
  private keyId = '';
  private teamId = '';
  private bundleId = 'com.kallie.app';
  private privateKey = '';
  private isProduction = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const keyId = this.configService.get<string>('APNS_KEY_ID');
    const teamId = this.configService.get<string>('APNS_TEAM_ID');
    const bundleId = this.configService.get<string>('APNS_BUNDLE_ID') || 'com.kallie.app';
    const keyPath = this.configService.get<string>('APNS_PRIVATE_KEY_PATH');
    const isProduction = this.configService.get<string>('APNS_PRODUCTION') === 'true';

    if (!keyId || !teamId || !keyPath) {
      this.logger.warn(
        'iOS APNs VoIP push disabled (APNS_* env vars not configured). iOS lock-screen push will activate automatically once credentials are added.',
      );
      return;
    }

    const resolvedKeyPath = path.resolve(process.cwd(), keyPath);
    if (!fs.existsSync(resolvedKeyPath)) {
      this.logger.warn(
        `iOS APNs VoIP push disabled (key file not found at ${resolvedKeyPath}).`,
      );
      return;
    }

    this.keyId = keyId;
    this.teamId = teamId;
    this.bundleId = bundleId;
    this.privateKey = fs.readFileSync(resolvedKeyPath, 'utf8');
    this.isProduction = isProduction;
    this.enabled = true;
    this.logger.log(
      `iOS APNs VoIP push enabled (${this.isProduction ? 'production' : 'sandbox'}, topic: ${this.bundleId}.voip).`,
    );
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private createAuthJwt(): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'ES256', kid: this.keyId }),
    ).toString('base64url');
    const claims = Buffer.from(
      JSON.stringify({
        iss: this.teamId,
        iat: Math.floor(Date.now() / 1000),
      }),
    ).toString('base64url');
    const signingInput = `${header}.${claims}`;

    const sign = crypto.createSign('SHA256');
    sign.update(signingInput);
    sign.end();

    const signature = sign
      .sign({
        key: this.privateKey,
        dsaEncoding: 'ieee-p1363',
      })
      .toString('base64url');

    return `${signingInput}.${signature}`;
  }

  async sendVoipCall(voipToken: string, payload: IncomingCallPushPayload): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const authority = this.isProduction
      ? 'https://api.push.apple.com'
      : 'https://api.sandbox.push.apple.com';

    const body = JSON.stringify({
      aps: {
        'content-available': 1,
      },
      type: 'incoming_call',
      sessionId: payload.sessionId,
      roomName: payload.roomName,
      title: payload.title,
    });

    await new Promise<void>((resolve) => {
      const client = http2.connect(authority);
      client.on('error', (err) => {
        this.logger.error(`APNs HTTP/2 connection error: ${err.message}`);
        client.close();
        resolve();
      });

      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${voipToken}`,
        authorization: `bearer ${this.createAuthJwt()}`,
        'apns-topic': `${this.bundleId}.voip`,
        'apns-push-type': 'voip',
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 35),
        'content-type': 'application/json',
      });

      let statusCode = 0;
      let responseBody = '';

      req.on('response', (headers) => {
        statusCode = Number(headers[':status'] || 0);
      });
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        responseBody += chunk;
      });
      req.on('end', () => {
        if (statusCode >= 200 && statusCode < 300) {
          this.logger.log(`Sent iOS APNs VoIP push for session ${payload.sessionId}`);
        } else {
          this.logger.error(
            `APNs VoIP push failed (${statusCode}) for session ${payload.sessionId}: ${responseBody}`,
          );
        }
        client.close();
        resolve();
      });
      req.on('error', (err) => {
        this.logger.error(`APNs request error: ${err.message}`);
        client.close();
        resolve();
      });

      req.end(body);
    });
  }
}
