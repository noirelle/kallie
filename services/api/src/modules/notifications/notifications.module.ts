import { Module } from '@nestjs/common';
import { ApnsVoipService } from './apnsVoip.service';
import { FcmPushService } from './fcmPush.service';
import { NotificationsService } from './notifications.service';

@Module({
  providers: [FcmPushService, ApnsVoipService, NotificationsService],
  exports: [NotificationsService, FcmPushService, ApnsVoipService],
})
export class NotificationsModule {}
