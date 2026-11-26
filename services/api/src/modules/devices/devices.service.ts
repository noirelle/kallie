import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseAdminService } from '../../common/supabase/supabaseAdmin.service';
import { RegisterDeviceDto } from './dto/registerDevice.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly supabaseAdmin: SupabaseAdminService) {}

  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    const { data, error } = await this.supabaseAdmin.client
      .from('device_tokens')
      .upsert(
        {
          user_id: userId,
          platform: dto.platform,
          voip_token: dto.voipToken ?? null,
          fcm_token: dto.fcmToken ?? null,
          device_name: dto.deviceName ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,platform' },
      )
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(
        `Failed to register device token: ${error.message}`,
      );
    }

    return data;
  }
}
