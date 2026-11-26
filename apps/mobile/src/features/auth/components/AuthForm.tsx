import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KallieAvatarBadge } from '../../../components/KallieAvatarBadge';
import { isSupabaseConfigured } from '../../../lib/env';
import { supabase } from '../../../lib/supabaseClient';

interface AuthFormProps {
  mode: 'login' | 'register';
  onSwitchMode: () => void;
}

export function AuthForm({ mode, onSwitchMode }: AuthFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<'email' | 'password' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isLogin = mode === 'login';

  const handleSubmit = async () => {
    setError(null);
    setInfo(null);

    if (!isSupabaseConfigured()) {
      setError('Supabase configuration is missing.');
      return;
    }

    if (!email.trim() || password.length < 6) {
      setError('Enter your email and a password of at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      if (isLogin) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) setError(signInError.message);
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) {
          setError(signUpError.message);
        } else if (!data.session) {
          setInfo('Check your email to confirm your account.');
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.main}>
            <View style={styles.heroWrap}>
              <KallieAvatarBadge size="md" />
            </View>

            <Text style={styles.heading}>
              {isLogin ? 'Welcome back' : 'Create account'}
            </Text>
            <Text style={styles.subtitle}>
              {isLogin
                ? 'Sign in to continue with Kallie'
                : 'Start talking with Kallie in seconds'}
            </Text>

            <View style={styles.form}>
              <TextInput
                style={[styles.pillInput, focusedField === 'email' && styles.pillInputFocused]}
                value={email}
                onChangeText={setEmail}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                placeholder="Email"
                placeholderTextColor="#71717A"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
              />

              <View
                style={[
                  styles.passwordWrap,
                  focusedField === 'password' && styles.pillInputFocused,
                ]}
              >
                <TextInput
                  style={styles.passwordInput}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  placeholder="Password"
                  placeholderTextColor="#71717A"
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
                <Pressable
                  onPress={() => setShowPassword((prev) => !prev)}
                  hitSlop={10}
                  style={styles.showBtn}
                >
                  <Text style={styles.showBtnText}>{showPassword ? 'Hide' : 'Show'}</Text>
                </Pressable>
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {info ? <Text style={styles.infoText}>{info}</Text> : null}
            </View>
          </View>

          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                submitting && styles.btnDisabled,
                pressed && !submitting && styles.primaryBtnPressed,
              ]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#000000" size="small" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {isLogin ? 'Log in' : 'Sign up'}
                </Text>
              )}
            </Pressable>

            <Pressable
              style={styles.switchRow}
              onPress={onSwitchMode}
              hitSlop={10}
            >
              <Text style={styles.switchMuted}>
                {isLogin ? "Don't have an account? " : 'Already have an account? '}
              </Text>
              <Text style={styles.switchAccent}>
                {isLogin ? 'Sign up' : 'Log in'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000000',
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
  },
  main: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
  },
  heroWrap: {
    marginBottom: 26,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 31,
    fontWeight: '700',
    letterSpacing: -0.7,
    lineHeight: 37,
    textAlign: 'center',
  },
  subtitle: {
    color: '#71717A',
    fontSize: 14,
    marginTop: 10,
    marginBottom: 30,
    textAlign: 'center',
    lineHeight: 20,
  },
  form: {
    width: '100%',
    gap: 12,
  },
  pillInput: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 999,
    paddingHorizontal: 20,
    height: 54,
    color: '#FFFFFF',
    fontSize: 15,
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 999,
    paddingLeft: 20,
    paddingRight: 16,
    height: 54,
  },
  passwordInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    height: '100%',
  },
  pillInputFocused: {
    borderColor: 'rgba(255, 255, 255, 0.4)',
    backgroundColor: '#161616',
  },
  showBtn: {
    paddingLeft: 10,
  },
  showBtnText: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '500',
  },
  errorText: {
    color: '#F87171',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 8,
    marginTop: 4,
  },
  infoText: {
    color: '#E4E4E7',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 8,
    marginTop: 4,
  },
  footer: {
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    gap: 16,
    paddingTop: 24,
  },
  primaryBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnPressed: {
    backgroundColor: '#E4E4E7',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
  },
  switchRow: {
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchMuted: {
    color: '#71717A',
    fontSize: 13,
  },
  switchAccent: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
