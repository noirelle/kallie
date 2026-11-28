import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

interface NativeDirectAudioModule {
  startSession: (
    inputSampleRate: number,
    outputSampleRate: number,
    speakerphone: boolean,
  ) => Promise<{
    aecEnabled: boolean;
    nsEnabled: boolean;
    inputSampleRate: number;
    outputSampleRate: number;
  }>;
  playPcmChunk: (base64Pcm: string) => void;
  clearPlayback: () => void;
  setMuted: (isMuted: boolean) => void;
  setSpeakerphone: (enabled: boolean) => void;
  prepareVoiceAudioRoute?: (speakerphone: boolean) => void;
  releaseVoiceAudioRoute?: () => void;
  stopSession: () => Promise<boolean>;
  getClipboardText?: () => Promise<string>;
  startSpeechListening?: (localeTag: string) => Promise<boolean>;
  stopSpeechListening?: () => void;
  speakText?: (text: string, utteranceId: string, flush: boolean) => Promise<boolean>;
  stopSpeaking?: () => void;
}

const nativeMod =
  Platform.OS === 'android'
    ? (NativeModules.KallieDirectAudio as NativeDirectAudioModule | undefined)
    : undefined;

const emitter = nativeMod ? new NativeEventEmitter(nativeMod as never) : null;

export const directAudioBridge = {
  isAvailable(): boolean {
    return Boolean(nativeMod);
  },

  isSpeechAndTtsAvailable(): boolean {
    return Boolean(
      nativeMod &&
        typeof nativeMod.startSpeechListening === 'function' &&
        typeof nativeMod.speakText === 'function',
    );
  },

  async start(options: {
    inputSampleRate: 16000 | 24000;
    outputSampleRate: 16000 | 24000;
    speakerphone?: boolean;
  }) {
    if (!nativeMod) {
      throw new Error(
        'Direct Android audio module not installed. Install the v0.2.0 serverless APK to use direct voice.',
      );
    }
    return nativeMod.startSession(
      options.inputSampleRate,
      options.outputSampleRate,
      options.speakerphone !== false,
    );
  },

  playPcmChunk(base64Pcm: string): void {
    nativeMod?.playPcmChunk(base64Pcm);
  },

  clearPlayback(): void {
    nativeMod?.clearPlayback();
  },

  setMuted(muted: boolean): void {
    nativeMod?.setMuted(muted);
  },

  setSpeakerphone(enabled: boolean): void {
    nativeMod?.setSpeakerphone(enabled);
  },

  prepareVoiceAudioRoute(speakerphone = true): void {
    nativeMod?.prepareVoiceAudioRoute?.(speakerphone);
  },

  releaseVoiceAudioRoute(): void {
    nativeMod?.releaseVoiceAudioRoute?.();
  },

  async stop(): Promise<void> {
    if (!nativeMod) return;
    await nativeMod.stopSession().catch(() => {});
  },

  async getClipboardText(): Promise<string> {
    if (!nativeMod?.getClipboardText) return '';
    try {
      const value = await nativeMod.getClipboardText();
      return typeof value === 'string' ? value : '';
    } catch {
      return '';
    }
  },

  async startSpeechListening(localeTag = 'en-US'): Promise<boolean> {
    if (!nativeMod?.startSpeechListening) {
      throw new Error('Native Android speech recognition is not available in this build.');
    }
    return nativeMod.startSpeechListening(localeTag);
  },

  stopSpeechListening(): void {
    nativeMod?.stopSpeechListening?.();
  },

  async speakText(text: string, utteranceId: string, flush = false): Promise<boolean> {
    if (!nativeMod?.speakText) return false;
    return nativeMod.speakText(text, utteranceId, flush);
  },

  stopSpeaking(): void {
    nativeMod?.stopSpeaking?.();
  },

  onAudioChunk(listener: (event: { pcmBase64: string; level: number }) => void): () => void {
    if (!emitter) return () => {};
    const sub = emitter.addListener('KallieAudioChunk', (raw) => {
      listener(raw as { pcmBase64: string; level: number });
    });
    return () => sub.remove();
  },

  onPlaybackLevel(listener: (event: { level: number }) => void): () => void {
    if (!emitter) return () => {};
    const sub = emitter.addListener('KalliePlaybackLevel', (raw) => {
      listener(raw as { level: number });
    });
    return () => sub.remove();
  },

  onPlaybackIdle(listener: () => void): () => void {
    if (!emitter) return () => {};
    const sub = emitter.addListener('KalliePlaybackIdle', () => listener());
    return () => sub.remove();
  },

  onAudioState(listener: (event: { state: string }) => void): () => void {
    if (!emitter) return () => {};
    const sub = emitter.addListener('KallieAudioState', (raw) => {
      listener(raw as { state: string });
    });
    return () => sub.remove();
  },

  onSpeechPartial(listener: (event: { text: string }) => void): () => void {
    if (!emitter) return () => {};
    const sub = emitter.addListener('KallieSpeechPartial', (raw) => {
      listener(raw as { text: string });
    });
    return () => sub.remove();
  },

  onSpeechResult(listener: (event: { text: string }) => void): () => void {
    if (!emitter) return () => {};
    const sub = emitter.addListener('KallieSpeechResult', (raw) => {
      listener(raw as { text: string });
    });
    return () => sub.remove();
  },

  onSpeechRms(listener: (event: { level: number }) => void): () => void {
    if (!emitter) return () => {};
    const sub = emitter.addListener('KallieSpeechRms', (raw) => {
      listener(raw as { level: number });
    });
    return () => sub.remove();
  },

  onSpeechError(listener: (event: { code: number; message: string }) => void): () => void {
    if (!emitter) return () => {};
    const sub = emitter.addListener('KallieSpeechError', (raw) => {
      listener(raw as { code: number; message: string });
    });
    return () => sub.remove();
  },

  onTtsStart(listener: (event: { utteranceId: string }) => void): () => void {
    if (!emitter) return () => {};
    const sub = emitter.addListener('KallieTtsStart', (raw) => {
      listener(raw as { utteranceId: string });
    });
    return () => sub.remove();
  },

  onTtsDone(listener: (event: { utteranceId: string }) => void): () => void {
    if (!emitter) return () => {};
    const sub = emitter.addListener('KallieTtsDone', (raw) => {
      listener(raw as { utteranceId: string });
    });
    return () => sub.remove();
  },
};
