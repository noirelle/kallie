import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import {
  CONTROL_DATA_TOPIC,
  parseJobMetadata,
  resolveThinkingConfig,
  waitForStandbyActivation,
} from '../src/agentSession.js';
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

describe('resolveThinkingConfig', () => {
  it('defaults to MINIMAL thinkingLevel for gemini-3.1-flash-live-preview', () => {
    assert.deepEqual(resolveThinkingConfig('gemini-3.1-flash-live-preview', undefined), {
      thinkingLevel: 'MINIMAL',
    });
  });

  it('respects valid GEMINI_THINKING_LEVEL overrides and omits for non-3.1 models', () => {
    assert.deepEqual(resolveThinkingConfig('gemini-3.1-flash-live-preview', 'low'), {
      thinkingLevel: 'LOW',
    });
    assert.equal(resolveThinkingConfig('gemini-3.1-flash-live-preview', 'default'), undefined);
    assert.equal(resolveThinkingConfig('gemini-2.5-flash-native-audio-preview-12-2025', 'low'), undefined);
  });
});

describe('waitForStandbyActivation', () => {
  it('resolves activated when kallie.control start_call packet arrives', async () => {
    const room = Object.assign(new EventEmitter(), { isConnected: true });
    const waiter = waitForStandbyActivation(room, 15_000);

    room.emit(
      'dataReceived',
      Buffer.from(JSON.stringify({ type: 'start_call' }), 'utf8'),
      undefined,
      undefined,
      CONTROL_DATA_TOPIC,
    );

    assert.equal(await waiter, 'activated');
  });

  it('resolves disconnected when room closes before activation', async () => {
    const room = Object.assign(new EventEmitter(), { isConnected: true });
    const waiter = waitForStandbyActivation(room, 15_000);

    room.emit('disconnected');
    assert.equal(await waiter, 'disconnected');
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
