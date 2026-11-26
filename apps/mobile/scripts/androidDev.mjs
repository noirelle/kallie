#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MOBILE_DIR = path.resolve(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const PATH_SEP = IS_WIN ? ';' : ':';

function findJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }
  if (IS_WIN) {
    const roots = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs'),
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft',
      'C:\\Program Files\\Java',
    ];
    for (const root of roots) {
      if (!root || !fs.existsSync(root)) continue;
      const dirs = fs
        .readdirSync(root)
        .filter((d) => /^jdk-?17/i.test(d))
        .sort()
        .reverse();
      if (dirs.length > 0) return path.join(root, dirs[0]);
    }
  } else {
    const linuxPaths = [
      '/usr/lib/jvm/java-17-openjdk-amd64',
      '/usr/lib/jvm/temurin-17-jdk-amd64',
      '/usr/lib/jvm/java-17-openjdk',
    ];
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p;
    }
  }
  return '';
}

function findAndroidHome() {
  for (const candidate of [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    IS_WIN
      ? path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')
      : path.join(os.homedir(), 'Android', 'Sdk'),
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
  ]) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return '';
}

function findScrcpyDir() {
  if (!IS_WIN || !process.env.LOCALAPPDATA) return '';
  const pkgRoot = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(pkgRoot)) return '';
  const scrcpyPkgs = fs.readdirSync(pkgRoot).filter((d) => d.startsWith('Genymobile.scrcpy'));
  for (const pkg of scrcpyPkgs) {
    const pkgPath = path.join(pkgRoot, pkg);
    if (fs.existsSync(path.join(pkgPath, 'scrcpy.exe'))) return pkgPath;
    for (const child of fs.readdirSync(pkgPath)) {
      const candidate = path.join(pkgPath, child);
      if (fs.existsSync(path.join(candidate, 'scrcpy.exe'))) return candidate;
    }
  }
  return '';
}

function buildEnv(extraEnv = {}) {
  const javaHome = findJavaHome();
  const androidHome = findAndroidHome();
  const scrcpyDir = findScrcpyDir();
  const extraPaths = [];

  if (javaHome) extraPaths.push(path.join(javaHome, 'bin'));
  if (androidHome) {
    extraPaths.push(path.join(androidHome, 'platform-tools'));
    extraPaths.push(path.join(androidHome, 'cmdline-tools', 'latest', 'bin'));
    extraPaths.push(path.join(androidHome, 'emulator'));
  }
  if (scrcpyDir) extraPaths.push(scrcpyDir);
  if (IS_WIN && process.env.LOCALAPPDATA) {
    extraPaths.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
  }

  const mergedPath = [...extraPaths, process.env.PATH || ''].filter(Boolean).join(PATH_SEP);

  return {
    ...process.env,
    ...(javaHome ? { JAVA_HOME: javaHome } : {}),
    ...(androidHome ? { ANDROID_HOME: androidHome, ANDROID_SDK_ROOT: androidHome } : {}),
    PATH: mergedPath,
    ...extraEnv,
  };
}

function resolveBin(command, env) {
  if (!IS_WIN) return command;
  if (command === 'npx') return 'npx.cmd';
  if (command === 'gradlew.bat' || path.isAbsolute(command)) return command;
  const exts = ['.exe', '.cmd', '.bat'];
  const dirs = (env.PATH || '').split(PATH_SEP).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, command.endsWith(ext) ? command : `${command}${ext}`);
      if (fs.existsSync(full)) return full;
    }
  }
  return command;
}

function runCommand(command, args, options = {}) {
  const env = options.env || buildEnv();
  const resolved = resolveBin(command, env);
  const needsShell = IS_WIN && /\.(cmd|bat)$/i.test(resolved);

  return new Promise((resolve) => {
    const child = spawn(resolved, args, {
      cwd: options.cwd || MOBILE_DIR,
      env,
      stdio: 'inherit',
      shell: needsShell,
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      console.error(`Failed to start "${command}": ${err.message}`);
      resolve(1);
    });
  });
}

function probe(command, args, env) {
  const resolved = resolveBin(command, env);
  const needsShell = IS_WIN && /\.(cmd|bat)$/i.test(resolved);
  const res = spawnSync(resolved, args, {
    env,
    encoding: 'utf8',
    shell: needsShell,
  });
  return {
    ok: res.status === 0,
    output: `${res.stdout || ''}\n${res.stderr || ''}`.trim(),
  };
}

async function cmdDoctor() {
  const env = buildEnv();
  const javaHome = findJavaHome();
  const androidHome = findAndroidHome();

  console.log('=== Kallie Mobile Android Dev Doctor ===\n');
  console.log(`OS:           ${process.platform} (${os.arch()})`);
  console.log(`JAVA_HOME:    ${javaHome || 'NOT FOUND'}`);
  console.log(`ANDROID_HOME: ${androidHome || 'NOT FOUND'}\n`);

  const checks = [
    ['JDK 17 (java)', 'java', ['-version']],
    ['ADB', 'adb', ['version']],
    ['scrcpy', 'scrcpy', ['--version']],
  ];

  let allOk = Boolean(javaHome && androidHome);
  for (const [label, bin, args] of checks) {
    const res = probe(bin, args, env);
    const firstLine = res.output.split(/\r?\n/).find((l) => l.trim()) || 'not found';
    console.log(`[${res.ok ? 'OK' : 'MISSING'}] ${label}: ${firstLine}`);
    if (!res.ok) allOk = false;
  }

  console.log('\nConnected Android Devices (adb devices):');
  const devRes = probe('adb', ['devices', '-l'], env);
  console.log(devRes.output || 'Unable to query adb devices');

  if (!allOk) {
    console.log('\nSome tools are missing. Reopen your terminal if they were just installed.');
    process.exit(1);
  }
}

async function cmdBuild() {
  const env = buildEnv({ EXPO_ENABLE_ANDROID_FCM: 'true' });
  probe('adb', ['reverse', 'tcp:8081', 'tcp:8081'], env);
  const code = await runCommand('npx', ['expo', 'run:android'], { env });
  process.exit(code);
}

async function cmdDev() {
  const env = buildEnv({ EXPO_ENABLE_ANDROID_FCM: 'true' });
  probe('adb', ['reverse', 'tcp:8081', 'tcp:8081'], env);
  const code = await runCommand('npx', ['expo', 'start', '--android'], { env });
  process.exit(code);
}

async function cmdLogs() {
  const env = buildEnv();
  probe('adb', ['logcat', '-c'], env);
  console.log('Streaming Kallie Android logs (Ctrl+C to stop)...\n');
  const code = await runCommand(
    'adb',
    [
      'logcat',
      '-v',
      'time',
      '*:S',
      'ReactNativeJS:V',
      'AndroidRuntime:E',
      'RNCallKeep:D',
      'WebRTCModule:D',
      'FirebaseMessaging:E',
      'dev.expo.updates:I',
    ],
    { env },
  );
  process.exit(code);
}

async function cmdMirror() {
  const env = buildEnv();
  const code = await runCommand('scrcpy', ['--window-title', 'Kallie Android'], { env });
  process.exit(code);
}

async function cmdReleaseLocal() {
  const env = buildEnv({ EXPO_ENABLE_ANDROID_FCM: 'true' });
  console.log('1/3 Running expo prebuild for Android...');
  let code = await runCommand('npx', ['expo', 'prebuild', '--platform', 'android', '--clean'], {
    env,
  });
  if (code !== 0) process.exit(code);

  const androidDir = path.join(MOBILE_DIR, 'android');
  const gradlew = IS_WIN ? 'gradlew.bat' : './gradlew';

  console.log('\n2/3 Compiling optimized release APK...');
  code = await runCommand(gradlew, ['assembleRelease'], { cwd: androidDir, env });
  if (code !== 0) process.exit(code);

  const apkPath = path.join(
    androidDir,
    'app',
    'build',
    'outputs',
    'apk',
    'release',
    'app-release.apk',
  );
  if (fs.existsSync(apkPath)) {
    const sizeMB = (fs.statSync(apkPath).size / (1024 * 1024)).toFixed(2);
    console.log(`\nBuilt APK: ${apkPath} (${sizeMB} MB)`);
    console.log('\n3/3 Installing onto connected Android device...');
    code = await runCommand('adb', ['install', '-r', apkPath], { env });
    process.exit(code);
  }
  console.error('Release APK was not found at:', apkPath);
  process.exit(1);
}

const cmd = process.argv[2] || 'doctor';
const commands = {
  doctor: cmdDoctor,
  build: cmdBuild,
  dev: cmdDev,
  logs: cmdLogs,
  mirror: cmdMirror,
  'release-local': cmdReleaseLocal,
};

if (!commands[cmd]) {
  console.error(`Unknown command "${cmd}". Available: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}

await commands[cmd]();
