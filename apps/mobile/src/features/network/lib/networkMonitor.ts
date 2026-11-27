import { AppState, AppStateStatus, Platform } from 'react-native';

export type NetworkQuality = 'connected' | 'weak' | 'disconnected';

export interface NetworkQualitySnapshot {
  quality: NetworkQuality;
  rttMs: number | null;
  lastCheckedAt: number | null;
}

type NetworkListener = (snapshot: NetworkQualitySnapshot) => void;

const PROBE_URL = 'https://clients3.google.com/generate_204';
const PROBE_TIMEOUT_MS = 2400;
const HEALTHY_INTERVAL_MS = 2000;
const OFFLINE_INTERVAL_MS = 1500;
const WEAK_RTT_THRESHOLD_MS = 750;
const RECOVER_HEALTHY_RTT_MS = 600;
const UNSTABLE_JITTER_MS = 450;
const MIN_PROBE_GAP_MS = 350;

/**
 * Centralized real-time internet connection quality monitor (zero native deps,
 * works identically across Android, iOS, and Web via instant OTA).
 *
 * Detection strategy:
 * - Instant OS socket drop events from Supabase Realtime / LiveKit rooms trigger
 *   an immediate reachability probe (~5–30ms fail on Android when Wi-Fi/data turns off).
 * - Lightweight 0-byte `generate_204` foreground probes every 2s detect silent stalls,
 *   high latency (>=750ms -> weak/yellow), jitter spikes (>=450ms -> weak/yellow),
 *   and full disconnects (network error or 2 timeouts -> disconnected/red).
 * - Automatically pauses in background so idle battery usage stays near zero.
 */
class NetworkMonitor {
  private snapshot: NetworkQualitySnapshot = {
    quality:
      Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'disconnected'
        : 'connected',
    rttMs: null,
    lastCheckedAt: null,
  };

  private listeners = new Set<NetworkListener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private appStateSub: { remove: () => void } | null = null;
  private webListenersBound = false;
  private inFlight: Promise<NetworkQualitySnapshot> | null = null;
  private isForeground = AppState.currentState === 'active';
  private started = false;
  private lastProbeStartedAt = 0;

  // Rolling stability counters for hysteresis (prevents rapid color flicker)
  private consecutiveTimeouts = 0;
  private consecutiveHealthy = 0;
  private lastSuccessRttMs: number | null = null;

  getSnapshot(): NetworkQualitySnapshot {
    return this.snapshot;
  }

  subscribe(listener: NetworkListener): () => void {
    this.listeners.add(listener);
    if (!this.started) {
      this.start();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stop();
      }
    };
  }

  private emit(next: NetworkQualitySnapshot): void {
    const qualityChanged = next.quality !== this.snapshot.quality;
    const rttChanged =
      next.rttMs !== this.snapshot.rttMs &&
      (next.rttMs === null ||
        this.snapshot.rttMs === null ||
        Math.abs(next.rttMs - this.snapshot.rttMs) >= 120);

    this.snapshot = next;
    if (!qualityChanged && !rttChanged) {
      return;
    }

    this.listeners.forEach((listener) => {
      try {
        listener(this.snapshot);
      } catch {
        // Isolate subscriber errors
      }
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.isForeground = Platform.OS === 'web' ? true : AppState.currentState === 'active';

    if (Platform.OS !== 'web') {
      this.appStateSub = AppState.addEventListener('change', this.handleAppStateChange);
    } else if (typeof window !== 'undefined' && !this.webListenersBound) {
      window.addEventListener('offline', this.handleWebOffline);
      window.addEventListener('online', this.handleWebOnline);
      this.webListenersBound = true;
    }

    if (this.isForeground) {
      void this.probeNow(true);
    }
  }

  stop(): void {
    this.started = false;
    this.clearTimer();
    this.appStateSub?.remove();
    this.appStateSub = null;
    if (Platform.OS === 'web' && typeof window !== 'undefined' && this.webListenersBound) {
      window.removeEventListener('offline', this.handleWebOffline);
      window.removeEventListener('online', this.handleWebOnline);
      this.webListenersBound = false;
    }
  }

  /**
   * Called by active transports (Supabase Realtime WebSocket, LiveKit Room)
   * when an OS-level socket error/disconnect or reconnect happens so Aura reacts
   * immediately (<200ms) instead of waiting for the next polling interval.
   */
  notifyTransportEvent(kind: 'dropped' | 'weak' | 'connected'): void {
    if (!this.started || !this.isForeground) return;
    if (kind === 'dropped') {
      void this.probeNow(true);
    } else if (kind === 'weak') {
      if (this.snapshot.quality === 'connected') {
        this.consecutiveHealthy = 0;
        this.emit({
          quality: 'weak',
          rttMs: this.snapshot.rttMs,
          lastCheckedAt: Date.now(),
        });
      }
      void this.probeNow(false);
    } else if (kind === 'connected' && this.snapshot.quality !== 'connected') {
      void this.probeNow(true);
    }
  }

  async probeNow(force = false): Promise<NetworkQualitySnapshot> {
    if (this.inFlight) {
      return this.inFlight;
    }
    const now = Date.now();
    if (!force && now - this.lastProbeStartedAt < MIN_PROBE_GAP_MS) {
      return this.snapshot;
    }
    this.lastProbeStartedAt = now;
    this.clearTimer();

    this.inFlight = this.executeProbe().finally(() => {
      this.inFlight = null;
      if (this.started && this.isForeground) {
        this.scheduleNext();
      }
    });
    return this.inFlight;
  }

  private handleAppStateChange = (nextState: AppStateStatus): void => {
    const active = nextState === 'active';
    this.isForeground = active;
    if (active) {
      void this.probeNow(true);
    } else {
      this.clearTimer();
    }
  };

  private handleWebOffline = (): void => {
    this.consecutiveTimeouts = 2;
    this.consecutiveHealthy = 0;
    this.emit({
      quality: 'disconnected',
      rttMs: null,
      lastCheckedAt: Date.now(),
    });
  };

  private handleWebOnline = (): void => {
    void this.probeNow(true);
  };

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    this.clearTimer();
    const delayMs =
      this.snapshot.quality === 'disconnected' ? OFFLINE_INTERVAL_MS : HEALTHY_INTERVAL_MS;
    this.timer = setTimeout(() => {
      if (this.started && this.isForeground) {
        void this.probeNow(false);
      }
    }, delayMs);
  }

  private async executeProbe(): Promise<NetworkQualitySnapshot> {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.consecutiveTimeouts = 2;
      this.consecutiveHealthy = 0;
      this.emit({ quality: 'disconnected', rttMs: null, lastCheckedAt: Date.now() });
      return this.snapshot;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PROBE_TIMEOUT_MS);

    const startedAt = Date.now();
    try {
      const response = await fetch(`${PROBE_URL}?t=${startedAt}`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const rttMs = Math.max(1, Date.now() - startedAt);
      if (!response.ok && response.status !== 204) {
        // Captive portal or upstream error while link exists -> treat as weak/unstable
        this.consecutiveHealthy = 0;
        this.emit({ quality: 'weak', rttMs, lastCheckedAt: Date.now() });
        return this.snapshot;
      }

      const prevRtt = this.lastSuccessRttMs;
      this.lastSuccessRttMs = rttMs;
      const jitterMs = prevRtt !== null ? Math.abs(rttMs - prevRtt) : 0;
      const wasDisconnected = this.snapshot.quality === 'disconnected';
      this.consecutiveTimeouts = 0;

      const isSlowOrJittery =
        rttMs >= WEAK_RTT_THRESHOLD_MS ||
        (jitterMs >= UNSTABLE_JITTER_MS && rttMs >= 350);

      if (isSlowOrJittery) {
        this.consecutiveHealthy = 0;
        this.emit({ quality: 'weak', rttMs, lastCheckedAt: Date.now() });
      } else {
        this.consecutiveHealthy += 1;
        // Recover immediately from offline; require 2 clean probes to clear 'weak'
        if (
          wasDisconnected ||
          this.snapshot.quality === 'connected' ||
          (rttMs < RECOVER_HEALTHY_RTT_MS && this.consecutiveHealthy >= 2)
        ) {
          this.emit({ quality: 'connected', rttMs, lastCheckedAt: Date.now() });
        } else {
          this.emit({ quality: 'weak', rttMs, lastCheckedAt: Date.now() });
        }
      }
      return this.snapshot;
    } catch {
      clearTimeout(timeoutId);
      this.consecutiveHealthy = 0;
      this.lastSuccessRttMs = null;

      if (timedOut) {
        // 1st timeout -> weak/unstable (yellow); 2 consecutive timeouts -> disconnected (red)
        this.consecutiveTimeouts += 1;
        const nextQuality: NetworkQuality =
          this.consecutiveTimeouts >= 2 ? 'disconnected' : 'weak';
        this.emit({
          quality: nextQuality,
          rttMs: null,
          lastCheckedAt: Date.now(),
        });
      } else {
        // Immediate OS network error (Wi-Fi / Mobile Data turned off, DNS unreachable) -> RED immediately
        this.consecutiveTimeouts = 2;
        this.emit({
          quality: 'disconnected',
          rttMs: null,
          lastCheckedAt: Date.now(),
        });
      }
      return this.snapshot;
    }
  }
}

export const networkMonitor = new NetworkMonitor();
