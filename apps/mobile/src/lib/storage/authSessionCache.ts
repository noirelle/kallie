import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';

type SessionListener = (session: Session | null, hydrated: boolean) => void;

const TOKEN_REFRESH_BUFFER_SEC = 60;

let cachedSession: Session | null = null;
let isHydrated = false;
let initialized = false;
let inFlightHydration: Promise<Session | null> | null = null;
const listeners = new Set<SessionListener>();

function notifyListeners(): void {
  listeners.forEach((fn) => {
    try {
      fn(cachedSession, isHydrated);
    } catch {
      // Ignore individual subscriber errors
    }
  });
}

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;

  inFlightHydration = supabase.auth
    .getSession()
    .then(({ data }) => {
      cachedSession = data.session ?? null;
      isHydrated = true;
      notifyListeners();
      return cachedSession;
    })
    .catch(() => {
      isHydrated = true;
      notifyListeners();
      return null;
    })
    .finally(() => {
      inFlightHydration = null;
    });

  supabase.auth.onAuthStateChange((_event, nextSession) => {
    cachedSession = nextSession ?? null;
    isHydrated = true;
    notifyListeners();
  });
}

export function getCachedAuthState(): { session: Session | null; hydrated: boolean } {
  ensureInitialized();
  return { session: cachedSession, hydrated: isHydrated };
}

export function subscribeAuthSession(listener: SessionListener): () => void {
  ensureInitialized();
  listeners.add(listener);
  listener(cachedSession, isHydrated);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Returns a valid Supabase access token with zero storage I/O on cache hit.
 * Only calls supabase.auth.getSession() if unhydrated or within 60s of expiry.
 */
export async function getValidAccessToken(): Promise<string | null> {
  ensureInitialized();

  if (!isHydrated && inFlightHydration) {
    await inFlightHydration;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (
    cachedSession?.access_token &&
    typeof cachedSession.expires_at === 'number' &&
    cachedSession.expires_at - TOKEN_REFRESH_BUFFER_SEC > nowSec
  ) {
    return cachedSession.access_token;
  }

  // Token missing or approaching expiry — deduplicate refresh via Supabase client
  if (!inFlightHydration) {
    inFlightHydration = supabase.auth
      .getSession()
      .then(({ data }) => {
        cachedSession = data.session ?? null;
        isHydrated = true;
        notifyListeners();
        return cachedSession;
      })
      .catch(() => cachedSession)
      .finally(() => {
        inFlightHydration = null;
      });
  }

  const refreshed = await inFlightHydration;
  return refreshed?.access_token ?? null;
}

export function clearCachedAuthSession(): void {
  cachedSession = null;
  notifyListeners();
}
