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
            <Image
              source={require('../../../../assets/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />

            <Text style={styles.heading}>
              {isLogin ? 'Sign in to Kallie' : 'Create account'}
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

          <Pressable
            style={({ pressed }) => [
              styles.secondaryBtn,
              pressed && styles.secondaryBtnPressed,
            ]}
            onPress={onSwitchMode}
          >
            <Text style={styles.secondaryBtnText}>
              {isLogin ? 'Create new account' : 'Already have an account? Log in'}
            </Text>
          </Pressable>
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
    paddingTop: 32,
    paddingBottom: 24,
  },
  main: {
    flex: 1,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignSelf: 'center',
    marginBottom: 22,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginBottom: 28,
  },
  form: {
    gap: 12,
  },
  pillInput: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    paddingHorizontal: 20,
    height: 52,
    color: '#FFFFFF',
    fontSize: 15,
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    paddingLeft: 20,
    paddingRight: 16,
    height: 52,
  },
  passwordInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    height: '100%',
  },
  pillInputFocused: {
    borderColor: 'rgba(255, 255, 255, 0.45)',
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
    marginTop: 2,
  },
  infoText: {
    color: '#E4E4E7',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 8,
    marginTop: 2,
  },
  primaryBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
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
  secondaryBtn: {
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 999,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  secondaryBtnPressed: {
    backgroundColor: '#111111',
  },
  secondaryBtnText: {
    color: '#E4E4E7',
    fontSize: 14,
    fontWeight: '500',
  },
});
