import { Controller, Get } from '@nestjs/common';
import { ApnsVoipService } from '../notifications/apnsVoip.service';
import { FcmPushService } from '../notifications/fcmPush.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly fcmPush: FcmPushService,
    private readonly apnsVoip: ApnsVoipService,
  ) {}

  @Get()
  check() {
    return {
      status: 'ok',
      service: 'kallie-api',
      push: {
        androidFcmEnabled: this.fcmPush.isEnabled(),
        iosApnsEnabled: this.apnsVoip.isEnabled(),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
