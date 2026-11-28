#!/usr/bin/env node
import QRCode from 'qrcode';
import { detectInstalledEngines } from './engineDetector.js';
import { buildPairingUri, createBridgeServer } from './server.js';

function parseArgs(argv: string[]) {
  const args = {
    port: Number(process.env.PORT || 4789),
    useTailscale: false,
    rotateToken: false,
    publicUrl: process.env.KALLIE_BRIDGE_URL || '',
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--tailscale') args.useTailscale = true;
    else if (token === '--rotate-token') args.rotateToken = true;
    else if (token === '--port' && argv[i + 1]) {
      args.port = Number.parseInt(argv[++i], 10) || 4789;
    } else if (token === '--url' && argv[i + 1]) {
      args.publicUrl = argv[++i];
    }
  }
  return args;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const bridge = await createBridgeServer({
    port: cli.port,
    rotateToken: cli.rotateToken,
    publicUrl: cli.publicUrl || undefined,
  });

  const effectiveUrl =
    cli.useTailscale && bridge.tailscaleIp
      ? `http://${bridge.tailscaleIp}:${bridge.port}`
      : bridge.baseUrl;

  const effectivePairingUri = buildPairingUri({
    baseUrl: effectiveUrl,
    token: bridge.config.token,
    deviceName: bridge.config.deviceName,
  });

  const engines = await detectInstalledEngines();

  bridge.server.listen(bridge.port, bridge.host, async () => {
    console.log('\n======================================================');
    console.log('  Kallie Desktop Bridge — Local AI CLI Wrapper');
    console.log('======================================================');
    console.log(`  PC Name:      ${bridge.config.deviceName}`);
    console.log(`  LAN URL:      ${effectiveUrl}`);
    if (bridge.tailscaleIp) {
      console.log(`  Tailscale IP: http://${bridge.tailscaleIp}:${bridge.port}`);
    }
    console.log(`  Pairing Page: http://127.0.0.1:${bridge.port}`);
    console.log('\n  Detected AI Engines:');
    for (const eng of engines) {
      const icon = eng.installed ? '[READY]' : '[  -  ]';
      const detail = eng.installed
        ? `${eng.models.map((m) => m.id).join(', ')}`
        : `not installed (${eng.installHint})`;
      console.log(`    ${icon} ${eng.name.padEnd(22)} ${detail}`);
    }

    console.log('\n  Scan this QR code with your Android camera to pair Kallie:\n');
    const asciiQr = await QRCode.toString(effectivePairingUri, {
      type: 'terminal',
      small: true,
    });
    console.log(asciiQr);
    console.log(`  Or paste pairing link in Kallie Settings -> Desktop:\n  ${effectivePairingUri}\n`);
  });
}

void main();
