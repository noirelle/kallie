import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HealthController } from '../dist/modules/health/health.controller.js';

describe('HealthController', () => {
  it('returns status ok and current push feature flags', () => {
    const mockFcm = { isEnabled: () => true };
    const mockApns = { isEnabled: () => false };
    const controller = new HealthController(mockFcm, mockApns);

    const result = controller.check();
    assert.equal(result.status, 'ok');
    assert.equal(result.service, 'kallie-api');
    assert.equal(result.push.androidFcmEnabled, true);
    assert.equal(result.push.iosApnsEnabled, false);
    assert.ok(result.timestamp);
  });
});
