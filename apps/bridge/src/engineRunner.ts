import { spawn } from 'node:child_process';
import { resolveExecutableOnPath } from './engineDetector.js';

export interface BridgeChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface StreamRunOptions {
  model: string;
  messages: BridgeChatMessage[];
  cwd?: string;
  signal?: AbortSignal;
  onTextDelta: (delta: string) => void;
}

const IS_WIN = process.platform === 'win32';

function buildPromptFromMessages(messages: BridgeChatMessage[]): string {
  const recent = messages.slice(-16);
  const parts: string[] = [];
  for (const m of recent) {
    if (!m.content?.trim()) continue;
    if (m.role === 'system') {
      parts.push(`[System Instructions]\n${m.content.trim()}`);
    } else if (m.role === 'assistant') {
      parts.push(`Assistant: ${m.content.trim()}`);
    } else if (m.role === 'user') {
      parts.push(`User: ${m.content.trim()}`);
    }
  }
  return parts.join('\n\n');
}

function getCliInvocation(
  engineId: string,
  prompt: string,
): { command: string; args: string[]; stdinPrompt?: string } {
  switch (engineId) {
    case 'claude':
      return {
        command: 'claude',
        args: ['-p', '--output-format', 'text'],
        stdinPrompt: prompt,
      };
    case 'codex':
      return {
        command: 'codex',
        args: ['exec', '-'],
        stdinPrompt: prompt,
      };
    case 'gemini':
      return {
        command: 'gemini',
        args: ['-p', prompt],
      };
    case 'agy':
      return {
        command: 'agy',
        args: ['-p', prompt],
      };
    case 'copilot':
      return {
        command: 'copilot',
        args: ['-p', prompt],
      };
    case 'cursor':
      return {
        command: 'cursor-agent',
        args: ['-p', prompt],
      };
    default:
      throw new Error(`Unsupported desktop CLI engine: "${engineId}"`);
  }
}

async function runOllamaStream(
  ollamaModel: string,
  messages: BridgeChatMessage[],
  onTextDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      stream: true,
      messages: messages.map((m) => ({
        role: m.role === 'tool' ? 'user' : m.role,
        content: m.content,
      })),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(errText || `Ollama returned HTTP ${res.status}`);
  }

  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { message?: { content?: string } };
        if (parsed.message?.content) {
          onTextDelta(parsed.message.content);
        }
      } catch {
        // Ignore partial JSON lines
      }
    }
  }
}

/**
 * Executes a prompt through an authenticated local desktop AI CLI or Ollama model
 * and streams incremental stdout chunks back to the mobile client over SSE.
 */
export async function runDesktopEngineStream(options: StreamRunOptions): Promise<void> {
  const { model, messages, cwd, signal, onTextDelta } = options;

  if (model.startsWith('ollama/')) {
    const ollamaModel = model.slice('ollama/'.length);
    await runOllamaStream(ollamaModel, messages, onTextDelta, signal);
    return;
  }

  const engineId = model.startsWith('cli/') ? model.slice('cli/'.length) : model;
  const prompt = buildPromptFromMessages(messages);
  const spec = getCliInvocation(engineId, prompt);
  const resolved = resolveExecutableOnPath(spec.command);

  if (!resolved) {
    throw new Error(
      `Desktop CLI "${spec.command}" is not installed or not in PATH on this computer.`,
    );
  }

  const needsShell = IS_WIN && /\.(cmd|bat)$/i.test(resolved);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolved, spec.args, {
      cwd: cwd || process.cwd(),
      shell: needsShell,
      windowsHide: true,
      env: { ...process.env },
    });

    let stderrText = '';
    let receivedAnyStdout = false;

    const onAbort = () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore kill error
      }
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        reject(new Error('Request cancelled'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (chunk) {
        receivedAnyStdout = true;
        onTextDelta(chunk);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrText += chunk;
    });

    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (code === 0 || receivedAnyStdout) {
        resolve();
      } else {
        reject(
          new Error(
            stderrText.trim().slice(0, 300) ||
              `${spec.command} exited with code ${code}. Make sure you are signed in via your terminal.`,
          ),
        );
      }
    });

    if (spec.stdinPrompt !== undefined) {
      child.stdin.write(spec.stdinPrompt, 'utf8');
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}
