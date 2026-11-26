const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Registers react-native-callkeep Android services and Telecom permissions in AndroidManifest.xml.
 * Without VoiceConnectionService guarded by BIND_TELECOM_CONNECTION_SERVICE, Android TelecomManager
 * throws a fatal SecurityException inside RNCallKeepModule.setup() as soon as the user signs in.
 */
function withCallKeepAndroid(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;

    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }

    const requiredPermissions = [
      'android.permission.BIND_TELECOM_CONNECTION_SERVICE',
      'android.permission.MANAGE_OWN_CALLS',
      'android.permission.FOREGROUND_SERVICE_PHONE_CALL',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
    ];

    for (const perm of requiredPermissions) {
      const exists = manifest['uses-permission'].some(
        (item) => item.$?.['android:name'] === perm,
      );
      if (!exists) {
        manifest['uses-permission'].push({
          $: { 'android:name': perm },
        });
      }
    }

    const application = manifest.application?.[0];
    if (!application) {
      return modConfig;
    }

    if (!application.service) {
      application.service = [];
    }

    const voiceServiceName = 'io.wazo.callkeep.VoiceConnectionService';
    const hasVoiceService = application.service.some(
      (svc) => svc.$?.['android:name'] === voiceServiceName,
    );

    if (!hasVoiceService) {
      application.service.push({
        $: {
          'android:name': voiceServiceName,
          'android:label': 'Kallie',
          'android:permission': 'android.permission.BIND_TELECOM_CONNECTION_SERVICE',
          'android:exported': 'true',
          'android:foregroundServiceType': 'phoneCall|microphone',
        },
        'intent-filter': [
          {
            action: [
              {
                $: { 'android:name': 'android.telecom.ConnectionService' },
              },
            ],
          },
        ],
      });
    }

    const bgServiceName = 'io.wazo.callkeep.RNCallKeepBackgroundMessagingService';
    const hasBgService = application.service.some(
      (svc) => svc.$?.['android:name'] === bgServiceName,
    );

    if (!hasBgService) {
      application.service.push({
        $: {
          'android:name': bgServiceName,
          'android:exported': 'false',
        },
      });
    }

    return modConfig;
  });
}

module.exports = withCallKeepAndroid;
