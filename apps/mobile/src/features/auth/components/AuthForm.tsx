import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.main}>
            <View style={styles.logoFrame}>
              <Image
                source={require('../../../../assets/icon.png')}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>

            <Text style={styles.heading}>
              {isLogin ? 'Sign in to Kallie' : 'Create account'}
            </Text>
            <Text style={styles.subtitle}>
              {isLogin ? 'Voice companion on your schedule' : 'Get started in seconds'}
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
            </View>
          </View>

          <View style={styles.bottomSection}>
            <View style={styles.divider} />
            <Pressable
              style={({ pressed }) => [
                styles.secondaryBtn,
                pressed && styles.secondaryBtnPressed,
              ]}
              onPress={onSwitchMode}
            >
              <Text style={styles.secondaryBtnText}>
                {isLogin ? 'Create new account' : 'Sign in instead'}
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
    paddingBottom: 20,
  },
  main: {
    flex: 1,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    paddingBottom: 24,
  },
  logoFrame: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#0B0B0B',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 22,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    color: '#71717A',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 30,
  },
  form: {
    gap: 12,
  },
  pillInput: {
    backgroundColor: '#0D0D0D',
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
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 999,
    paddingLeft: 20,
    paddingRight: 18,
    height: 54,
  },
  passwordInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    height: '100%',
  },
  pillInputFocused: {
    borderColor: 'rgba(255, 255, 255, 0.38)',
    backgroundColor: '#131313',
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
    paddingHorizontal: 10,
    marginTop: 2,
  },
  infoText: {
    color: '#E4E4E7',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 10,
    marginTop: 2,
  },
  primaryBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryBtnPressed: {
    backgroundColor: '#E4E4E7',
    transform: [{ scale: 0.99 }],
  },
  btnDisabled: {
    opacity: 0.55,
  },
  primaryBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
  },
  bottomSection: {
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    gap: 16,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 999,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnPressed: {
    backgroundColor: '#0E0E0E',
  },
  secondaryBtnText: {
    color: '#E4E4E7',
    fontSize: 14,
    fontWeight: '500',
  },
});
