import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra || {}) as {
  enableAndroidFcm?: boolean;
  enableIosVoip?: boolean;
  githubRepo?: string;
};

const DEFAULT_SUPABASE_URL = 'https://jarngfflviwytnwvznps.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_j3oBK4qkMK_BY32hOYsw2A_FeN7-M0H';
const DEFAULT_API_URL = 'https://kallie.nozorin.com/api';
const DEFAULT_GITHUB_REPO = 'noirelle/kallie';

export const appEnv = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY,
  apiUrl: (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/$/, ''),
  githubRepo: process.env.EXPO_PUBLIC_GITHUB_REPO || extra.githubRepo || DEFAULT_GITHUB_REPO,
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
