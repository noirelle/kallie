import { redactSecrets } from '../../../lib/storage/secureVault';

export interface SseRequestOptions {
  url: string;
  method?: 'POST' | 'GET';
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  onEvent: (data: string, eventName?: string) => void;
}

/**
 * React Native–safe progressive SSE streaming transport built on XMLHttpRequest
 * (`onprogress`). Works reliably across Android Hermes without requiring polyfills
 * for WHATWG ReadableStream.
 */
export function streamSseRequest(options: SseRequestOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method || 'POST', options.url, true);
    xhr.timeout = 45_000;

    for (const [key, value] of Object.entries(options.headers)) {
      xhr.setRequestHeader(key, value);
    }

    let processedLength = 0;
    let lineBuffer = '';
    let currentEvent: string | undefined;
    let settled = false;

    const finishError = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(redactSecrets(message)));
    };

    const finishOk = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const processChunk = (text: string) => {
      lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line === '') {
          currentEvent = undefined;
          continue;
        }
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
          continue;
        }
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim();
          if (payload && payload !== '[DONE]') {
            options.onEvent(payload, currentEvent);
          }
        }
      }
    };

    const onAbort = () => {
      xhr.abort();
      finishError('Request cancelled');
    };

    if (options.signal) {
      if (options.signal.aborted) {
        finishError('Request cancelled');
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    const cleanup = () => {
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    };

    xhr.onprogress = () => {
      if (xhr.status >= 400) return;
      const responseText = xhr.responseText || '';
      if (responseText.length > processedLength) {
        const delta = responseText.slice(processedLength);
        processedLength = responseText.length;
        processChunk(delta);
      }
    };

    xhr.onload = () => {
      cleanup();
      if (xhr.status < 200 || xhr.status >= 300) {
        const errBody = (xhr.responseText || '').slice(0, 320);
        finishError(errBody || `Provider returned HTTP ${xhr.status}`);
        return;
      }
      const responseText = xhr.responseText || '';
      if (responseText.length > processedLength) {
        processChunk(responseText.slice(processedLength));
      }
      if (lineBuffer.trim().startsWith('data:')) {
        const tail = lineBuffer.trim().slice(5).trim();
        if (tail && tail !== '[DONE]') {
          options.onEvent(tail, currentEvent);
        }
      }
      finishOk();
    };

    xhr.onerror = () => {
      cleanup();
      finishError('Network request failed. Check your connection or endpoint URL.');
    };

    xhr.ontimeout = () => {
      cleanup();
      finishError('Provider request timed out.');
    };

    xhr.send(options.body ?? null);
  });
}
