import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra || {}) as {
  githubRepo?: string;
};

const DEFAULT_GITHUB_REPO = 'noirelle/kallie';

export const appEnv = {
  githubRepo: process.env.EXPO_PUBLIC_GITHUB_REPO || extra.githubRepo || DEFAULT_GITHUB_REPO,
};
