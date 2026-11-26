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
      setError('Enter a valid email and a password of at least 6 characters.');
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
          setInfo('Check your inbox to confirm your account, then sign in.');
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
          <View style={styles.topMark}>
            <Image
              source={require('../../../../assets/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          <View style={styles.content}>
            <Text style={styles.eyebrow}>KALLIE / VOICE</Text>
            <Text style={styles.heading}>
              {isLogin ? 'Sign in to\nKallie.' : 'Create your\naccount.'}
            </Text>
            <Text style={styles.subtitle}>
              {isLogin
                ? 'Your AI voice companion that calls you back on schedule.'
                : 'Start talking live and scheduling voice callbacks.'}
            </Text>

            <View style={styles.form}>
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>EMAIL</Text>
                <TextInput
                  style={[
                    styles.input,
                    focusedField === 'email' && styles.inputFocused,
                  ]}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                  placeholder="name@domain.com"
                  placeholderTextColor="#52525B"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  returnKeyType="next"
                />
              </View>

              <View style={styles.fieldGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>PASSWORD</Text>
                  <Pressable
                    onPress={() => setShowPassword((prev) => !prev)}
                    hitSlop={8}
                  >
                    <Text style={styles.toggleSecret}>
                      {showPassword ? 'HIDE' : 'SHOW'}
                    </Text>
                  </Pressable>
                </View>
                <TextInput
                  style={[
                    styles.input,
                    focusedField === 'password' && styles.inputFocused,
                  ]}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  placeholder="Minimum 6 characters"
                  placeholderTextColor="#52525B"
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
              </View>

              {error ? (
                <View style={styles.feedbackBoxError}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {info ? (
                <View style={styles.feedbackBoxInfo}>
                  <Text style={styles.infoText}>{info}</Text>
                </View>
              ) : null}

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
                    {isLogin ? 'SIGN IN' : 'CREATE ACCOUNT'}
                  </Text>
                )}
              </Pressable>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>OR</Text>
                <View style={styles.dividerLine} />
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  pressed && styles.secondaryBtnPressed,
                ]}
                onPress={onSwitchMode}
              >
                <Text style={styles.secondaryBtnText}>
                  {isLogin ? 'CREATE AN ACCOUNT' : 'SIGN IN INSTEAD'}
                </Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.footerText}>PURE DARK · VOICE FIRST</Text>
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
    paddingHorizontal: 28,
    paddingTop: 18,
    paddingBottom: 24,
  },
  topMark: {
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  logo: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  content: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  eyebrow: {
    color: '#71717A',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.4,
    marginBottom: 10,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.8,
    lineHeight: 40,
  },
  subtitle: {
    color: '#A1A1AA',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 12,
    marginBottom: 32,
  },
  form: {
    gap: 18,
  },
  fieldGroup: {
    gap: 8,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    color: '#71717A',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
  },
  toggleSecret: {
    color: '#A1A1AA',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  input: {
    backgroundColor: '#050505',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: '#FFFFFF',
    fontSize: 15,
  },
  inputFocused: {
    borderColor: '#FFFFFF',
    backgroundColor: '#0A0A0A',
  },
  feedbackBoxError: {
    borderLeftWidth: 2,
    borderLeftColor: '#EF4444',
    backgroundColor: '#120505',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 12,
    lineHeight: 18,
  },
  feedbackBoxInfo: {
    borderLeftWidth: 2,
    borderLeftColor: '#FFFFFF',
    backgroundColor: '#0A0A0A',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  infoText: {
    color: '#E4E4E7',
    fontSize: 12,
    lineHeight: 18,
  },
  primaryBtn: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
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
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 2,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  dividerText: {
    color: '#52525B',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.24)',
    backgroundColor: '#000000',
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnPressed: {
    borderColor: '#FFFFFF',
    backgroundColor: '#0A0A0A',
  },
  secondaryBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.8,
  },
  footerText: {
    color: '#3F3F46',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.2,
    textAlign: 'center',
    marginTop: 32,
  },
});
