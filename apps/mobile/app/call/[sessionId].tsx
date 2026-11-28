import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useActiveCallActions } from '../../src/features/calling/context/ActiveCallContext';

/**
 * Deep-link passthrough that launches a local voice session on the unified Home Aura canvas.
 */
export default function ActiveCallScreen() {
  const { title } = useLocalSearchParams<{ sessionId?: string; title?: string }>();
  const router = useRouter();
  const { startImmediateCall } = useActiveCallActions();

  useEffect(() => {
    void startImmediateCall({
      title: typeof title === 'string' ? title : 'Kallie Reminder',
      isScheduledCallback: true,
    });
    router.replace('/');
  }, [router, startImmediateCall, title]);

  return <View style={styles.blank} />;
}

const styles = StyleSheet.create({
  blank: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
