import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  SupabaseAuthGuard,
} from '../../common/guards/supabaseAuth.guard';
import { CallsService } from './calls.service';
import { CreateTestCallDto } from './dto/createTestCall.dto';

@Controller('calls')
@UseGuards(SupabaseAuthGuard)
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Post('test')
  createTestCall(@Req() req: AuthenticatedRequest, @Body() dto: CreateTestCallDto) {
    return this.callsService.createImmediateTestCall(req.user.id, req.user.email, dto);
  }

  @Post(':id/accept')
  acceptCall(@Req() req: AuthenticatedRequest, @Param('id') sessionId: string) {
    return this.callsService.acceptCall(sessionId, req.user.id, req.user.email);
  }

  @Post(':id/decline')
  declineCall(@Req() req: AuthenticatedRequest, @Param('id') sessionId: string) {
    return this.callsService.declineCall(sessionId, req.user.id);
  }

  @Post(':id/end')
  endCall(@Req() req: AuthenticatedRequest, @Param('id') sessionId: string) {
    return this.callsService.endCall(sessionId, req.user.id);
  }
}
