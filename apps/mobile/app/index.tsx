import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/features/auth/hooks/useAuth';
import { AgentAuraVisualizer } from '../src/features/calling/components/AgentAuraVisualizer';
import { apiClient } from '../src/lib/apiClient';
import { setPendingCallConnection } from '../src/lib/callSessionStore';
import { supabase } from '../src/lib/supabaseClient';
import { CallSchedule } from '../src/types/database';

export default function HomeScreen() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<CallSchedule[]>([]);

  const loadUpcoming = useCallback(async () => {
    if (!user?.id) {
      setUpcoming([]);
      return;
    }
    const { data } = await supabase
      .from('call_schedules')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('next_run_at', { ascending: true })
      .limit(3);

    setUpcoming((data || []) as CallSchedule[]);
  }, [user?.id]);

  useEffect(() => {
    void loadUpcoming();
    if (!user?.id) return;

    const channel = supabase
      .channel(`mobile-upcoming-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'call_schedules',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void loadUpcoming();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadUpcoming, user?.id]);

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
      setError(err instanceof Error ? err.message : 'Unable to connect to Kallie');
    } finally {
      setStarting(false);
    }
  };

  if (loading || !user) {
    return <View style={styles.container} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Top breathing space reserved for the floating Dynamic Island pill */}
      <View style={styles.topClearance} />

      <View style={styles.center}>
        <Pressable
          onPress={handleStartCall}
          disabled={starting}
          style={({ pressed }) => [
            styles.auraTouch,
            pressed && !starting && styles.auraPressed,
          ]}
          accessibilityLabel="Start call with Kallie"
        >
          <AgentAuraVisualizer
            state={starting ? 'connecting' : 'listening'}
            audioLevel={starting ? 0.55 : 0.16}
            size="lg"
          />
        </Pressable>

        <Text style={styles.heading}>
          {starting ? 'Connecting to Kallie...' : 'Talk with Kallie'}
        </Text>
        <Text style={styles.subtitle}>
          Tap Aura to start a live voice session
        </Text>

        <Pressable
          style={({ pressed }) => [
            styles.startBtn,
            starting && styles.startBtnDisabled,
            pressed && !starting && styles.startBtnPressed,
          ]}
          onPress={handleStartCall}
          disabled={starting}
        >
          <Text style={styles.startBtnText}>
            {starting ? 'Connecting...' : 'Start call'}
          </Text>
        </Pressable>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {upcoming.length > 0 ? (
          <View style={styles.upcomingBlock}>
            <Text style={styles.upcomingLabel}>Upcoming</Text>
            {upcoming.map((item) => (
              <View key={item.id} style={styles.reminderPill}>
                <Text style={styles.reminderTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.reminderTime}>
                  {item.next_run_at
                    ? new Date(item.next_run_at).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : ''}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerHint}>
          Ask by voice to schedule callbacks or reminders.
        </Text>
        <Pressable onPress={signOut} hitSlop={10}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  topClearance: {
    height: 48,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  auraTouch: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  auraPressed: {
    transform: [{ scale: 0.96 }],
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  subtitle: {
    color: '#71717A',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  startBtn: {
    marginTop: 28,
    width: '100%',
    maxWidth: 260,
    height: 54,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnPressed: {
    backgroundColor: '#E4E4E7',
  },
  startBtnDisabled: {
    opacity: 0.6,
  },
  startBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
  },
  errorText: {
    color: '#F87171',
    fontSize: 13,
    marginTop: 14,
    textAlign: 'center',
  },
  upcomingBlock: {
    marginTop: 28,
    width: '100%',
    maxWidth: 320,
    gap: 8,
  },
  upcomingLabel: {
    color: '#71717A',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 2,
  },
  reminderPill: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0A0A0D',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  reminderTitle: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  reminderTime: {
    color: '#1FD5F9',
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  footer: {
    alignItems: 'center',
    gap: 12,
  },
  footerHint: {
    color: '#52525B',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  signOut: {
    color: '#71717A',
    fontSize: 13,
    fontWeight: '500',
  },
});
