import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseJobMetadata } from '../src/agentSession.js';
import { createKallieScheduleTools } from '../src/scheduleTools.js';

describe('parseJobMetadata', () => {
  it('parses valid JSON metadata cleanly', () => {
    const parsed = parseJobMetadata(
      JSON.stringify({
        sessionId: 'sess-1',
        userId: 'user-1',
        title: 'Morning Call',
        isScheduledCallback: true,
      }),
    );

    assert.equal(parsed.sessionId, 'sess-1');
    assert.equal(parsed.userId, 'user-1');
    assert.equal(parsed.isScheduledCallback, true);
  });

  it('returns empty object on invalid or missing metadata', () => {
    assert.deepEqual(parseJobMetadata(undefined), {});
    assert.deepEqual(parseJobMetadata('{invalid-json'), {});
  });
});

describe('createKallieScheduleTools', () => {
  it('exposes all 4 voice tools including end_call', () => {
    const tools = createKallieScheduleTools('user-1');
    const names = tools.map((t) => t.name);

    assert.deepEqual(names, [
      'schedule_callback',
      'list_scheduled_calls',
      'cancel_scheduled_call',
      'end_call',
    ]);
  });

  it('invokes onRequestEndCall callback when end_call tool executes', async () => {
    let endCalled = false;
    const tools = createKallieScheduleTools('user-1', () => {
      endCalled = true;
    });
    const endCallTool = tools.find((t) => t.name === 'end_call');
    assert.ok(endCallTool);

    const result = (await endCallTool.execute(
      { reason: 'user said goodbye' },
      {} as never,
    )) as { ok: boolean };

    assert.equal(result.ok, true);
    assert.equal(endCalled, true);
  });

  it('returns graceful error when schedule_callback runs without userId', async () => {
    const tools = createKallieScheduleTools(undefined);
    const scheduleTool = tools.find((t) => t.name === 'schedule_callback');
    assert.ok(scheduleTool);

    const result = (await scheduleTool.execute(
      { title: 'Water', reminderNote: 'Drink water', delayMinutes: 2 },
      {} as never,
    )) as { ok: boolean; error?: string };

    assert.equal(result.ok, false);
    assert.ok(result.error);
  });
});
