import { useRouter } from 'expo-router';
import React from 'react';
import { AuthForm } from '../../src/features/auth/components/AuthForm';

export default function LoginScreen() {
  const router = useRouter();
  return <AuthForm mode="login" onSwitchMode={() => router.replace('/(auth)/register')} />;
}
