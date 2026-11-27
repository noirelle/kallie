import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
} from 'livekit-server-sdk';
import { verifyCallDeclineToken } from '../../common/security/callActionToken';
import { SupabaseAdminService } from '../../common/supabase/supabaseAdmin.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivateStandbyCallDto } from './dto/activateStandbyCall.dto';
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
  private readonly dispatchClient: AgentDispatchClient | null;
  private readonly roomClient: RoomServiceClient | null;
  private readonly inFlightInserts = new Map<string, Promise<void>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.livekitUrl = this.configService.get<string>('LIVEKIT_URL') || '';
    this.livekitHttpUrl = this.livekitUrl
      .replace(/^wss:\/\//, 'https://')
      .replace(/^ws:\/\//, 'http://');
    this.livekitApiKey = this.configService.get<string>('LIVEKIT_API_KEY') || '';
    this.livekitApiSecret = this.configService.get<string>('LIVEKIT_API_SECRET') || '';
    this.agentName =
      this.configService.get<string>('LIVEKIT_AGENT_NAME') || 'kallie-voice-agent';

    if (this.livekitHttpUrl && this.livekitApiKey && this.livekitApiSecret) {
      this.dispatchClient = new AgentDispatchClient(
        this.livekitHttpUrl,
        this.livekitApiKey,
        this.livekitApiSecret,
      );
      this.roomClient = new RoomServiceClient(
        this.livekitHttpUrl,
        this.livekitApiKey,
        this.livekitApiSecret,
      );
    } else {
      this.dispatchClient = null;
      this.roomClient = null;
    }
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
    standby = false,
  ) {
    const t0 = performance.now();
    const dispatchClient =
      this.dispatchClient ||
      new AgentDispatchClient(
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
        ...(standby ? { standby: true, standbyTimeoutMs: 45_000 } : {}),
        ...(voice ? { voice } : {}),
      }),
    });

    this.logger.log(
      `[CallsPerf] Dispatched agent "${this.agentName}" (standby=${standby}) to room ${session.room_name} (session ${session.id}) in ${Math.round(performance.now() - t0)}ms`,
    );
  }

  private persistCallSessionAsync(session: CallSessionRecord): void {
    const insertPromise = Promise.resolve(
      this.supabaseAdmin.client
        .from('call_sessions')
        .upsert(
          {
            id: session.id,
            user_id: session.user_id,
            room_name: session.room_name,
            title: session.title,
            ai_prompt: session.ai_prompt,
            status: session.status,
            started_at: session.started_at,
          },
          { onConflict: 'id' },
        ),
    )
      .then((res) => {
        if (res.error) {
          this.logger.error(
            `Background call_sessions persist failed for ${session.id}: ${res.error.message}`,
          );
        }
      })
      .catch((err) => {
        this.logger.error(
          `Background call_sessions persist threw for ${session.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        this.inFlightInserts.delete(session.id);
      });

    this.inFlightInserts.set(session.id, insertPromise);
  }

  async createImmediateTestCall(
    userId: string,
    userEmail: string | undefined,
    dto: CreateTestCallDto,
  ) {
    const t0 = performance.now();
    this.assertLiveKitConfigured();

    const isStandby = Boolean(dto.standby);
    const sessionId = crypto.randomUUID();
    const roomName = isStandby
      ? `kallie-standby-${crypto.randomUUID()}`
      : `kallie-${crypto.randomUUID()}`;
    const title = dto.title?.trim() || 'Call with Kallie';
    const aiPrompt =
      dto.aiPrompt?.trim() ||
      'Check in on how their day is going, ask if they have eaten or rested, and have a sweet, natural chat.';
    const startedAt = new Date().toISOString();

    const draftSession: CallSessionRecord = {
      id: sessionId,
      schedule_id: null,
      user_id: userId,
      room_name: roomName,
      title,
      ai_prompt: aiPrompt,
      status: 'accepted',
      started_at: startedAt,
      ended_at: null,
    };

    // Standby sessions skip DB persistence until the user actually taps Aura
    // (via activateStandbyCall) so idle home-screen visits never pollute call_sessions.
    if (!isStandby) {
      this.persistCallSessionAsync(draftSession);
    }

    void this.dispatchKallieAgent(draftSession, dto.voice, true, isStandby).catch((err) => {
      this.logger.error(
        `Background agent dispatch failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    const token = await this.mintUserToken(roomName, userId, userEmail);

    this.logger.log(
      `[CallsPerf] createImmediateTestCall(standby=${isStandby}) returned token for ${sessionId} in ${Math.round(performance.now() - t0)}ms`,
    );

    return {
      session: draftSession,
      livekitUrl: this.livekitUrl,
      roomName: draftSession.room_name,
      token,
      standby: isStandby,
    };
  }

  async activateStandbyCall(userId: string, dto: ActivateStandbyCallDto) {
    const title = dto.title?.trim() || 'Call with Kallie';
    const aiPrompt =
      dto.aiPrompt?.trim() ||
      'Check in on how their day is going, ask if they have eaten or rested, and have a sweet, natural chat.';
    const startedAt = new Date().toISOString();

    const sessionRecord: CallSessionRecord = {
      id: dto.sessionId,
      schedule_id: null,
      user_id: userId,
      room_name: dto.roomName,
      title,
      ai_prompt: aiPrompt,
      status: 'accepted',
      started_at: startedAt,
      ended_at: null,
    };

    this.persistCallSessionAsync(sessionRecord);
    return { ok: true, sessionId: dto.sessionId };
  }

  async acceptCall(sessionId: string, userId: string, userEmail?: string) {
    const t0 = performance.now();
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

    const startedAt = session.started_at || new Date().toISOString();
    const updatedAt = new Date().toISOString();
    const updatedSession: CallSessionRecord = {
      ...session,
      status: 'accepted',
      started_at: startedAt,
    };

    // Start agent dispatch immediately in parallel with DB update & token minting,
    // without blocking the client's LiveKit token response on LiveKit Twirp latency.
    void this.dispatchKallieAgent(updatedSession).catch((err) => {
      this.logger.error(
        `Background agent dispatch failed on acceptCall ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    const [updateResult, token] = await Promise.all([
      this.supabaseAdmin.client
        .from('call_sessions')
        .update({
          status: 'accepted',
          started_at: startedAt,
          updated_at: updatedAt,
        })
        .eq('id', sessionId)
        .eq('user_id', userId)
        .select()
        .single<CallSessionRecord>(),
      this.mintUserToken(session.room_name, userId, userEmail),
    ]);

    if (updateResult.error || !updateResult.data) {
      throw new InternalServerErrorException(
        `Failed to update call session: ${updateResult.error?.message}`,
      );
    }

    const updated = updateResult.data;

    void this.notificationsService
      ?.notifyCallEnded(userId, { sessionId: updated.id, reason: 'ended' })
      .catch(() => {});

    this.logger.log(
      `[CallsPerf] acceptCall returned token for ${sessionId} in ${Math.round(performance.now() - t0)}ms`,
    );

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

    void this.notificationsService
      ?.notifyCallEnded(userId, { sessionId, reason: 'declined' })
      .catch(() => {});

    return { ok: true, session: data };
  }

  async declineCallWithToken(sessionId: string, declineToken: string) {
    const { data: session, error } = await this.supabaseAdmin.client
      .from('call_sessions')
      .select('id, user_id, status')
      .eq('id', sessionId)
      .maybeSingle<{ id: string; user_id: string; status: string }>();

    if (error || !session) {
      throw new NotFoundException('Call session not found');
    }

    const signingSecret =
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.livekitApiSecret;

    if (!verifyCallDeclineToken(signingSecret, session.id, session.user_id, declineToken)) {
      throw new UnauthorizedException('Invalid or expired call decline token');
    }

    return this.declineCall(session.id, session.user_id);
  }

  async endCall(sessionId: string, userId: string) {
    const pendingInsert = this.inFlightInserts.get(sessionId);
    if (pendingInsert) {
      await pendingInsert.catch(() => {});
    }

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
      const roomClient =
        this.roomClient ||
        new RoomServiceClient(
          this.livekitHttpUrl,
          this.livekitApiKey,
          this.livekitApiSecret,
        );
      await roomClient.deleteRoom(session.room_name).catch((err) => {
        this.logger.debug(`LiveKit room cleanup skipped for ${session.room_name}: ${err}`);
      });
    }

    void this.notificationsService
      ?.notifyCallEnded(userId, { sessionId, reason: 'ended' })
      .catch(() => {});

    return { ok: true, session };
  }
}
