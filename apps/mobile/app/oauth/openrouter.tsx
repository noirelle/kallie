import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckIcon, CloseIcon } from '../../src/components/MonoIcons';
import { FadeSlideView } from '../../src/components/MonoUi';
import { completeOpenRouterOAuth } from '../../src/features/ai/lib/openRouterAuth';
import { markLocalOnboardingComplete } from '../../src/features/onboarding/hooks/useOnboardingPermissions';
import { MONO, RADIUS, TYPE } from '../../src/theme/monoTheme';

type OAuthState = 'exchanging' | 'success' | 'error';

export default function OpenRouterOAuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code || '';

  const [state, setState] = useState<OAuthState>('exchanging');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await completeOpenRouterOAuth(code);
        if (!active) return;
        await markLocalOnboardingComplete();
        setState('success');
        setDetail(res.model);
      } catch (err) {
        if (!active) return;
        setState('error');
        setDetail(err instanceof Error ? err.message : 'Sign-in failed');
      }
    })();

    return () => {
      active = false;
    };
  }, [code]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <FadeSlideView style={styles.inner}>
        <View style={styles.circle}>
          {state === 'exchanging' ? (
            <ActivityIndicator size="small" color={MONO.white} />
          ) : state === 'success' ? (
            <CheckIcon color={MONO.white} size={24} />
          ) : (
            <CloseIcon color={MONO.white} size={22} />
          )}
        </View>

        <Text style={styles.title}>
          {state === 'exchanging'
            ? 'Connecting'
            : state === 'success'
              ? 'Connected'
              : 'Failed'}
        </Text>

        {detail ? <Text style={styles.detail}>{detail}</Text> : null}

        {state !== 'exchanging' ? (
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
            onPress={() => router.replace(state === 'success' ? '/' : '/settings')}
          >
            <Text style={styles.primaryBtnText}>
              {state === 'success' ? 'Continue' : 'Settings'}
            </Text>
          </Pressable>
        ) : null}
      </FadeSlideView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MONO.bg,
    justifyContent: 'center',
    padding: 28,
  },
  inner: {
    alignItems: 'center',
    gap: 16,
  },
  circle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...TYPE.title, color: MONO.white },
  detail: { ...TYPE.mono, color: MONO.textSecondary, textAlign: 'center', maxWidth: 280 },
  primaryBtn: {
    marginTop: 8,
    width: '100%',
    maxWidth: 240,
    backgroundColor: MONO.white,
    borderRadius: RADIUS.pill,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { ...TYPE.button, color: MONO.black },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
});
