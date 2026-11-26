import { ConfigContext, ExpoConfig } from 'expo/config';

const enableAndroidFcm = process.env.EXPO_ENABLE_ANDROID_FCM === 'true';
const enableIosVoip = process.env.EXPO_ENABLE_IOS_VOIP === 'true';
const githubRepo = process.env.EXPO_PUBLIC_GITHUB_REPO || '';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Kallie',
  slug: 'kallie',
  scheme: 'kallie',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  backgroundColor: '#000000',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.kallie.app',
    infoPlist: {
      NSMicrophoneUsageDescription:
        'Kallie needs microphone access for real-time AI voice calls.',
      ...(enableIosVoip
        ? { UIBackgroundModes: ['audio', 'voip'] }
        : { UIBackgroundModes: ['audio'] }),
    },
  },
  android: {
    package: 'com.kallie.app',
    backgroundColor: '#000000',
    permissions: [
      'RECORD_AUDIO',
      'MODIFY_AUDIO_SETTINGS',
      'BLUETOOTH_CONNECT',
      'WAKE_LOCK',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_MICROPHONE',
      ...(enableAndroidFcm
        ? [
            'USE_FULL_SCREEN_INTENT',
            'FOREGROUND_SERVICE_PHONE_CALL',
            'POST_NOTIFICATIONS',
            'READ_PHONE_NUMBERS',
            'CALL_PHONE',
          ]
        : []),
    ],
    ...(enableAndroidFcm ? { googleServicesFile: './google-services.json' } : {}),
  },
  web: {
    bundler: 'metro',
    output: 'single',
  },
  plugins: [
    'expo-router',
    '@livekit/react-native-expo-plugin',
    '@config-plugins/react-native-webrtc',
    ...(enableAndroidFcm ? ['@react-native-firebase/app'] : []),
  ],
  updates: {
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: {
    policy: 'appVersion',
  },
  extra: {
    enableAndroidFcm,
    enableIosVoip,
    githubRepo,
  },
});
