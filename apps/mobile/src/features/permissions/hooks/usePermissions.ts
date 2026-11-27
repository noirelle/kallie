import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import {
  PERMISSION_DESCRIPTORS,
  PermissionId,
  permissionManager,
  PermissionSnapshot,
  SUPPORTS_FULL_SCREEN_INTENT_TOGGLE,
} from '../lib/permissionManager';

export function usePermissions(options?: { syncOnResume?: boolean }) {
  const syncOnResume = options?.syncOnResume ?? false;
  const [snapshot, setSnapshot] = useState<PermissionSnapshot>(() =>
    permissionManager.getSnapshot(),
  );

  useEffect(() => {
    return permissionManager.subscribe(setSnapshot);
  }, []);

  useEffect(() => {
    if (!syncOnResume) return;

    void permissionManager.refreshAll();
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void permissionManager.refreshAll();
      }
    });
    return () => sub.remove();
  }, [syncOnResume]);

  const togglePermission = useCallback(async (id: PermissionId) => {
    return permissionManager.requestPermission(id, {
      openSettingsIfGranted: true,
    });
  }, []);

  const openSettings = useCallback(async (id?: PermissionId) => {
    await permissionManager.openSystemSettings(id);
  }, []);

  const refreshPermissions = useCallback(async () => {
    return permissionManager.refreshAll();
  }, []);

  const derived = useMemo(() => {
    const permissions = {
      microphone: snapshot.statuses.microphone === 'granted',
      notifications: snapshot.statuses.notifications === 'granted',
      fullScreenIntent:
        !SUPPORTS_FULL_SCREEN_INTENT_TOGGLE ||
        snapshot.statuses.fullScreenIntent === 'granted',
      camera: snapshot.statuses.camera === 'granted',
    };

    const requiredDescriptors = PERMISSION_DESCRIPTORS.filter(
      (d) => d.supported && d.required,
    );
    const optionalDescriptors = PERMISSION_DESCRIPTORS.filter(
      (d) => d.supported && !d.required,
    );

    const missingRequired = requiredDescriptors.filter(
      (d) => snapshot.statuses[d.id] !== 'granted',
    );
    const revokedPermissions = PERMISSION_DESCRIPTORS.filter(
      (d) => d.supported && snapshot.meta[d.id].revoked,
    );

    return {
      permissions,
      requiredDescriptors,
      optionalDescriptors,
      allRequiredGranted: missingRequired.length === 0,
      allRecommendedGranted:
        permissions.microphone &&
        permissions.notifications &&
        permissions.fullScreenIntent,
      missingRequired,
      revokedPermissions,
    };
  }, [snapshot]);

  return {
    hydrated: snapshot.hydrated,
    statuses: snapshot.statuses,
    meta: snapshot.meta,
    busyKey: snapshot.busyKey,
    supportsFullScreenIntentToggle: SUPPORTS_FULL_SCREEN_INTENT_TOGGLE,
    ...derived,
    togglePermission,
    openSettings,
    refreshPermissions,
  };
}
