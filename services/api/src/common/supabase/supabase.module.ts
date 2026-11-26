import { Global, Module } from '@nestjs/common';
import { SupabaseAdminService } from './supabaseAdmin.service';

@Global()
@Module({
  providers: [SupabaseAdminService],
  exports: [SupabaseAdminService],
})
export class SupabaseModule {}
