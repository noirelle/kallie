import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  SupabaseAuthGuard,
} from '../../common/guards/supabaseAuth.guard';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/registerDevice.dto';

@Controller('devices')
@UseGuards(SupabaseAuthGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post('register')
  register(@Req() req: AuthenticatedRequest, @Body() dto: RegisterDeviceDto) {
    return this.devicesService.registerDevice(req.user.id, dto);
  }
}
