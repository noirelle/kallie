import { generatePrefixedId } from '../../../lib/id';
import { getPreferenceSync, setPreferenceSync } from '../../../lib/storage/localDb';
import { phoneControlBridge } from './phoneControlBridge';

const PHONE_CONTROL_SETTINGS_KEY = 'kallie_phone_control_settings_v1';

export interface PhoneControlSettings {
  dynamicNotchEnabled: boolean;
  confirmBeforeSending: boolean;
}

const DEFAULT_SETTINGS: PhoneControlSettings = {
  dynamicNotchEnabled: true,
  confirmBeforeSending: true,
};

const SENSITIVE_TAP_PATTERN =
  /\b(send|post|publish|delete|remove|pay|transfer|checkout|purchase|confirm payment|place order)\b/i;

const VOICE_CANCEL_PATTERN =
  /\b(no|nope|cancel|stop|huwag|wag|don't|dont|abort|nevermind|go back)\b/i;
const VOICE_APPROVE_PATTERN =
  /\b(yes|yeah|yep|send it|send now|go ahead|sige|oo|confirm|proceed|approve)\b/i;

interface PendingConfirm {
  requestId: string;
  resolve: (result: { approved: boolean; via: 'notch' | 'voice' | 'timeout' | 'stopped' }) => void;
  timer: ReturnType<typeof setTimeout>;
}

const settingsListeners = new Set<(settings: PhoneControlSettings) => void>();
const stopListeners = new Set<() => void>();
const notchStopListeners = new Set<(info: { hadPendingConfirm: boolean }) => void>();
const confirmStateListeners = new Set<(pending: boolean) => void>();
let pendingConfirm: PendingConfirm | null = null;
let automationEpoch = 0;
let nativeEventsBound = false;
let cachedSettings: PhoneControlSettings | null = null;

function notifyConfirmPending(pending: boolean): void {
  confirmStateListeners.forEach((cb) => {
    try {
      cb(pending);
    } catch {
      // Ignore subscriber error
    }
  });
}

export function initPhoneControlListeners(): void {
  if (nativeEventsBound) return;
  nativeEventsBound = true;

  phoneControlBridge.onNotchConfirm(({ requestId, approved }) => {
    if (pendingConfirm && pendingConfirm.requestId === requestId) {
      const current = pendingConfirm;
      pendingConfirm = null;
      clearTimeout(current.timer);
      notifyConfirmPending(false);
      current.resolve({ approved, via: 'notch' });
    }
  });

  phoneControlBridge.onNotchStop(() => {
    cancelActivePhoneAutomation('notch');
  });
}

// Bind native Orb Stop & Confirm events eagerly on module load
initPhoneControlListeners();

export function getPhoneControlSettingsSync(): PhoneControlSettings {
  if (cachedSettings) return cachedSettings;
  const saved = getPreferenceSync<Partial<PhoneControlSettings>>(PHONE_CONTROL_SETTINGS_KEY);
  cachedSettings = {
    dynamicNotchEnabled:
      typeof saved?.dynamicNotchEnabled === 'boolean'
        ? saved.dynamicNotchEnabled
        : DEFAULT_SETTINGS.dynamicNotchEnabled,
    confirmBeforeSending:
      typeof saved?.confirmBeforeSending === 'boolean'
        ? saved.confirmBeforeSending
        : DEFAULT_SETTINGS.confirmBeforeSending,
  };
  return cachedSettings;
}

export function updatePhoneControlSettingsSync(
  patch: Partial<PhoneControlSettings>,
): PhoneControlSettings {
  const next: PhoneControlSettings = {
    ...getPhoneControlSettingsSync(),
    ...patch,
  };
  cachedSettings = next;
  setPreferenceSync(PHONE_CONTROL_SETTINGS_KEY, next);
  settingsListeners.forEach((cb) => {
    try {
      cb(next);
    } catch {
      // Ignore subscriber error
    }
  });
  return next;
}

export function subscribePhoneControlSettings(
  listener: (settings: PhoneControlSettings) => void,
): () => void {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
}

export function subscribePhoneAutomationStop(listener: () => void): () => void {
  initPhoneControlListeners();
  stopListeners.add(listener);
  return () => {
    stopListeners.delete(listener);
  };
}

/**
 * Fires ONLY when the user physically drags the Floating Orb onto the ✕ dismiss target.
 * Internal cancellations (new user turn, Gemini toolCallCancellation, session teardown)
 * never trigger this listener so they cannot accidentally end the active call.
 */
export function subscribeNotchStopRequest(
  listener: (info: { hadPendingConfirm: boolean }) => void,
): () => void {
  initPhoneControlListeners();
  notchStopListeners.add(listener);
  return () => {
    notchStopListeners.delete(listener);
  };
}

export function subscribeConfirmationState(listener: (pending: boolean) => void): () => void {
  confirmStateListeners.add(listener);
  return () => {
    confirmStateListeners.delete(listener);
  };
}

export function isConfirmationPending(): boolean {
  return pendingConfirm !== null;
}

export function getPhoneAutomationEpoch(): number {
  initPhoneControlListeners();
  return automationEpoch;
}

export function cancelActivePhoneAutomation(source: 'internal' | 'notch' = 'internal'): void {
  automationEpoch += 1;
  phoneControlBridge.clearNotchAction();
  const hadPendingConfirm = pendingConfirm !== null;
  if (pendingConfirm) {
    const current = pendingConfirm;
    pendingConfirm = null;
    clearTimeout(current.timer);
    phoneControlBridge.clearNotchConfirm(current.requestId);
    notifyConfirmPending(false);
    current.resolve({ approved: false, via: 'stopped' });
  }
  stopListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // Ignore listener error
    }
  });
  if (source === 'notch') {
    notchStopListeners.forEach((cb) => {
      try {
        cb({ hadPendingConfirm });
      } catch {
        // Ignore listener error
      }
    });
  }
}

function resolvePendingConfirmationByVoice(approved: boolean): boolean {
  if (!pendingConfirm) return false;
  const current = pendingConfirm;
  pendingConfirm = null;
  clearTimeout(current.timer);
  phoneControlBridge.clearNotchConfirm(current.requestId);
  notifyConfirmPending(false);
  current.resolve({ approved, via: 'voice' });
  return true;
}

/**
 * Resolves a pending Send/Action confirmation via spoken transcript.
 * Partial transcripts can only cancel (never prematurely approve on words like
 * "wait, don't send"). Approvals require a final utterance with no cancel words.
 */
export function tryResolveConfirmationFromTranscript(
  transcript: string,
  isFinal = true,
): boolean {
  if (!pendingConfirm) return false;
  const cleaned = transcript.trim();
  if (!cleaned) return false;
  if (VOICE_CANCEL_PATTERN.test(cleaned)) {
    return resolvePendingConfirmationByVoice(false);
  }
  if (!isFinal) return false;
  if (VOICE_APPROVE_PATTERN.test(cleaned)) {
    return resolvePendingConfirmationByVoice(true);
  }
  return false;
}

export function isSensitiveTapTarget(labelOrQuery: string | undefined): boolean {
  if (!labelOrQuery?.trim()) return false;
  // Normalize camelCase and snake_case / kebab-case viewIds (e.g. send_button, btnDelete)
  const normalized = labelOrQuery
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return SENSITIVE_TAP_PATTERN.test(normalized);
}

/**
 * Enforces Kallie's Send/Post/Delete safety guardrail and explicit 'ask' policies.
 * Shows the Monochrome Confirm Card and waits for tap approval or spoken confirmation.
 */
export async function requestSensitiveActionApproval(params: {
  title: string;
  preview: string;
  approveLabel?: string;
  timeoutMs?: number;
  forceConfirm?: boolean;
}): Promise<{
  approved: boolean;
  via: 'auto_policy' | 'notch' | 'voice' | 'timeout' | 'stopped' | 'unavailable';
}> {
  initPhoneControlListeners();
  const settings = getPhoneControlSettingsSync();
  if (!params.forceConfirm && !settings.confirmBeforeSending) {
    return { approved: true, via: 'auto_policy' };
  }

  if (!phoneControlBridge.isAvailable()) {
    return { approved: false, via: 'unavailable' };
  }

  if (pendingConfirm) {
    const prev = pendingConfirm;
    pendingConfirm = null;
    clearTimeout(prev.timer);
    phoneControlBridge.clearNotchConfirm(prev.requestId);
    notifyConfirmPending(false);
    prev.resolve({ approved: false, via: 'stopped' });
  }

  const requestId = generatePrefixedId('confirm');
  const timeoutMs = params.timeoutMs ?? 25_000;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingConfirm?.requestId === requestId) {
        pendingConfirm = null;
        phoneControlBridge.clearNotchConfirm(requestId);
        notifyConfirmPending(false);
        resolve({ approved: false, via: 'timeout' });
      }
    }, timeoutMs);

    pendingConfirm = { requestId, resolve, timer };
    notifyConfirmPending(true);
    phoneControlBridge.showNotchConfirm(
      requestId,
      params.title,
      params.preview,
      params.approveLabel || 'Send',
    );
  });
}
