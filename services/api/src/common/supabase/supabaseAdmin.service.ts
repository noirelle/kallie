import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseAdminService {
  private readonly logger = new Logger(SupabaseAdminService.name);
  public readonly client: SupabaseClient;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>('SUPABASE_URL');
    const serviceRoleKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!url || !serviceRoleKey) {
      this.logger.warn(
        'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing. Database calls will fail until configured in services/api/.env.',
      );
    }

    this.client = createClient(
      url || 'https://placeholder.supabase.co',
      serviceRoleKey || 'placeholder-service-role-key',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }
}
