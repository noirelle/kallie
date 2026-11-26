import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

function readRootFile(relPath) {
  const fullPath = path.join(ROOT_DIR, relPath);
  assert.ok(fs.existsSync(fullPath), `Expected required file to exist: ${relPath}`);
  return fs.readFileSync(fullPath, 'utf8');
}

describe('Infra Preflight Checks', () => {
  it('contains all required Docker, Caddy, and deploy files', () => {
    const requiredFiles = [
      'docker-compose.yml',
      '.dockerignore',
      '.gitignore',
      'services/api/Dockerfile',
      'services/agent/Dockerfile',
      'apps/web/Dockerfile',
      'infra/caddy/Caddyfile',
      'infra/.env.prod.example',
      'infra/deploy-ec2.sh',
      'infra/test/smoke-deploy.sh',
    ];

    for (const file of requiredFiles) {
      assert.ok(
        fs.existsSync(path.join(ROOT_DIR, file)),
        `Missing required infra file: ${file}`,
      );
    }
  });

  it('configures all 4 services and HTTPS ports in docker-compose.yml', () => {
    const compose = readRootFile('docker-compose.yml');

    for (const service of ['api:', 'agent:', 'web:', 'caddy:']) {
      assert.ok(compose.includes(service), `docker-compose.yml missing service ${service}`);
    }

    assert.ok(compose.includes('restart: unless-stopped'), 'Services must set restart policy');
    assert.ok(compose.includes('"80:80"'), 'Caddy must expose HTTP port 80');
    assert.ok(compose.includes('"443:443"'), 'Caddy must expose HTTPS port 443');
    assert.ok(compose.includes('condition: service_healthy'), 'Dependent services must wait for api health');
  });

  it('routes API_DOMAIN and WEB_DOMAIN cleanly in Caddyfile', () => {
    const caddyfile = readRootFile('infra/caddy/Caddyfile');

    assert.ok(caddyfile.includes('{$API_DOMAIN}'), 'Caddyfile missing {$API_DOMAIN}');
    assert.ok(caddyfile.includes('reverse_proxy api:3001'), 'Caddyfile must proxy API to api:3001');
    assert.ok(caddyfile.includes('{$WEB_DOMAIN}'), 'Caddyfile missing {$WEB_DOMAIN}');
    assert.ok(caddyfile.includes('reverse_proxy web:3000'), 'Caddyfile must proxy Web to web:3000');
  });

  it('uses Debian Node 22 slim, non-root user, and healthchecks in Dockerfiles', () => {
    const apiDocker = readRootFile('services/api/Dockerfile');
    const agentDocker = readRootFile('services/agent/Dockerfile');
    const webDocker = readRootFile('apps/web/Dockerfile');

    for (const [name, content] of [
      ['api', apiDocker],
      ['agent', agentDocker],
      ['web', webDocker],
    ]) {
      assert.ok(
        content.includes('node:22-bookworm-slim'),
        `${name} Dockerfile should use node:22-bookworm-slim for native compatibility`,
      );
      assert.ok(
        content.includes('USER node'),
        `${name} Dockerfile must run as non-root USER node`,
      );
    }

    assert.ok(apiDocker.includes('HEALTHCHECK') && apiDocker.includes('/health'));
    assert.ok(webDocker.includes('HEALTHCHECK'));
  });

  it('enables Next.js standalone output for the web Dockerfile', () => {
    const nextConfig = readRootFile('apps/web/next.config.ts');
    assert.ok(
      nextConfig.includes("output: 'standalone'") || nextConfig.includes('output: "standalone"'),
      'apps/web/next.config.ts must set output: standalone for Docker runner',
    );
  });

  it('protects secrets in both .dockerignore and .gitignore', () => {
    const dockerignore = readRootFile('.dockerignore');
    const gitignore = readRootFile('.gitignore');

    for (const secretPattern of ['.env', '.env.local', 'certs']) {
      assert.ok(
        dockerignore.includes(secretPattern),
        `.dockerignore must exclude ${secretPattern}`,
      );
      assert.ok(
        gitignore.includes(secretPattern),
        `.gitignore must exclude ${secretPattern}`,
      );
    }

    assert.ok(
      gitignore.includes('google-services.json'),
      '.gitignore must exclude google-services.json',
    );
  });
});
