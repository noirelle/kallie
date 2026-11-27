import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import {
  PermissionManagerScreen,
  PermissionRedirectReason,
} from '../src/features/permissions/components/PermissionManagerScreen';

const VALID_REASONS = new Set<PermissionRedirectReason>([
  'call_microphone',
  'incoming_call',
  'revoked',
  'settings',
]);

export default function PermissionsRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ reason?: string }>();
  const rawReason = typeof params.reason === 'string' ? params.reason : undefined;
  const reason =
    rawReason && VALID_REASONS.has(rawReason as PermissionRedirectReason)
      ? (rawReason as PermissionRedirectReason)
      : undefined;

  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, [router]);

  return <PermissionManagerScreen reason={reason} onClose={handleClose} />;
}
