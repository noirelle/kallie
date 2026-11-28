import fs from 'node:fs';
import path from 'node:path';
import {
  type AndroidManifest,
  type ConfigPlugin,
  withAndroidManifest,
  withDangerousMod,
  withMainActivity,
  withMainApplication,
} from 'expo/config-plugins';

const PACKAGE_NAME = 'com.kallie.app';
const PACKAGE_DIR = path.join('app', 'src', 'main', 'java', 'com', 'kallie', 'app');
const TEMPLATE_DIR = path.join('plugins', 'android', 'incomingCall');
const TEMPLATE_FILES = [
  'KallieCallActionReceiver.kt',
  'KallieScheduleAlarmReceiver.kt',
  'KallieCallForegroundService.kt',
  'KallieIncomingCallModule.kt',
  'KallieIncomingCallPackage.kt',
  'KallieSolarAuraView.kt',
  'KallieSolarAuraViewManager.kt',
] as const;

type ManifestApplication = NonNullable<AndroidManifest['manifest']['application']>[number];
type ManifestService = NonNullable<ManifestApplication['service']>[number];
type ExtendedManifestService = ManifestService & {
  $: ManifestService['$'] & {
    'android:stopWithTask'?: 'true' | 'false';
  };
};

function copyTemplate(src: string, dest: string): void {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing Android plugin template: ${src}`);
  }
  fs.copyFileSync(src, dest);
}

const withIncomingCallAndroid: ConfigPlugin = (config) => {
  // 1. Update AndroidManifest.xml: lock-screen flags, permissions, receiver, and microphone FGS
  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    const permissions = (manifest['uses-permission'] ??= []);

    const perms = [
      'android.permission.USE_FULL_SCREEN_INTENT',
      'android.permission.USE_EXACT_ALARM',
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.VIBRATE',
      'android.permission.WAKE_LOCK',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.RECEIVE_BOOT_COMPLETED',
    ];

    for (const perm of perms) {
      const exists = permissions.some((item) => item.$?.['android:name'] === perm);
      if (!exists) {
        permissions.push({ $: { 'android:name': perm } });
      }
    }

    const application = manifest.application?.[0];
    if (!application) return modConfig;

    const mainActivity = application.activity?.find(
      (act) =>
        act.$?.['android:name'] === '.MainActivity' ||
        act.$?.['android:name'] === `${PACKAGE_NAME}.MainActivity`,
    );
    if (mainActivity?.$) {
      mainActivity.$['android:showWhenLocked'] = 'true';
      mainActivity.$['android:turnScreenOn'] = 'true';
      mainActivity.$['android:launchMode'] = 'singleTask';
    }

    const receivers = (application.receiver ??= []);
    const receiverName = '.KallieCallActionReceiver';
    const hasReceiver = receivers.some((r) => r.$?.['android:name'] === receiverName);
    if (!hasReceiver) {
      receivers.push({
        $: {
          'android:name': receiverName,
          'android:exported': 'false',
        },
      });
    }

    const alarmReceiverName = '.KallieScheduleAlarmReceiver';
    const hasAlarmReceiver = receivers.some(
      (r) => r.$?.['android:name'] === alarmReceiverName,
    );
    if (!hasAlarmReceiver) {
      receivers.push({
        $: {
          'android:name': alarmReceiverName,
          'android:exported': 'false',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
              { $: { 'android:name': 'android.intent.action.TIMEZONE_CHANGED' } },
              { $: { 'android:name': 'android.intent.action.TIME_SET' } },
              { $: { 'android:name': 'android.intent.action.MY_PACKAGE_REPLACED' } },
            ],
          },
        ],
      });
    }

    const services: ExtendedManifestService[] = (application.service ??= []);
    const serviceName = '.KallieCallForegroundService';
    const existingService = services.find((s) => s.$?.['android:name'] === serviceName);
    if (!existingService) {
      services.push({
        $: {
          'android:name': serviceName,
          'android:exported': 'false',
          'android:foregroundServiceType': 'microphone|mediaPlayback',
          'android:stopWithTask': 'false',
        },
      });
    } else if (existingService.$) {
      existingService.$['android:foregroundServiceType'] = 'microphone|mediaPlayback';
    }

    return modConfig;
  });

  // 2. Copy Kotlin native module, package, BroadcastReceivers, and Foreground Service
  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const templatesRoot = path.join(modConfig.modRequest.projectRoot, TEMPLATE_DIR);
      const targetDir = path.join(modConfig.modRequest.platformProjectRoot, PACKAGE_DIR);
      fs.mkdirSync(targetDir, { recursive: true });

      for (const fileName of TEMPLATE_FILES) {
        copyTemplate(path.join(templatesRoot, fileName), path.join(targetDir, fileName));
      }

      return modConfig;
    },
  ]);

  // 3. Patch MainActivity.kt to allow lock-screen display & forward incoming call intents
  config = withMainActivity(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    const imports = ['import android.content.Intent', 'import android.os.Build'];
    for (const imp of imports) {
      if (!contents.includes(imp)) {
        contents = contents.replace(/^(package [^\r\n]+\r?\n)/, `$1${imp}\n`);
      }
    }

    if (!contents.includes('KallieIncomingCallModule.handleIntent')) {
      const hookSnippet = `
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    }
    KallieIncomingCallModule.handleIntent(this, intent)`;

      if (contents.includes('super.onCreate(null)')) {
        contents = contents.replace(
          'super.onCreate(null)',
          `super.onCreate(null)${hookSnippet}`,
        );
      } else if (contents.includes('super.onCreate(savedInstanceState)')) {
        contents = contents.replace(
          'super.onCreate(savedInstanceState)',
          `super.onCreate(savedInstanceState)${hookSnippet}`,
        );
      }

      if (contents.includes('override fun invokeDefaultOnBackPressed() {') && !contents.includes('KallieCallForegroundService.activeSessionId')) {
        contents = contents.replace(
          'override fun invokeDefaultOnBackPressed() {',
          `override fun invokeDefaultOnBackPressed() {\n      if (KallieCallForegroundService.activeSessionId != null) {\n          moveTaskToBack(true)\n          return\n      }`,
        );
      }

      if (!contents.includes('override fun onNewIntent(')) {
        const onNewIntentMethod = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    }
    KallieIncomingCallModule.handleIntent(this, intent)
  }
`;
        const lastBrace = contents.lastIndexOf('}');
        if (lastBrace !== -1) {
          contents =
            contents.slice(0, lastBrace) + onNewIntentMethod + contents.slice(lastBrace);
        }
      }
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });

  // 4. Register KallieIncomingCallPackage in MainApplication.kt
  config = withMainApplication(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    if (!contents.includes('KallieIncomingCallPackage()')) {
      contents = contents.replace(
        /PackageList\(this\)\.packages\.apply\s*\{/,
        'PackageList(this).packages.apply {\n              add(KallieIncomingCallPackage())',
      );
    }
    modConfig.modResults.contents = contents;
    return modConfig;
  });

  return config;
};

export default withIncomingCallAndroid;
