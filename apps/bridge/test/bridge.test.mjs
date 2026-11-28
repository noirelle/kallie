import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  buildPairingUri,
  createBridgeServer,
  verifyBearerToken,
} from '../dist/server.js';

describe('Kallie Desktop Bridge', () => {
  it('generates valid kallie://pair deep link and validates constant-time bearer tokens', () => {
    const uri = buildPairingUri({
      baseUrl: 'http://192.168.1.50:4789',
      token: 'a'.repeat(64),
      deviceName: 'Workstation',
    });
    assert.ok(uri.startsWith('kallie://pair?'));
    const parsed = new URL(uri);
    assert.equal(parsed.searchParams.get('url'), 'http://192.168.1.50:4789/v1');
    assert.equal(parsed.searchParams.get('token'), 'a'.repeat(64));
    assert.equal(parsed.searchParams.get('name'), 'Workstation');

    assert.equal(verifyBearerToken(`Bearer ${'a'.repeat(64)}`, 'a'.repeat(64)), true);
    assert.equal(verifyBearerToken(`Bearer ${'b'.repeat(64)}`, 'a'.repeat(64)), false);
    assert.equal(verifyBearerToken(undefined, 'a'.repeat(64)), false);
  });

  it('serves /health publicly and protects /v1/engines and /v1/models with bearer token', async () => {
    const tmpCfg = path.join(os.tmpdir(), `kallie-bridge-test-${Date.now()}.json`);
    const bridge = await createBridgeServer({ port: 0, configPath: tmpCfg });

    await new Promise((resolve) => bridge.server.listen(0, '127.0.0.1', resolve));
    const addr = bridge.server.address();
    const base = `http://127.0.0.1:${addr.port}`;

    try {
      const healthRes = await fetch(`${base}/health`);
      assert.equal(healthRes.status, 200);
      const health = await healthRes.json();
      assert.equal(health.ok, true);
      assert.equal(health.service, 'kallie-desktop-bridge');

      const unauth = await fetch(`${base}/v1/models`);
      assert.equal(unauth.status, 401);

      const authModels = await fetch(`${base}/v1/models`, {
        headers: { Authorization: `Bearer ${bridge.config.token}` },
      });
      assert.equal(authModels.status, 200);
      const modelsJson = await authModels.json();
      assert.equal(modelsJson.object, 'list');
      assert.ok(Array.isArray(modelsJson.data));

      const authEngines = await fetch(`${base}/v1/engines`, {
        headers: { Authorization: `Bearer ${bridge.config.token}` },
      });
      assert.equal(authEngines.status, 200);
      const enginesJson = await authEngines.json();
      assert.ok(Array.isArray(enginesJson.engines));
      assert.ok(enginesJson.engines.some((e) => e.id === 'agy'));
      assert.ok(enginesJson.engines.some((e) => e.id === 'claude'));
      assert.ok(enginesJson.engines.some((e) => e.id === 'codex'));
      assert.ok(enginesJson.engines.some((e) => e.id === 'gemini'));
    } finally {
      bridge.server.close();
      fs.rmSync(tmpCfg, { force: true });
    }
  });
});
