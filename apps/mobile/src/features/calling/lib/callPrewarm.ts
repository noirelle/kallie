import {
  ConnectionState,
  createLocalAudioTrack,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import { PermissionsAndroid, Platform } from 'react-native';
import { apiClient } from '../../../lib/apiClient';
import { cacheManager } from '../../../lib/cache/cacheManager';
import { appEnv } from '../../../lib/env';
import { JoinCallResponse } from '../../../types/database';

export type LiveKitNativeModule = {
  registerGlobals: () => void;
  AndroidAudioTypePresets?: {
    communication: Record<string, unknown>;
  };
  AudioSession: {
    startAudioSession: () => Promise<void>;
    stopAudioSession: () => Promise<void>;
    configureAudio?: (options: Record<string, unknown>) => Promise<void>;
    selectAudioOutput?: (output: string) => Promise<void>;
  };
};

export interface StagedStandbySession {
  joinData: JoinCallResponse;
  room: Room;
  connectPromise: Promise<boolean>;
  isConnected: () => boolean;
  isAgentAudioSubscribed: () => boolean;
  disposed: boolean;
  startSignalSent?: boolean;
  startSignalPromise?: Promise<boolean> | null;
  preCapturedMicPromise?: Promise<LocalAudioTrack | null> | null;
}

export const CONTROL_DATA_TOPIC = 'kallie.control';

let nativeGlobalsRegistered = false;
let cachedMicGranted: boolean | null = null;
let lastApiWarmAt = 0;
let lastLiveKitWarmAt = 0;
let standbyRoom: Room | null = null;
let activeAudioWarmPromise: Promise<void> | null = null;
let audioSessionStarted = false;

// Home-screen pre-staged standby session (short 38s client TTL < 45s agent TTL)
let stagedStandby: StagedStandbySession | null = null;
let stagingInFlight: Promise<StagedStandbySession | null> | null = null;
let standbyExpiryTimer: ReturnType<typeof setTimeout> | null = null;
let lastStandbyFailureAt = 0;
let standbyUnsupportedByServer = false;

const PREWARM_THROTTLE_MS = 20_000;
const STANDBY_CLIENT_TTL_MS = 38_000; // Strictly below 45s agent idle timeout
const STANDBY_FAILURE_COOLDOWN_MS = 10_000;

export const LIVEKIT_ROOM_OPTIONS = {
  adaptiveStream: true,
  dynacast: true,
  audioCaptureDefaults: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
} as const;

export function registerLiveKitGlobals(): void {
  if (Platform.OS === 'web' || nativeGlobalsRegistered) {
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@livekit/react-native') as LiveKitNativeModule;
    mod.registerGlobals();
    nativeGlobalsRegistered = true;
  } catch {
    // Safe fallback on web or Expo Go
  }
}

export function getNativeLiveKit(): LiveKitNativeModule | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@livekit/react-native') as LiveKitNativeModule;
  } catch {
    return null;
  }
}

export function encodeUtf8Bytes(text: string): Uint8Array<ArrayBuffer> {
  if (typeof TextEncoder !== 'undefined') {
    const encoded = new TextEncoder().encode(text);
    const out = new Uint8Array(new ArrayBuffer(encoded.byteLength));
    out.set(encoded);
    return out;
  }
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

export async function sendStandbyStartSignal(room: Room): Promise<void> {
  const payload = encodeUtf8Bytes(JSON.stringify({ type: 'start_call' }));
  await room.localParticipant.publishData(payload, {
    reliable: true,
    topic: CONTROL_DATA_TOPIC,
  });
}

const LIVEKIT_REGION_CACHE_KEY = 'meta:livekit_regional_url';
const LIVEKIT_REGION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours persistent
const LIVEKIT_REGION_SWR_MS = 24 * 60 * 60 * 1000; // 24 hours SWR

export function getCachedRegionalLiveKitUrl(fallbackUrl: string): string {
  const cached = cacheManager.getSync<string>(LIVEKIT_REGION_CACHE_KEY);
  if (cached?.value && cached.isWithinStaleWindow) {
    return cached.value;
  }
  return fallbackUrl;
}

export function invalidateCachedRegionalLiveKitUrl(): void {
  cacheManager.invalidate(LIVEKIT_REGION_CACHE_KEY);
}

/**
 * Resolves and persistently caches LiveKit Cloud's lowest-latency regional edge
 * URL in L1+L2 SQLite (12h TTL + 24h SWR) so cold app restarts bypass global
 * anycast redirects immediately.
 */
export async function resolveOptimalLiveKitUrl(
  baseUrl: string,
  token: string,
): Promise<string> {
  if (!baseUrl.includes('.livekit.cloud') || !token) {
    return baseUrl;
  }

  const httpBase = baseUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/$/, '');

  try {
    const resolved = await cacheManager.fetchWithCache<string>(
      LIVEKIT_REGION_CACHE_KEY,
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${httpBase}/settings/regions`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));

        if (!res.ok) {
          throw new Error(`LiveKit regions HTTP ${res.status}`);
        }
        const body = (await res.json()) as {
          regions?: Array<{ url?: string; region?: string }>;
        };
        const bestHttpUrl = body.regions?.[0]?.url;
        if (!bestHttpUrl) {
          throw new Error('No LiveKit region URL returned');
        }
        const bestWsUrl = bestHttpUrl
          .replace(/^https:\/\//, 'wss://')
          .replace(/^http:\/\//, 'ws://')
          .replace(/\/$/, '');
        console.log(
          `[CallPerf] resolvedLiveKitRegion=${body.regions?.[0]?.region ?? 'unknown'} url=${bestWsUrl}`,
        );
        return { value: bestWsUrl };
      },
      {
        ttlMs: LIVEKIT_REGION_TTL_MS,
        staleWhileRevalidateMs: LIVEKIT_REGION_SWR_MS,
        persist: true,
      },
    );
    return resolved || baseUrl;
  } catch {
    return baseUrl;
  }
}

export async function refreshCachedMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    cachedMicGranted = true;
    return true;
  }
  try {
    const granted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    cachedMicGranted = granted;
    return granted;
  } catch {
    return false;
  }
}

export async function ensureMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  if (cachedMicGranted === true) {
    return true;
  }
  const alreadyGranted = await refreshCachedMicPermission();
  if (alreadyGranted) {
    return true;
  }
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone Permission',
      message: 'Kallie needs microphone access so you can talk during voice calls.',
      buttonPositive: 'Allow',
      buttonNegative: 'Cancel',
    },
  );
  const granted = result === PermissionsAndroid.RESULTS.GRANTED;
  cachedMicGranted = granted;
  return granted;
}

/**
 * Pre-warms DNS, TLS keep-alive sockets, LiveKit edge connection, and cached
 * Android microphone permission before the user taps Aura.
 */
export function prewarmCallInfrastructure(force = false): void {
  registerLiveKitGlobals();
  const now = Date.now();

  void refreshCachedMicPermission();

  if (appEnv.apiUrl && (force || now - lastApiWarmAt > PREWARM_THROTTLE_MS)) {
    lastApiWarmAt = now;
    void fetch(`${appEnv.apiUrl}/health`, { method: 'GET' }).catch(() => {});
  }

  const targetLkUrl = getCachedRegionalLiveKitUrl(appEnv.livekitUrl);
  if (targetLkUrl && (force || !standbyRoom || now - lastLiveKitWarmAt > PREWARM_THROTTLE_MS)) {
    lastLiveKitWarmAt = now;
    if (!standbyRoom) {
      standbyRoom = new Room(LIVEKIT_ROOM_OPTIONS);
    }
    void standbyRoom.prepareConnection(targetLkUrl).catch(() => {});
  }
}

/**
 * Consumes the pre-warmed Room instance (if available) so room.connect() reuses
 * its warm DNS/TLS state, or creates a fresh Room if none is staged.
 */
export function takePrewarmedRoom(): Room {
  registerLiveKitGlobals();
  if (standbyRoom) {
    const room = standbyRoom;
    standbyRoom = null;
    return room;
  }
  return new Room(LIVEKIT_ROOM_OPTIONS);
}

function clearStandbyTimer(): void {
  if (standbyExpiryTimer) {
    clearTimeout(standbyExpiryTimer);
    standbyExpiryTimer = null;
  }
}

/**
 * Silently pre-stages a short-lived standby LiveKit room + warm Gemini Live agent
 * while the user is on the Home Aura screen.
 * - Zero AudioSession activation and zero microphone access until Aura is tapped.
 * - Automatically disconnects after 38s idle (or immediately on app background).
 */
export async function stageStandbySession(): Promise<StagedStandbySession | null> {
  if (standbyUnsupportedByServer) {
    return null;
  }
  if (stagedStandby && !stagedStandby.disposed) {
    return stagedStandby;
  }
  if (stagingInFlight) {
    return stagingInFlight;
  }
  if (Date.now() - lastStandbyFailureAt < STANDBY_FAILURE_COOLDOWN_MS) {
    return null;
  }

  registerLiveKitGlobals();

  stagingInFlight = (async () => {
    const t0 = Date.now();
    try {
      const joinData = await apiClient.createTestCall({
        title: 'Call with Kallie',
        standby: true,
      });

      // Backward-compatibility guard: only connect in standby if the server
      // explicitly confirmed standby mode (prevents older servers from greeting early).
      if (joinData.standby !== true) {
        standbyUnsupportedByServer = true;
        void apiClient.endCall(joinData.session.id).catch(() => {});
        return null;
      }

      const room = takePrewarmedRoom();
      let connected = false;
      let agentAudioSubscribed = false;

      const entry: StagedStandbySession = {
        joinData,
        room,
        connectPromise: Promise.resolve(false),
        isConnected: () => connected && room.state === ConnectionState.Connected,
        isAgentAudioSubscribed: () => agentAudioSubscribed,
        disposed: false,
      };

      const onStandbyTrackSubscribed = (track: { kind: Track.Kind }) => {
        if (track.kind === Track.Kind.Audio) {
          agentAudioSubscribed = true;
          console.log(
            `[CallPerf] standbyAgentAudioReady=${Date.now() - t0}ms session=${joinData.session.id}`,
          );
        }
      };

      const onStandbyDisconnected = () => {
        connected = false;
        if (stagedStandby === entry) {
          stagedStandby = null;
          clearStandbyTimer();
        }
      };

      room.on(RoomEvent.TrackSubscribed, onStandbyTrackSubscribed);
      room.on(RoomEvent.Disconnected, onStandbyDisconnected);

      const connectPromise = (async () => {
        try {
          const optimalUrl = await resolveOptimalLiveKitUrl(
            joinData.livekitUrl,
            joinData.token,
          );
          if (entry.disposed) return false;
          try {
            await room.connect(optimalUrl, joinData.token, { autoSubscribe: true });
          } catch {
            if (optimalUrl !== joinData.livekitUrl && !entry.disposed) {
              invalidateCachedRegionalLiveKitUrl();
              await room.connect(joinData.livekitUrl, joinData.token, {
                autoSubscribe: true,
              });
            } else {
              throw new Error('Standby LiveKit connect failed');
            }
          }
          if (entry.disposed) {
            void room.disconnect().catch(() => {});
            return false;
          }
          connected = true;
          console.log(
            `[CallPerf] standbyRoomConnected=${Date.now() - t0}ms session=${joinData.session.id}`,
          );
          return true;
        } catch {
          connected = false;
          lastStandbyFailureAt = Date.now();
          if (stagedStandby === entry) {
            stagedStandby = null;
            clearStandbyTimer();
          }
          return false;
        }
      })();

      entry.connectPromise = connectPromise;
      stagedStandby = entry;

      clearStandbyTimer();
      standbyExpiryTimer = setTimeout(() => {
        if (stagedStandby === entry && !entry.disposed) {
          console.log(`[CallPerf] standbyExpiredIdle session=${joinData.session.id}`);
          void teardownStandbySession();
        }
      }, STANDBY_CLIENT_TTL_MS);

      return entry;
    } catch {
      lastStandbyFailureAt = Date.now();
      return null;
    } finally {
      stagingInFlight = null;
    }
  })();

  return stagingInFlight;
}

/**
 * Atomically claims the currently staged standby session (if connected or in-flight)
 * when the user taps Aura so it transitions directly into an active voice call.
 */
export function consumeStandbySession(): StagedStandbySession | null {
  clearStandbyTimer();
  const current = stagedStandby;
  stagedStandby = null;
  if (!current || current.disposed) {
    return null;
  }
  if (current.room.state === ConnectionState.Disconnected && !stagingInFlight) {
    // Allow adopting if connectPromise hasn't settled yet (still connecting)
    // Disconnect listener would have cleared stagedStandby if it failed after connecting.
  }
  return current;
}

/**
 * Fires `start_call` over the already-connected standby LiveKit room and kicks
 * off microphone capture imperatively at t=0ms on Aura tap (before React re-renders),
 * eliminating the ~200-250ms React state -> useEffect hop.
 */
export function activateStandbyImperatively(
  staged: StagedStandbySession,
  tapStartedAtMs: number,
): void {
  if (staged.disposed) return;

  if (!staged.startSignalSent) {
    staged.startSignalSent = true;
    staged.startSignalPromise = (async () => {
      try {
        const ok = staged.isConnected() || (await staged.connectPromise);
        if (!ok || staged.disposed || staged.room.state !== ConnectionState.Connected) {
          return false;
        }
        await sendStandbyStartSignal(staged.room);
        console.log(
          `[CallPerf] standbyActivated(imperative)=${Date.now() - tapStartedAtMs}ms session=${staged.joinData.session.id}`,
        );
        return true;
      } catch {
        return false;
      }
    })();
  }

  if (!staged.preCapturedMicPromise) {
    staged.preCapturedMicPromise = ensureMicrophonePermission()
      .then((granted) => {
        if (!granted || staged.disposed) return null;
        return createLocalAudioTrack({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });
      })
      .then((track) => {
        if (track && staged.disposed) {
          track.stop();
          return null;
        }
        return track;
      })
      .catch(() => null);
  }
}

/**
 * Lightweight speculative warm-up triggered on Aura press-in (`onPressIn`).
 * If the 38s standby session expired while idle on Home, refreshes sockets
 * and mic permission cache ~80-150ms before finger-up.
 */
export function prewarmOnTouchIntent(): void {
  if (stagedStandby && !stagedStandby.disposed) {
    return;
  }
  prewarmCallInfrastructure(false);
}

export async function teardownStandbySession(): Promise<void> {
  clearStandbyTimer();
  const current = stagedStandby;
  stagedStandby = null;
  if (!current) return;
  current.disposed = true;
  try {
    current.room.removeAllListeners();
    await current.room.disconnect();
  } catch {
    // Ignore teardown errors
  }
}

/**
 * Starts native Android/iOS AudioSession and locks speaker output idempotently.
 * Designed to be called at t=0ms on Aura tap so AudioManager and AEC are fully
 * settled before LiveKit media arrives.
 */
export function warmAudioSessionEarly(): Promise<void> {
  const nativeLk = getNativeLiveKit();
  if (!nativeLk) {
    return Promise.resolve();
  }
  if (audioSessionStarted) {
    return Promise.resolve();
  }
  if (activeAudioWarmPromise) {
    return activeAudioWarmPromise;
  }

  const commPreset = nativeLk.AndroidAudioTypePresets?.communication || {
    manageAudioFocus: true,
    audioMode: 'inCommunication',
    audioFocusMode: 'gain',
    audioAttributesUsageType: 'voiceCommunication',
    audioAttributesContentType: 'speech',
    audioStreamType: 'voiceCall',
  };

  activeAudioWarmPromise = (async () => {
    await nativeLk.AudioSession.configureAudio?.({
      android: {
        preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'],
        audioTypeOptions: commPreset,
      },
      ios: {
        defaultOutput: 'speaker',
      },
    });
    await nativeLk.AudioSession.startAudioSession();
    await nativeLk.AudioSession.selectAudioOutput?.('speaker').catch(() => {});
    audioSessionStarted = true;
  })()
    .catch((err) => {
      audioSessionStarted = false;
      throw err;
    })
    .finally(() => {
      activeAudioWarmPromise = null;
    });

  return activeAudioWarmPromise;
}

export async function stopAudioSessionSafe(): Promise<void> {
  const inFlight = activeAudioWarmPromise;
  if (inFlight) {
    await inFlight.catch(() => {});
  }
  const nativeLk = getNativeLiveKit();
  audioSessionStarted = false;
  if (!nativeLk) return;
  await nativeLk.AudioSession.stopAudioSession().catch(() => {});
}
