import { Session, User } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { cacheManager } from '../../../lib/cache/cacheManager';
import {
  clearCachedAuthSession,
  getCachedAuthState,
  subscribeAuthSession,
} from '../../../lib/storage/authSessionCache';
import { purgeUserScopedDataSync } from '../../../lib/storage/localDb';
import { supabase } from '../../../lib/supabaseClient';
import { nativeIncomingCall } from '../../calling/lib/nativeIncomingCall';

export function useAuth() {
  const initial = getCachedAuthState();
  const [session, setSession] = useState<Session | null>(initial.session);
  const [loading, setLoading] = useState(!initial.hydrated);

  useEffect(() => {
    return subscribeAuthSession((nextSession, hydrated) => {
      setSession(nextSession);
      if (hydrated) {
        setLoading(false);
      }
    });
  }, []);

  const user: User | null = session?.user ?? null;

  const signOut = useCallback(async () => {
    const prevUserId = session?.user?.id;
    purgeUserScopedDataSync(prevUserId);
    cacheManager.clearMemory();
    clearCachedAuthSession();
    nativeIncomingCall.syncLocalReminderAlarms([]);
    await supabase.auth.signOut();
  }, [session?.user?.id]);

  return { session, user, loading, signOut };
}
