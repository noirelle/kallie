import { useRouter } from 'expo-router';
import React from 'react';
import { AuthForm } from '../../src/features/auth/components/AuthForm';

export default function RegisterScreen() {
  const router = useRouter();
  return <AuthForm mode="register" onSwitchMode={() => router.replace('/(auth)/login')} />;
}
