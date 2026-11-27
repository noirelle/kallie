import { useCallback, useEffect, useState } from 'react';
import {
  deleteScheduleLocal,
  getSchedulesSync,
  LocalCallSchedule,
  subscribeLocalSchedules,
  UpsertScheduleInput,
  upsertScheduleLocal,
} from '../lib/schedulesRepository';
import { flushSyncOutbox, syncUserData } from '../lib/syncEngine';

/**
 * Local-first React hook for scheduled calls and reminders.
 * Reads synchronously from SQLite on frame 0, supports offline optimistic CRUD,
 * and stays synchronized with Supabase in the background.
 */
export function useLocalSchedules(userId?: string) {
  const [schedules, setSchedules] = useState<LocalCallSchedule[]>(() =>
    userId ? getSchedulesSync(userId) : [],
  );
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!userId) {
      setSchedules([]);
      return;
    }

    setSchedules(getSchedulesSync(userId));
    const unsub = subscribeLocalSchedules(() => {
      setSchedules(getSchedulesSync(userId));
    });

    setSyncing(true);
    void syncUserData(userId).finally(() => setSyncing(false));

    return unsub;
  }, [userId]);

  const createOrUpdateSchedule = useCallback(
    async (input: UpsertScheduleInput): Promise<LocalCallSchedule | null> => {
      if (!userId) return null;
      const saved = upsertScheduleLocal(userId, input);
      void flushSyncOutbox(userId);
      return saved;
    },
    [userId],
  );

  const deleteSchedule = useCallback(
    async (scheduleId: string): Promise<void> => {
      if (!userId) return;
      deleteScheduleLocal(userId, scheduleId);
      void flushSyncOutbox(userId);
    },
    [userId],
  );

  const refresh = useCallback(async () => {
    if (!userId) return;
    setSyncing(true);
    try {
      await syncUserData(userId, { force: true });
    } finally {
      setSyncing(false);
    }
  }, [userId]);

  return {
    schedules,
    syncing,
    createOrUpdateSchedule,
    deleteSchedule,
    refresh,
  };
}
