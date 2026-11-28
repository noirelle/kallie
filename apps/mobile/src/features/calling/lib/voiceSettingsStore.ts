import { getPreferenceSync, setPreferenceSync } from '../../../lib/storage/localDb';
import { VoiceSettings } from '../../../types/database';

const VOICE_SETTINGS_PREF = 'voice_settings_v2';

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  liveVoiceEnabled: true,
  voiceName: 'Aoede',
  useByokForVoice: true,
  customTokenServerUrl: null,
  preferredAudioOutput: 'speaker',
};

export const AVAILABLE_VOICES = ['Aoede', 'Kore', 'Puck', 'Charon', 'Fenrir', 'Coral', 'Alloy'] as const;

const listeners = new Set<() => void>();
let cachedVoiceSettings: VoiceSettings | null = null;

export function subscribeVoiceSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getVoiceSettingsSync(): VoiceSettings {
  if (cachedVoiceSettings) return cachedVoiceSettings;
  const saved = getPreferenceSync<Partial<VoiceSettings>>(VOICE_SETTINGS_PREF);
  cachedVoiceSettings = {
    ...DEFAULT_VOICE_SETTINGS,
    ...(saved || {}),
  };
  return cachedVoiceSettings;
}

export function updateVoiceSettingsSync(patch: Partial<VoiceSettings>): VoiceSettings {
  const next: VoiceSettings = {
    ...getVoiceSettingsSync(),
    ...patch,
  };
  cachedVoiceSettings = next;
  setPreferenceSync(VOICE_SETTINGS_PREF, next);
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore subscriber error
    }
  });
  return next;
}
