import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseAuthGuard } from '../dist/common/guards/supabaseAuth.guard.js';
import { CallsService } from '../dist/modules/calls/calls.service.js';

function createConfig(values) {
  return {
    get: (key) => values[key],
  };
}

describe('CallsService', () => {
  it('throws InternalServerErrorException when LiveKit env vars are missing', async () => {
    const config = createConfig({});
    const supabase = { client: {} };
    const service = new CallsService(config, supabase);

    await assert.rejects(
      () => service.createImmediateTestCall('user-1', 'user@test.com', {}),
      InternalServerErrorException,
    );
  });

  it('throws NotFoundException when accepting a non-existent session', async () => {
    const config = createConfig({
      LIVEKIT_URL: 'wss://example.livekit.cloud',
      LIVEKIT_API_KEY: 'key',
      LIVEKIT_API_SECRET: 'secret',
    });

    const supabase = {
      client: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: null, error: { message: 'not found' } }),
              }),
            }),
          }),
        }),
      },
    };

    const service = new CallsService(config, supabase);
    await assert.rejects(
      () => service.acceptCall('missing-id', 'user-1'),
      NotFoundException,
    );
  });

  it('rejects accepting a call that is already completed or missed', async () => {
    const config = createConfig({
      LIVEKIT_URL: 'wss://example.livekit.cloud',
      LIVEKIT_API_KEY: 'key',
      LIVEKIT_API_SECRET: 'secret',
    });

    const supabase = {
      client: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'sess-1',
                    user_id: 'user-1',
                    room_name: 'kallie-room-1',
                    title: 'Reminder',
                    ai_prompt: 'Drink water',
                    status: 'missed',
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      },
    };

    const service = new CallsService(config, supabase);
    await assert.rejects(
      () => service.acceptCall('sess-1', 'user-1'),
      BadRequestException,
    );
  });

  it('marks ringing session as declined on declineCall', async () => {
    const config = createConfig({});
    let updatedPayload = null;

    const supabase = {
      client: {
        from: () => ({
          update: (payload) => {
            updatedPayload = payload;
            return {
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      maybeSingle: async () => ({
                        data: { id: 'sess-1', status: 'declined' },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            };
          },
        }),
      },
    };

    const service = new CallsService(config, supabase);
    const res = await service.declineCall('sess-1', 'user-1');

    assert.equal(res.ok, true);
    assert.equal(updatedPayload.status, 'declined');
    assert.ok(updatedPayload.ended_at);
  });

  it('returns LiveKit token immediately without blocking on DB insert or agent dispatch', async () => {
    const config = createConfig({
      LIVEKIT_URL: 'wss://example.livekit.cloud',
      LIVEKIT_API_KEY: 'api-key',
      LIVEKIT_API_SECRET: 'api-secret-value-at-least-32-chars-long',
    });

    let resolveInsert;
    const insertGate = new Promise((res) => {
      resolveInsert = res;
    });
    let dispatchStarted = false;

    const supabase = {
      client: {
        from: () => ({
          upsert: () => insertGate.then(() => ({ error: null })),
        }),
      },
    };

    const service = new CallsService(config, supabase);
    service.dispatchKallieAgent = async () => {
      dispatchStarted = true;
      await insertGate;
    };

    const res = await service.createImmediateTestCall('user-1', 'user@test.com', {
      title: 'Quick Call',
    });

    assert.equal(res.livekitUrl, 'wss://example.livekit.cloud');
    assert.ok(res.token);
    assert.equal(res.session.title, 'Quick Call');
    assert.equal(res.session.status, 'accepted');
    assert.equal(res.standby, false);
    assert.equal(dispatchStarted, true);

    resolveInsert();
    await Promise.resolve();
  });

  it('skips DB insert for standby pre-staging and persists only upon activateStandbyCall', async () => {
    const config = createConfig({
      LIVEKIT_URL: 'wss://example.livekit.cloud',
      LIVEKIT_API_KEY: 'api-key',
      LIVEKIT_API_SECRET: 'api-secret-value-at-least-32-chars-long',
    });

    let upsertCount = 0;
    let dispatchedStandbyFlag = false;

    const supabase = {
      client: {
        from: () => ({
          upsert: async () => {
            upsertCount += 1;
            return { error: null };
          },
        }),
      },
    };

    const service = new CallsService(config, supabase);
    service.dispatchKallieAgent = async (_session, _voice, _skip, standby) => {
      dispatchedStandbyFlag = Boolean(standby);
    };

    const staged = await service.createImmediateTestCall('user-1', 'user@test.com', {
      title: 'Standby Call',
      standby: true,
    });

    assert.equal(staged.standby, true);
    assert.ok(staged.roomName.startsWith('kallie-standby-'));
    assert.equal(dispatchedStandbyFlag, true);
    assert.equal(upsertCount, 0);

    const activated = await service.activateStandbyCall('user-1', {
      sessionId: staged.session.id,
      roomName: staged.roomName,
      title: staged.session.title,
    });
    assert.equal(activated.ok, true);
    assert.equal(upsertCount, 1);
  });
});

describe('SupabaseAuthGuard local JWKS verification', () => {
  it('verifies a valid ES256 Supabase JWT locally without calling auth.getUser', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    const publicJwk = {
      ...publicKey.export({ format: 'jwk' }),
      kid: 'test-kid-1',
      alg: 'ES256',
      use: 'sig',
    };

    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'test-kid-1', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'user-123',
        email: 'kallie@example.com',
        iss: 'https://proj.supabase.co/auth/v1',
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    ).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const sig = crypto
      .sign('sha256', Buffer.from(signingInput, 'utf8'), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      })
      .toString('base64url');
    const token = `${signingInput}.${sig}`;

    let remoteGetUserCalled = false;
    const supabaseAdmin = {
      supabaseUrl: 'https://proj.supabase.co',
      client: {
        auth: {
          getUser: async () => {
            remoteGetUserCalled = true;
            return { data: { user: null }, error: new Error('should not be called') };
          },
        },
      },
    };

    const guard = new SupabaseAuthGuard(supabaseAdmin);
    guard.jwksCache.set('test-kid-1', crypto.createPublicKey({ key: publicJwk, format: 'jwk' }));
    guard.jwksFetchedAt = Date.now();

    const result = await guard.verifyTokenLocally(token);
    assert.deepEqual(result, { id: 'user-123', email: 'kallie@example.com' });
    assert.equal(remoteGetUserCalled, false);
  });

  it('rejects an expired JWT locally', async () => {
    const supabaseAdmin = { supabaseUrl: 'https://proj.supabase.co', client: { auth: {} } };
    const guard = new SupabaseAuthGuard(supabaseAdmin);

    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'k1' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'user-123',
        iss: 'https://proj.supabase.co/auth/v1',
        exp: Math.floor(Date.now() / 1000) - 120,
      }),
    ).toString('base64url');
    const token = `${header}.${payload}.invalid`;

    const result = await guard.verifyTokenLocally(token);
    assert.equal(result, 'invalid');
  });
});
