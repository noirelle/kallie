import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DetectedEngine {
  id: string;
  name: string;
  command: string;
  resolvedPath: string | null;
  installed: boolean;
  version: string | null;
  installHint: string;
  loginHint: string;
  models: Array<{ id: string; label: string }>;
}

interface EngineSpec {
  id: string;
  name: string;
  command: string;
  versionArgs: string[];
  installHint: string;
  loginHint: string;
}

const ENGINE_SPECS: EngineSpec[] = [
  {
    id: 'agy',
    name: 'Antigravity CLI',
    command: 'agy',
    versionArgs: ['--version'],
    installHint: 'Install Antigravity CLI and ensure `agy` is in PATH',
    loginHint: 'Run `agy login` in your terminal',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    versionArgs: ['--version'],
    installHint: 'npm install -g @anthropic-ai/claude-code',
    loginHint: 'Run `claude` once to sign in with your Anthropic account',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    command: 'codex',
    versionArgs: ['--version'],
    installHint: 'npm install -g @openai/codex',
    loginHint: 'Run `codex login` with your ChatGPT / OpenAI account',
  },
  {
    id: 'gemini',
    name: 'Google Gemini CLI',
    command: 'gemini',
    versionArgs: ['--version'],
    installHint: 'npm install -g @google/gemini-cli',
    loginHint: 'Run `gemini` once to sign in with Google',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    command: 'copilot',
    versionArgs: ['--version'],
    installHint: 'npm install -g @github/copilot',
    loginHint: 'Run `copilot` to sign in with GitHub',
  },
  {
    id: 'cursor',
    name: 'Cursor Agent CLI',
    command: 'cursor-agent',
    versionArgs: ['--version'],
    installHint: 'curl https://cursor.com/install -fsS | bash',
    loginHint: 'Run `cursor-agent login`',
  },
  {
    id: 'ollama',
    name: 'Ollama (Local Models)',
    command: 'ollama',
    versionArgs: ['--version'],
    installHint: 'Download from https://ollama.com',
    loginHint: 'Run `ollama pull llama3.2` (no account required)',
  },
];

const IS_WIN = process.platform === 'win32';

function getSearchDirectories(): string[] {
  const pathEnv = process.env.PATH || '';
  const sep = IS_WIN ? ';' : ':';
  const home = os.homedir();
  const extra = IS_WIN
    ? [
        path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm'),
        path.join(
          process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
          'Programs',
          'Antigravity',
          'bin',
        ),
        path.join(
          process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
          'Programs',
          'Ollama',
        ),
        path.join(home, '.local', 'bin'),
      ]
    : ['/usr/local/bin', '/opt/homebrew/bin', path.join(home, '.local', 'bin')];

  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const dir of [...pathEnv.split(sep), ...extra]) {
    if (!dir) continue;
    const key = IS_WIN ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    dirs.push(dir);
  }
  return dirs;
}

export function resolveExecutableOnPath(command: string): string | null {
  const exts = IS_WIN ? ['.exe', '.cmd', '.bat', ''] : [''];

  for (const dir of getSearchDirectories()) {
    for (const ext of exts) {
      const candidate = path.join(dir, command.endsWith(ext) ? command : `${command}${ext}`);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // Ignore unreadable PATH directories
      }
    }
  }
  return null;
}

function probeCliVersion(
  resolvedPath: string,
  args: string[],
): { runnable: boolean; version: string | null } {
  try {
    const needsShell = IS_WIN && /\.(cmd|bat)$/i.test(resolvedPath);
    const res = spawnSync(resolvedPath, args, {
      encoding: 'utf8',
      timeout: 3500,
      shell: needsShell,
      windowsHide: true,
    });
    const out = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
    const firstLine = out.split(/\r?\n/).find((l) => l.trim()) || null;
    if (res.status !== 0 && /not found|not installed|not recognized/i.test(out)) {
      return { runnable: false, version: null };
    }
    return {
      runnable: res.status === 0 || Boolean(firstLine && !/was not found/i.test(firstLine)),
      version: firstLine ? firstLine.slice(0, 80) : null,
    };
  } catch {
    return { runnable: false, version: null };
  }
}

async function listOllamaLocalModels(): Promise<Array<{ id: string; label: string }>> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    return (data.models || [])
      .filter((m) => Boolean(m.name))
      .map((m) => ({
        id: `ollama/${m.name}`,
        label: `Ollama · ${m.name}`,
      }));
  } catch {
    return [];
  }
}

/**
 * Scans the desktop PATH & local Ollama server to discover all available
 * AI CLI engines ready for zero-config mobile pairing.
 */
export async function detectInstalledEngines(): Promise<DetectedEngine[]> {
  const ollamaModels = await listOllamaLocalModels();

  return ENGINE_SPECS.map((spec) => {
    const resolvedPath = resolveExecutableOnPath(spec.command);
    const probe = resolvedPath
      ? probeCliVersion(resolvedPath, spec.versionArgs)
      : { runnable: false, version: null };
    const installed = probe.runnable || (spec.id === 'ollama' && ollamaModels.length > 0);
    const version = probe.runnable ? probe.version : null;

    const models =
      spec.id === 'ollama'
        ? ollamaModels
        : installed
          ? [{ id: `cli/${spec.id}`, label: `${spec.name} (PC)` }]
          : [];

    return {
      id: spec.id,
      name: spec.name,
      command: spec.command,
      resolvedPath,
      installed,
      version,
      installHint: spec.installHint,
      loginHint: spec.loginHint,
      models,
    };
  });
}
