import { ActivityHandling, EndSensitivity, StartSensitivity } from '@google/genai';
import { AudioFrame } from '@livekit/rtc-node';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import {
  CONTROL_DATA_TOPIC,
  parseJobMetadata,
  resolveContextWindowCompression,
  resolveRealtimeInputConfig,
  resolveThinkingConfig,
  waitForStandbyActivation,
} from '../src/agentSession.js';
import { createKallieScheduleTools } from '../src/scheduleTools.js';
import { computeFrameRms, SileroSpeechGateProcessor } from '../src/speechGate.js';

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

describe('resolveRealtimeInputConfig & resolveContextWindowCompression', () => {
  it('configures low start sensitivity, high end sensitivity, and bounded silence duration', () => {
    const defaults = resolveRealtimeInputConfig(undefined);
    assert.equal(defaults.activityHandling, ActivityHandling.START_OF_ACTIVITY_INTERRUPTS);
    assert.equal(
      defaults.automaticActivityDetection?.startOfSpeechSensitivity,
      StartSensitivity.START_SENSITIVITY_LOW,
    );
    assert.equal(
      defaults.automaticActivityDetection?.endOfSpeechSensitivity,
      EndSensitivity.END_SENSITIVITY_HIGH,
    );
    assert.equal(defaults.automaticActivityDetection?.silenceDurationMs, 320);

    assert.equal(
      resolveRealtimeInputConfig('100').automaticActivityDetection?.silenceDurationMs,
      220,
    );
    assert.equal(
      resolveRealtimeInputConfig('1500').automaticActivityDetection?.silenceDurationMs,
      800,
    );
  });

  it('configures sliding-window context compression with a wide 6k-token stride', () => {
    const compression = resolveContextWindowCompression();
    assert.equal(compression.triggerTokens, '12000');
    assert.equal(compression.slidingWindow?.targetTokens, '6000');
  });
});

describe('SileroSpeechGateProcessor', () => {
  it('zeroes steady low-amplitude ambient noise while passing high-energy speech immediately', () => {
    const gate = new SileroSpeechGateProcessor({
      hangoverMs: 40,
      vadOverride: {
        predict: async () => 0.05,
        reset: () => {},
      },
    });

    // Steady -42dBFS room floor (~120 amp) -> gated to digital zeros
    const noiseSamples = new Int16Array(320).fill(120);
    const noiseFrame = new AudioFrame(noiseSamples, 16_000, 1, 320);
    const gatedNoise = gate.process(noiseFrame);
    assert.equal(computeFrameRms(gatedNoise.data), 0);

    // Sudden loud speech onset (3000 amp) -> passes through at 0ms attack latency
    const speechSamples = new Int16Array(320).fill(3000);
    const speechFrame = new AudioFrame(speechSamples, 16_000, 1, 320);
    const passedSpeech = gate.process(speechFrame);
    assert.equal(computeFrameRms(passedSpeech.data), 3000);

    gate.close();
  });

  it('passes audio untouched when disabled or non-16kHz', () => {
    const gate = new SileroSpeechGateProcessor({ vadOverride: null });
    gate.setEnabled(false);

    const noiseSamples = new Int16Array(320).fill(120);
    const frame = new AudioFrame(noiseSamples, 16_000, 1, 320);
    assert.equal(computeFrameRms(gate.process(frame).data), 120);
    gate.close();
  });
});
