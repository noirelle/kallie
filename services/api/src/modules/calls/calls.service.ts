import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
} from 'livekit-server-sdk';
import { SupabaseAdminService } from '../../common/supabase/supabaseAdmin.service';
import { CreateTestCallDto } from './dto/createTestCall.dto';

export interface CallSessionRecord {
  id: string;
  schedule_id: string | null;
  user_id: string;
  room_name: string;
  title: string;
  ai_prompt: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
}

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);
  private readonly livekitUrl: string;
  private readonly livekitHttpUrl: string;
  private readonly livekitApiKey: string;
  private readonly livekitApiSecret: string;
  private readonly agentName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {
    this.livekitUrl = this.configService.get<string>('LIVEKIT_URL') || '';
    this.livekitHttpUrl = this.livekitUrl
      .replace(/^wss:\/\//, 'https://')
      .replace(/^ws:\/\//, 'http://');
    this.livekitApiKey = this.configService.get<string>('LIVEKIT_API_KEY') || '';
    this.livekitApiSecret = this.configService.get<string>('LIVEKIT_API_SECRET') || '';
    this.agentName =
      this.configService.get<string>('LIVEKIT_AGENT_NAME') || 'kallie-voice-agent';
  }

  private assertLiveKitConfigured() {
    if (!this.livekitUrl || !this.livekitApiKey || !this.livekitApiSecret) {
      throw new InternalServerErrorException(
        'LiveKit credentials are missing in services/api/.env (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).',
      );
    }
  }

  private async mintUserToken(roomName: string, userId: string, userEmail?: string) {
    const token = new AccessToken(this.livekitApiKey, this.livekitApiSecret, {
      identity: `user-${userId}`,
      name: userEmail || 'Kallie User',
      ttl: '1h',
    });

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return token.toJwt();
  }

  private async dispatchKallieAgent(
    session: CallSessionRecord,
    voice?: string,
    skipExistingCheck = false,
  ) {
    const dispatchClient = new AgentDispatchClient(
      this.livekitHttpUrl,
      this.livekitApiKey,
      this.livekitApiSecret,
    );

    if (!skipExistingCheck) {
      const existing = await dispatchClient.listDispatch(session.room_name).catch(() => []);
      if (existing.some((d) => d.agentName === this.agentName)) {
        return;
      }
    }

    await dispatchClient.createDispatch(session.room_name, this.agentName, {
      metadata: JSON.stringify({
        sessionId: session.id,
        userId: session.user_id,
        title: session.title,
        aiPrompt: session.ai_prompt,
        isScheduledCallback: Boolean(session.schedule_id),
        ...(voice ? { voice } : {}),
      }),
    });

    this.logger.log(
      `Dispatched agent "${this.agentName}" to room ${session.room_name} (session ${session.id})`,
    );
  }

  async createImmediateTestCall(
    userId: string,
    userEmail: string | undefined,
    dto: CreateTestCallDto,
  ) {
    this.assertLiveKitConfigured();

    const roomName = `kallie-${crypto.randomUUID()}`;
    const title = dto.title?.trim() || 'Call with Kallie';
    const aiPrompt =
      dto.aiPrompt?.trim() ||
      'Check in on how their day is going, ask if they have eaten or rested, and have a sweet, natural chat.';

    const { data: session, error } = await this.supabaseAdmin.client
      .from('call_sessions')
      .insert({
        user_id: userId,
        room_name: roomName,
        title,
        ai_prompt: aiPrompt,
        status: 'accepted',
        started_at: new Date().toISOString(),
      })
      .select()
      .single<CallSessionRecord>();

    if (error || !session) {
      throw new InternalServerErrorException(
        `Failed to create test call session: ${error?.message}`,
      );
    }

    const [, token] = await Promise.all([
      this.dispatchKallieAgent(session, dto.voice, true),
      this.mintUserToken(session.room_name, userId, userEmail),
    ]);

    return {
      session,
      livekitUrl: this.livekitUrl,
      roomName: session.room_name,
      token,
    };
  }

  async acceptCall(sessionId: string, userId: string, userEmail?: string) {
    this.assertLiveKitConfigured();

    const { data: session, error } = await this.supabaseAdmin.client
      .from('call_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .single<CallSessionRecord>();

    if (error || !session) {
      throw new NotFoundException('Call session not found');
    }

    if (!['ringing', 'accepted', 'in_progress'].includes(session.status)) {
      throw new BadRequestException(
        `Cannot accept call session in "${session.status}" status`,
      );
    }

    const { data: updated, error: updateError } = await this.supabaseAdmin.client
      .from('call_sessions')
      .update({
        status: 'accepted',
        started_at: session.started_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('user_id', userId)
      .select()
      .single<CallSessionRecord>();

    if (updateError || !updated) {
      throw new InternalServerErrorException(
        `Failed to update call session: ${updateError?.message}`,
      );
    }

    const [, token] = await Promise.all([
      this.dispatchKallieAgent(updated),
      this.mintUserToken(updated.room_name, userId, userEmail),
    ]);

    return {
      session: updated,
      livekitUrl: this.livekitUrl,
      roomName: updated.room_name,
      token,
    };
  }

  async declineCall(sessionId: string, userId: string) {
    const { data, error } = await this.supabaseAdmin.client
      .from('call_sessions')
      .update({
        status: 'declined',
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('user_id', userId)
      .eq('status', 'ringing')
      .select()
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Failed to decline call session: ${error.message}`,
      );
    }

    return { ok: true, session: data };
  }

  async endCall(sessionId: string, userId: string) {
    const { data: session, error } = await this.supabaseAdmin.client
      .from('call_sessions')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('user_id', userId)
      .select()
      .maybeSingle<CallSessionRecord>();

    if (error) {
      throw new InternalServerErrorException(
        `Failed to end call session: ${error.message}`,
      );
    }

    if (session && this.livekitHttpUrl && this.livekitApiKey && this.livekitApiSecret) {
      const roomClient = new RoomServiceClient(
        this.livekitHttpUrl,
        this.livekitApiKey,
        this.livekitApiSecret,
      );
      await roomClient.deleteRoom(session.room_name).catch((err) => {
        this.logger.debug(`LiveKit room cleanup skipped for ${session.room_name}: ${err}`);
      });
    }

    return { ok: true, session };
  }
}
