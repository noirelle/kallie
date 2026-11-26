import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/features/auth/hooks/useAuth';
import { apiClient } from '../src/lib/apiClient';
import { setPendingCallConnection } from '../src/lib/callSessionStore';
import { supabase } from '../src/lib/supabaseClient';
import { CallSchedule } from '../src/types/database';

export default function HomeScreen() {
  const { user, signOut } = useAuth();
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Image
            source={require('../assets/icon.png')}
            style={styles.headerLogo}
            resizeMode="contain"
          />
          <Text style={styles.brand}>Kallie</Text>
        </View>
        <Pressable onPress={signOut} hitSlop={8}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <View style={styles.center}>
        <Image
          source={require('../assets/icon.png')}
          style={styles.heroLogo}
          resizeMode="contain"
        />
        <Text style={styles.heading}>Talk with Kallie</Text>

        <Pressable
          style={({ pressed }) => [
            styles.startBtn,
            starting && styles.startBtnDisabled,
            pressed && !starting && styles.startBtnPressed,
          ]}
          onPress={handleStartCall}
          disabled={starting}
        >
          <Text style={styles.startBtnText}>{starting ? 'Starting...' : 'Start call'}</Text>
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

      <Text style={styles.footerHint}>
        Ask by voice to schedule callbacks or reminders.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  brand: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '600',
  },
  signOut: {
    color: '#A1A1AA',
    fontSize: 14,
    fontWeight: '500',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerLogo: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  heroLogo: {
    width: 72,
    height: 72,
    borderRadius: 18,
    marginBottom: 18,
  },
  heading: {
    color: '#FAFAFA',
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  startBtn: {
    marginTop: 24,
    width: 220,
    height: 52,
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
    marginTop: 32,
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
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 12,
  },
  reminderTitle: {
    color: '#FAFAFA',
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  reminderTime: {
    color: '#A1A1AA',
    fontSize: 11,
  },
  footerHint: {
    color: '#71717A',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
});
