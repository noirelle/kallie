import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../src/features/auth/hooks/useAuth';
import { AgentAuraVisualizer } from '../src/features/calling/components/AgentAuraVisualizer';
import { apiClient } from '../src/lib/apiClient';
import { setPendingCallConnection } from '../src/lib/callSessionStore';

/**
 * Pure black (#000000), zero-clutter voice home screen.
 * The Aura ring itself serves as the sole visual centerpiece and interactive
 * trigger — tapping it shifts directly from idle to connecting into a call.
 */
export default function HomeScreen() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStartCall = async () => {
    if (starting) return;
    setError(null);
    setStarting(true);
    try {
      const joinData = await apiClient.createTestCall({
        title: 'Call with Kallie',
      });
      setPendingCallConnection(joinData);
      router.push(`/call/${joinData.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to connect');
    } finally {
      setStarting(false);
    }
  };

  if (loading || !user) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <Pressable
        onPress={handleStartCall}
        disabled={starting}
        style={({ pressed }) => [
          styles.auraTouch,
          pressed && !starting && styles.auraPressed,
        ]}
        accessibilityLabel="Start voice session with Kallie"
      >
        <AgentAuraVisualizer
          state={starting ? 'connecting' : 'idle'}
          audioLevel={starting ? 0.52 : 0.1}
          size="lg"
        />
      </Pressable>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  auraTouch: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  auraPressed: {
    transform: [{ scale: 0.95 }],
  },
  errorText: {
    position: 'absolute',
    bottom: 40,
    color: '#F87171',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
