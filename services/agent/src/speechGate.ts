import { AudioFrame, FrameProcessor } from '@livekit/rtc-node';
import { createRequire } from 'node:module';

interface NativeVadHandle {
  predict(pcm: Int16Array): Promise<number>;
  reset(): void;
}

interface LocalInferenceModule {
  createVad: () => NativeVadHandle;
  initVad?: () => void;
  VAD_WINDOW_SAMPLES?: number;
}

const require = createRequire(import.meta.url);
let cachedLocalInference: LocalInferenceModule | null | undefined;
let vadPrewarmed = false;

function loadLocalInference(): LocalInferenceModule | null {
  if (cachedLocalInference !== undefined) {
    return cachedLocalInference;
  }
  try {
    const mod = require('@livekit/local-inference') as LocalInferenceModule;
    if (typeof mod?.createVad === 'function') {
      cachedLocalInference = mod;
      return mod;
    }
  } catch {
    // Graceful fallback when native Rust Silero binary is unavailable
  }
  cachedLocalInference = null;
  return null;
}

/**
 * Eagerly initializes the native Rust Silero VAD singleton during worker prewarm
 * so the first audio frame of a call incurs zero cold-start model load latency.
 */
export function prewarmSpeechGate(): boolean {
  if (vadPrewarmed) {
    return true;
  }
  const mod = loadLocalInference();
  if (!mod) {
    return false;
  }
  try {
    mod.initVad?.();
    vadPrewarmed = true;
    return true;
  } catch {
    return false;
  }
}

export function computeFrameRms(data: Int16Array): number {
  const n = data.length;
  if (n === 0) {
    return 0;
  }
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const sample = data[i];
    sumSq += sample * sample;
  }
  return Math.sqrt(sumSq / n);
}

export interface SileroSpeechGateOptions {
  /** Hold gate open after speech drops below threshold to preserve trailing consonants. */
  hangoverMs?: number;
  /** Silero speech probability threshold to open the gate. */
  activationProb?: number;
  /** Silero speech probability threshold below which hangover countdown starts. */
  deactivationProb?: number;
  /** Minimum absolute RMS floor for instantaneous 0ms speech onset. */
  minOnsetRms?: number;
  /** Multiplier over adaptive ambient noise floor for instantaneous 0ms speech onset. */
  onsetRmsMultiplier?: number;
  /** Optional injected VAD handle for deterministic unit tests. */
  vadOverride?: NativeVadHandle | null;
}

const EXPECTED_SAMPLE_RATE = 16_000;
const DEFAULT_WINDOW_SAMPLES = 512;

/**
 * Zero-latency Silero-backed adaptive speech gate for LiveKit RoomIO audio input.
 *
 * Root problem solved:
 * Gemini Live's server-side VAD resets its silence timer when realistic phone room noise
 * (-45 to -32 dBFS fan/AC/mic hiss) arrives between utterances, causing unpredictable
 * 2.5s–5.5s+ stalls and occasional timeouts.
 *
 * How this processor eliminates that variance without adding latency or cutting speech:
 * - Instantaneous O(n) RMS jump detection opens the gate on frame 0 (0ms attack latency).
 * - Native Rust Silero VAD runs asynchronously on libuv's worker pool (~0.3ms/32ms window)
 *   to distinguish human speech from steady fan/room noise.
 * - After speech ends, a 150ms hangover preserves soft trailing consonants, followed by
 *   a 1-frame linear fade-out to pure digital zeros so Gemini Live endpoints consistently.
 */
export class SileroSpeechGateProcessor extends FrameProcessor<AudioFrame> {
  private enabled = true;
  private closed = false;
  private readonly vad: NativeVadHandle | null;
  private readonly winSize: number;
  private readonly vadBuf: Int16Array;
  private vadFill = 0;
  private vadBusy = false;
  private lastSpeechProb = 0;
  private gateOpen = false;
  private hangoverRemainingSamples = 0;
  private readonly hangoverSamples: number;
  private readonly activationProb: number;
  private readonly deactivationProb: number;
  private readonly minOnsetRms: number;
  private readonly onsetRmsMultiplier: number;
  private noiseRms = 120;
  private noiseFloorInitialized = false;

  constructor(options: SileroSpeechGateOptions = {}) {
    super();
    const mod = options.vadOverride === undefined ? loadLocalInference() : null;
    this.vad = options.vadOverride !== undefined ? options.vadOverride : mod ? mod.createVad() : null;
    this.winSize = mod?.VAD_WINDOW_SAMPLES || DEFAULT_WINDOW_SAMPLES;
    this.vadBuf = new Int16Array(this.winSize);
    const hangoverMs = options.hangoverMs ?? 150;
    this.hangoverSamples = Math.max(0, Math.round((EXPECTED_SAMPLE_RATE * hangoverMs) / 1000));
    this.activationProb = options.activationProb ?? 0.42;
    this.deactivationProb = options.deactivationProb ?? 0.25;
    this.minOnsetRms = options.minOnsetRms ?? 380;
    this.onsetRmsMultiplier = options.onsetRmsMultiplier ?? 3.8;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  process(frame: AudioFrame): AudioFrame {
    if (!this.enabled || this.closed || frame.sampleRate !== EXPECTED_SAMPLE_RATE) {
      return frame;
    }

    const data = frame.data;
    const n = data.length;
    if (n === 0) {
      return frame;
    }

    const rms = computeFrameRms(data);
    if (!this.noiseFloorInitialized) {
      this.noiseRms = Math.max(40, Math.min(800, rms));
      this.noiseFloorInitialized = true;
    }

    // Feed 512-sample windows to Rust Silero VAD off the main event loop
    if (this.vad) {
      let off = 0;
      while (off < n) {
        const take = Math.min(n - off, this.winSize - this.vadFill);
        this.vadBuf.set(data.subarray(off, off + take), this.vadFill);
        this.vadFill += take;
        off += take;
        if (this.vadFill === this.winSize) {
          if (!this.vadBusy && !this.closed) {
            this.vadBusy = true;
            const windowCopy = new Int16Array(this.vadBuf);
            this.vad
              .predict(windowCopy)
              .then((prob) => {
                if (this.closed) return;
                this.lastSpeechProb = prob;
                if (prob >= this.activationProb) {
                  this.gateOpen = true;
                  this.hangoverRemainingSamples = this.hangoverSamples;
                } else if (prob >= this.deactivationProb && this.gateOpen) {
                  this.hangoverRemainingSamples = Math.max(
                    this.hangoverRemainingSamples,
                    Math.round(this.hangoverSamples * 0.5),
                  );
                }
              })
              .catch(() => {})
              .finally(() => {
                this.vadBusy = false;
              });
          }
          this.vadFill = 0;
        }
      }
    }

    // Instantaneous 0ms-attack onset when frame energy rises clearly above ambient noise
    const suddenSpeechOnset = rms > Math.max(this.minOnsetRms, this.noiseRms * this.onsetRmsMultiplier);
    if (suddenSpeechOnset || this.lastSpeechProb >= this.activationProb) {
      this.gateOpen = true;
      this.hangoverRemainingSamples = this.hangoverSamples;
    }

    if (this.gateOpen) {
      if (this.lastSpeechProb < this.deactivationProb && !suddenSpeechOnset) {
        this.hangoverRemainingSamples -= n;
        if (this.hangoverRemainingSamples <= 0) {
          this.gateOpen = false;
          // Smooth 1-frame linear fade-out avoids clicks when transitioning to digital silence
          const faded = new Int16Array(n);
          for (let i = 0; i < n; i++) {
            faded[i] = Math.round(data[i] * (1 - i / n));
          }
          return new AudioFrame(faded, frame.sampleRate, frame.channels, frame.samplesPerChannel);
        }
      }
      return frame;
    }

    // Non-speech: slowly track ambient room floor and output pure digital silence
    this.noiseRms = this.noiseRms * 0.96 + rms * 0.04;
    return new AudioFrame(
      new Int16Array(n),
      frame.sampleRate,
      frame.channels,
      frame.samplesPerChannel,
    );
  }

  close(): void {
    this.closed = true;
    try {
      this.vad?.reset();
    } catch {
      // Ignore cleanup errors on shutdown
    }
  }
}
