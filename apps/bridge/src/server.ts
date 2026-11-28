import crypto from 'node:crypto';
import fs from 'node:fs';
import http, { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { DetectedEngine, detectInstalledEngines } from './engineDetector.js';
import { BridgeChatMessage, runDesktopEngineStream } from './engineRunner.js';

export interface BridgeConfig {
  token: string;
  deviceName: string;
  createdAt: string;
}

export interface BridgeServerOptions {
  port?: number;
  host?: string;
  publicUrl?: string;
  configPath?: string;
  rotateToken?: boolean;
}

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.kallie-bridge', 'config.json');

export function loadOrCreateBridgeConfig(
  configPath = DEFAULT_CONFIG_PATH,
  rotateToken = false,
): BridgeConfig {
  if (!rotateToken && fs.existsSync(configPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as BridgeConfig;
      if (parsed.token && parsed.token.length >= 32) {
        return parsed;
      }
    } catch {
      // Fall through to regenerate
    }
  }

  const config: BridgeConfig = {
    token: crypto.randomBytes(32).toString('hex'),
    deviceName: os.hostname() || 'My Computer',
    createdAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return config;
}

export function detectNetworkAddresses(): { lanIp: string; tailscaleIp: string | null } {
  const ifaces = os.networkInterfaces();
  let lanIp = '127.0.0.1';
  let tailscaleIp: string | null = null;

  for (const [name, entries] of Object.entries(ifaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith('100.') || /tailscale/i.test(name)) {
        tailscaleIp = entry.address;
        continue;
      }
      if (
        lanIp === '127.0.0.1' &&
        (entry.address.startsWith('192.168.') ||
          entry.address.startsWith('10.') ||
          /^172\.(1[6-9]|2\d|3[0-1])\./.test(entry.address))
      ) {
        lanIp = entry.address;
      }
    }
  }

  return { lanIp, tailscaleIp };
}

export function buildPairingUri(params: {
  baseUrl: string;
  token: string;
  deviceName: string;
}): string {
  const qs = new URLSearchParams({
    url: `${params.baseUrl.replace(/\/$/, '')}/v1`,
    token: params.token,
    name: params.deviceName,
  });
  return `kallie://pair?${qs.toString()}`;
}

export function verifyBearerToken(authHeader: string | undefined, expectedToken: string): boolean {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const provided = authHeader.slice('Bearer '.length).trim();
  if (provided.length !== expectedToken.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(provided, 'utf8'),
    Buffer.from(expectedToken, 'utf8'),
  );
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error('Request payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function renderPairingHtml(params: {
  deviceName: string;
  baseUrl: string;
  pairingUri: string;
  qrSvg: string;
  engines: DetectedEngine[];
}): string {
  const rows = params.engines
    .map(
      (e) => `
      <div class="engine ${e.installed ? 'ready' : 'missing'}">
        <div class="engine-top">
          <strong>${e.name}</strong>
          <span class="badge">${e.installed ? 'DETECTED' : 'NOT INSTALLED'}</span>
        </div>
        <div class="meta">${
          e.installed
            ? e.version || `${e.command} ready (${e.models.length} model${e.models.length === 1 ? '' : 's'})`
            : `Install: <code>${e.installHint}</code>`
        }</div>
      </div>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Kallie Desktop Bridge — Pair Phone</title>
<style>
  body { background:#000; color:#fafafa; font-family:system-ui,-apple-system,sans-serif; margin:0; padding:32px 20px; display:flex; justify-content:center; }
  .wrap { max-width:720px; width:100%; }
  h1 { font-size:24px; margin:0 0 6px; letter-spacing:-0.02em; }
  .sub { color:#a1a1aa; font-size:14px; margin:0 0 24px; }
  .grid { display:grid; grid-template-columns:260px 1fr; gap:24px; align-items:start; }
  @media (max-width:680px) { .grid { grid-template-columns:1fr; } }
  .qr-card { background:#fff; padding:16px; border-radius:16px; text-align:center; }
  .qr-card svg { width:220px; height:220px; display:block; margin:0 auto; }
  .qr-caption { color:#18181b; font-size:12px; font-weight:600; margin-top:10px; }
  .link-box { margin-top:12px; background:#0d0d10; border:1px solid #27272a; border-radius:12px; padding:10px; font-family:monospace; font-size:11px; color:#a1a1aa; word-break:break-all; }
  .engine { background:#0c0c0f; border:1px solid #27272a; border-radius:12px; padding:12px 14px; margin-bottom:10px; }
  .engine.ready { border-color:rgba(31,213,249,0.4); }
  .engine-top { display:flex; justify-content:space-between; align-items:center; font-size:14px; }
  .badge { font-family:monospace; font-size:10px; padding:3px 7px; border-radius:999px; background:#18181b; color:#71717a; }
  .engine.ready .badge { background:rgba(31,213,249,0.16); color:#1fd5f9; }
  .meta { color:#71717a; font-size:12px; margin-top:5px; }
  code { color:#e4e4e7; background:#18181b; padding:1px 5px; border-radius:4px; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Kallie Desktop Bridge</h1>
    <p class="sub">Scan this QR code with your Android camera to connect <strong>${params.deviceName}</strong> (${params.baseUrl}) to Kallie Mobile with zero manual API keys.</p>
    <div class="grid">
      <div>
        <div class="qr-card">
          ${params.qrSvg}
          <div class="qr-caption">Scan with Phone Camera</div>
        </div>
        <div class="link-box">${params.pairingUri}</div>
      </div>
      <div>
        ${rows}
      </div>
    </div>
  </div>
</body>
</html>`;
}

export async function createBridgeServer(options: BridgeServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT || 4789);
  const host = options.host || '0.0.0.0';
  const config = loadOrCreateBridgeConfig(options.configPath, options.rotateToken);
  const { lanIp, tailscaleIp } = detectNetworkAddresses();
  const baseUrl = (
    options.publicUrl ||
    process.env.KALLIE_BRIDGE_URL ||
    `http://${lanIp}:${port}`
  ).replace(/\/$/, '');

  const pairingUri = buildPairingUri({
    baseUrl,
    token: config.token,
    deviceName: config.deviceName,
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'kallie-desktop-bridge',
        version: '0.2.0',
        deviceName: config.deviceName,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const engines = await detectInstalledEngines();
      const qrSvg = await QRCode.toString(pairingUri, { type: 'svg', margin: 1 });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        renderPairingHtml({
          deviceName: config.deviceName,
          baseUrl,
          pairingUri,
          qrSvg,
          engines,
        }),
      );
      return;
    }

    // All /v1/* endpoints require the 256-bit Bearer pairing token
    if (!verifyBearerToken(req.headers.authorization, config.token)) {
      sendJson(res, 401, { error: { message: 'Invalid or missing Kallie Bridge pairing token.' } });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/engines') {
      const engines = await detectInstalledEngines();
      sendJson(res, 200, {
        deviceName: config.deviceName,
        engines,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      const engines = await detectInstalledEngines();
      const data = engines.flatMap((e) =>
        e.models.map((m) => ({
          id: m.id,
          object: 'model',
          owned_by: e.name,
        })),
      );
      sendJson(res, 200, { object: 'list', data });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      let body: Record<string, any>;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(res, 400, {
          error: { message: err instanceof Error ? err.message : 'Bad JSON' },
        });
        return;
      }

      const model = String(body.model || '').trim();
      const messages = Array.isArray(body.messages)
        ? (body.messages as BridgeChatMessage[])
        : [];
      const stream = body.stream !== false;

      if (!model || messages.length === 0) {
        sendJson(res, 400, {
          error: { message: 'Both "model" and non-empty "messages" are required.' },
        });
        return;
      }

      const completionId = `kallie-bridge-${crypto.randomUUID()}`;
      const abortController = new AbortController();
      req.on('close', () => abortController.abort());

      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });

        try {
          await runDesktopEngineStream({
            model,
            messages,
            signal: abortController.signal,
            onTextDelta: (delta) => {
              const packet = {
                id: completionId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
              };
              res.write(`data: ${JSON.stringify(packet)}\n\n`);
            },
          });

          const donePacket = {
            id: completionId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          };
          res.write(`data: ${JSON.stringify(donePacket)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Desktop engine execution failed';
          const errChunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                delta: { content: `\n[Desktop Bridge Error: ${msg}]` },
                finish_reason: 'stop',
              },
            ],
          };
          res.write(`data: ${JSON.stringify(errChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        }
        return;
      }

      let fullText = '';
      try {
        await runDesktopEngineStream({
          model,
          messages,
          signal: abortController.signal,
          onTextDelta: (delta) => {
            fullText += delta;
          },
        });
        sendJson(res, 200, {
          id: completionId,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: fullText },
              finish_reason: 'stop',
            },
          ],
        });
      } catch (err) {
        sendJson(res, 500, {
          error: { message: err instanceof Error ? err.message : 'Desktop engine failed' },
        });
      }
      return;
    }

    sendJson(res, 404, { error: { message: 'Not found' } });
  });

  return {
    server,
    port,
    host,
    baseUrl,
    lanIp,
    tailscaleIp,
    pairingUri,
    config,
  };
}
