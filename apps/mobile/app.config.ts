import { ConfigContext, ExpoConfig } from 'expo/config';

const githubRepo = process.env.EXPO_PUBLIC_GITHUB_REPO || 'noirelle/kallie';
const EAS_PROJECT_ID = '94c7ad06-4859-418e-a5df-a3b69b3082a8';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Kallie',
  slug: 'kallie',
  owner: 'noirelle',
  scheme: 'kallie',
  version: '0.2.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  backgroundColor: '#000000',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.kallie.app',
    infoPlist: {
      NSCameraUsageDescription:
        'Kallie uses the camera to scan Desktop Bridge QR codes for instant pairing.',
      NSMicrophoneUsageDescription:
        'Kallie needs microphone access for real-time AI voice conversations.',
      UIBackgroundModes: ['audio'],
    },
  },
  android: {
    package: 'com.kallie.app',
    backgroundColor: '#000000',
    allowBackup: false,
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
      backgroundColor: '#000000',
    },
    permissions: [
      'CAMERA',
      'RECORD_AUDIO',
      'MODIFY_AUDIO_SETTINGS',
      'BLUETOOTH_CONNECT',
      'WAKE_LOCK',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_MICROPHONE',
      'POST_NOTIFICATIONS',
      'USE_FULL_SCREEN_INTENT',
      'USE_EXACT_ALARM',
      'SCHEDULE_EXACT_ALARM',
    ],
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-sqlite',
    'expo-secure-store',
    [
      'expo-camera',
      {
        cameraPermission:
          'Kallie uses the camera to scan Desktop Bridge QR codes for instant pairing.',
        recordAudioAndroid: false,
      },
    ],
    './plugins/withAndroidOptimization',
    './plugins/withImmersiveAndroid',
    './plugins/withIncomingCallAndroid',
    './plugins/withDirectPcmAudioAndroid',
    './plugins/withPhoneControlAndroid',
  ],
  updates: {
    enabled: true,
    url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
    checkAutomatically: 'NEVER',
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: {
    policy: 'appVersion',
  },
  extra: {
    githubRepo,
    eas: {
      projectId: EAS_PROJECT_ID,
    },
  },
});
