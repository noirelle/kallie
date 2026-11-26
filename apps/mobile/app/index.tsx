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
        <View style={styles.statusPill}>
          <View style={styles.statusDot} />
          <Text style={styles.brand}>Kallie</Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.signOutBtn, pressed && styles.signOutBtnPressed]}
          onPress={signOut}
          hitSlop={8}
        >
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <View style={styles.center}>
        <View style={styles.emblemOuter}>
          <View style={styles.emblemInner}>
            <Image
              source={require('../assets/icon.png')}
              style={styles.heroLogo}
              resizeMode="contain"
            />
          </View>
        </View>

        <Text style={styles.heading}>Ready to talk</Text>
        <Text style={styles.subheading}>Tap below to start a live call</Text>

        <Pressable
          style={({ pressed }) => [
            styles.startBtn,
            starting && styles.startBtnDisabled,
            pressed && !starting && styles.startBtnPressed,
          ]}
          onPress={handleStartCall}
          disabled={starting}
        >
          <Text style={styles.startBtnText}>{starting ? 'Connecting...' : 'Start call'}</Text>
        </Pressable>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {upcoming.length > 0 ? (
          <View style={styles.upcomingCard}>
            <Text style={styles.upcomingLabel}>Upcoming</Text>
            {upcoming.map((item, idx) => (
              <View key={item.id}>
                {idx > 0 ? <View style={styles.upcomingDivider} /> : null}
                <View style={styles.upcomingRow}>
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
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <Text style={styles.footerHint}>Ask by voice to schedule callbacks</Text>
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
    paddingTop: 10,
    paddingBottom: 8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  brand: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  signOutBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  signOutBtnPressed: {
    backgroundColor: '#111111',
  },
  signOut: {
    color: '#71717A',
    fontSize: 13,
    fontWeight: '500',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
  },
  emblemOuter: {
    width: 108,
    height: 108,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  emblemInner: {
    width: 82,
    height: 82,
    borderRadius: 24,
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroLogo: {
    width: 54,
    height: 54,
    borderRadius: 12,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subheading: {
    color: '#71717A',
    fontSize: 14,
    marginTop: 6,
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
    transform: [{ scale: 0.99 }],
  },
  startBtnDisabled: {
    opacity: 0.55,
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
  upcomingCard: {
    marginTop: 32,
    width: '100%',
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  upcomingLabel: {
    color: '#71717A',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 10,
  },
  upcomingDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  upcomingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  reminderTitle: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  reminderTime: {
    color: '#A1A1AA',
    fontSize: 13,
  },
  footerHint: {
    color: '#52525B',
    fontSize: 12,
    textAlign: 'center',
  },
});
