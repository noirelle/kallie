import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useActiveCall } from '../../src/features/calling/context/ActiveCallContext';

/**
 * Deep-link / legacy call route passthrough.
 * Immediately hands off to the singleton ActiveCallContext and replaces to '/'
 * so all voice calls share one unified full-screen Aura canvas with zero duplicate rooms.
 */
export default function ActiveCallScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const { joinSessionById } = useActiveCall();

  useEffect(() => {
    if (sessionId) {
      void joinSessionById(sessionId);
    }
    router.replace('/');
  }, [joinSessionById, router, sessionId]);

  return <View style={styles.blank} />;
}

const styles = StyleSheet.create({
  blank: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
