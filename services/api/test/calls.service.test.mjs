import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
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
});
