import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  SupabaseAuthGuard,
} from '../../common/guards/supabaseAuth.guard';
import { CallsService } from './calls.service';
import { CreateTestCallDto } from './dto/createTestCall.dto';
import { DeclinePushDto } from './dto/declinePush.dto';

@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @UseGuards(SupabaseAuthGuard)
  @Post('test')
  createTestCall(@Req() req: AuthenticatedRequest, @Body() dto: CreateTestCallDto) {
    return this.callsService.createImmediateTestCall(req.user.id, req.user.email, dto);
  }

  @UseGuards(SupabaseAuthGuard)
  @Post(':id/accept')
  acceptCall(@Req() req: AuthenticatedRequest, @Param('id') sessionId: string) {
    return this.callsService.acceptCall(sessionId, req.user.id, req.user.email);
  }

  @UseGuards(SupabaseAuthGuard)
  @Post(':id/decline')
  declineCall(@Req() req: AuthenticatedRequest, @Param('id') sessionId: string) {
    return this.callsService.declineCall(sessionId, req.user.id);
  }

  /**
   * Background notification decline endpoint authenticated by a short-lived
   * HMAC-SHA256 decline token delivered inside the incoming call push payload.
   * Allows Android BroadcastReceiver (goAsync) to mark calls declined immediately
   * without opening the app or refreshing an expired Supabase JWT.
   */
  @Post(':id/decline-push')
  declineCallFromPush(@Param('id') sessionId: string, @Body() dto: DeclinePushDto) {
    return this.callsService.declineCallWithToken(sessionId, dto.declineToken);
  }

  @UseGuards(SupabaseAuthGuard)
  @Post(':id/end')
  endCall(@Req() req: AuthenticatedRequest, @Param('id') sessionId: string) {
    return this.callsService.endCall(sessionId, req.user.id);
  }
}
