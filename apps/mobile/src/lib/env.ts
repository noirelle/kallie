import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra || {}) as {
  enableAndroidFcm?: boolean;
  enableIosVoip?: boolean;
  githubRepo?: string;
};

export const appEnv = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
  apiUrl: (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, ''),
  githubRepo: process.env.EXPO_PUBLIC_GITHUB_REPO || extra.githubRepo || '',
  enableAndroidFcm: Boolean(extra.enableAndroidFcm),
  enableIosVoip: Boolean(extra.enableIosVoip),
};

export function isSupabaseConfigured(): boolean {
  return Boolean(
    appEnv.supabaseUrl &&
      appEnv.supabaseAnonKey &&
      !appEnv.supabaseUrl.includes('your-project-ref'),
  );
}
