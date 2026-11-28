import { useEffect, useState } from 'react';
import { phoneControlBridge } from '../../phoneControl/lib/phoneControlBridge';

type AudioLevelListener = (level: number) => void;

let currentLevel = 0;
let notchAudioSyncEnabled = false;
let lastNotchPushMs = 0;
const listeners = new Set<AudioLevelListener>();

export function setNotchAudioSyncActive(active: boolean): void {
  notchAudioSyncEnabled = active;
}

export function publishAudioLevel(level: number): void {
  const clamped = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  currentLevel = clamped;

  if (notchAudioSyncEnabled) {
    const now = Date.now();
    if (now - lastNotchPushMs >= 75) {
      lastNotchPushMs = now;
      phoneControlBridge.setNotchAudioLevel(clamped);
    }
  }

  listeners.forEach((cb) => {
    try {
      cb(clamped);
    } catch {
      // Ignore subscriber error
    }
  });
}

export function resetAudioLevel(): void {
  currentLevel = 0;
  listeners.forEach((cb) => {
    try {
      cb(0);
    } catch {
      // Ignore subscriber error
    }
  });
}

export function useAudioLevel(enabled = true): number {
  const [level, setLevel] = useState(enabled ? currentLevel : 0);

  useEffect(() => {
    if (!enabled) {
      setLevel(0);
      return;
    }
    setLevel(currentLevel);
    listeners.add(setLevel);
    return () => {
      listeners.delete(setLevel);
    };
  }, [enabled]);

  return enabled ? level : 0;
}
