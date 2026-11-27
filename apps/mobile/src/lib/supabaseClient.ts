import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { appEnv } from './env';
import { secureAuthStorage } from './storage/secureAuthStorage';

export const supabase = createClient(
  appEnv.supabaseUrl || 'https://placeholder.supabase.co',
  appEnv.supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      storage: Platform.OS === 'web' ? undefined : secureAuthStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  },
);
