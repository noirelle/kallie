import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SchedulerService } from '../dist/modules/scheduler/scheduler.service.js';

describe('SchedulerService', () => {
  it('creates ringing call sessions and triggers push notifications for claimed schedules', async () => {
    const insertedSessions = [];
    const notified = [];
    let expiredUpdated = false;

    const supabaseAdmin = {
      client: {
        rpc: async (name) => {
          if (name === 'claim_due_reminders') {
            return { data: [], error: null };
          }
          assert.equal(name, 'claim_due_schedules');
          return {
            data: [
              {
                id: 'sched-1',
                user_id: 'user-1',
                title: 'Drink Water',
                ai_prompt: 'Remind user to drink water.',
              },
            ],
            error: null,
          };
        },
        from: (table) => {
          assert.equal(table, 'call_sessions');
          return {
            insert: (row) => {
              insertedSessions.push(row);
              return {
                select: () => ({
                  single: async () => ({
                    data: {
                      id: 'sess-99',
                      room_name: row.room_name,
                      title: row.title,
                    },
                    error: null,
                  }),
                }),
              };
            },
            update: (payload) => {
              if (payload.status === 'missed') {
                expiredUpdated = true;
              }
              return {
                eq: () => ({
                  lt: () => ({
                    select: async () => ({ data: [], error: null }),
                  }),
                }),
              };
            },
          };
        },
      },
    };

    const notificationsService = {
      notifyIncomingCall: async (userId, payload) => {
        notified.push({ userId, payload });
      },
      notifyCallEnded: async () => {},
      notifyCallReminder: async () => {},
    };

    const scheduler = new SchedulerService(supabaseAdmin, notificationsService);
    await scheduler.processDueSchedules();

    assert.equal(insertedSessions.length, 1);
    assert.equal(insertedSessions[0].status, 'ringing');
    assert.equal(insertedSessions[0].schedule_id, 'sched-1');
    assert.equal(notified.length, 1);
    assert.equal(notified[0].userId, 'user-1');
    assert.equal(notified[0].payload.sessionId, 'sess-99');
    assert.equal(expiredUpdated, true);
  });

  it('skips redundant unanswered-call UPDATE sweeps during consecutive idle cycles', async () => {
    let expirySweeps = 0;

    const supabaseAdmin = {
      client: {
        rpc: async () => ({ data: [], error: null }),
        from: () => ({
          update: () => {
            expirySweeps += 1;
            return {
              eq: () => ({
                lt: () => ({
                  select: async () => ({ data: [], error: null }),
                }),
              }),
            };
          },
        }),
      },
    };

    const notificationsService = {
      notifyIncomingCall: async () => {},
      notifyCallEnded: async () => {},
      notifyCallReminder: async () => {},
    };

    const scheduler = new SchedulerService(supabaseAdmin, notificationsService);
    await scheduler.processDueSchedules();
    await scheduler.processDueSchedules();
    await scheduler.processDueSchedules();

    // First cycle sweeps once; subsequent idle cycles within 60s skip the UPDATE scan
    assert.equal(expirySweeps, 1);
  });
});
