import fs from 'node:fs';
import path from 'node:path';
import {
  type AndroidManifest,
  type ConfigPlugin,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} from 'expo/config-plugins';

const PACKAGE_DIR = path.join('app', 'src', 'main', 'java', 'com', 'kallie', 'app');
const RES_XML_DIR = path.join('app', 'src', 'main', 'res', 'xml');
const RES_VALUES_DIR = path.join('app', 'src', 'main', 'res', 'values');
const TEMPLATE_DIR = path.join('plugins', 'android', 'phoneControl');

const KOTLIN_TEMPLATE_FILES = [
  'KallieNotchOverlayController.kt',
  'KallieAccessibilityService.kt',
  'KallieNotificationListener.kt',
  'KalliePhoneControlModule.kt',
  'KalliePhoneControlPackage.kt',
] as const;

type ManifestApplication = NonNullable<AndroidManifest['manifest']['application']>[number];
type ManifestService = NonNullable<ManifestApplication['service']>[number];
type ManifestMetaData = NonNullable<ManifestApplication['meta-data']>[number];
type ExtendedManifestService = ManifestService & {
  $: ManifestService['$'] & {
    'android:label'?: string;
  };
  'meta-data'?: ManifestMetaData[];
};

function copyTemplate(src: string, dest: string): void {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing Android plugin template: ${src}`);
  }
  fs.copyFileSync(src, dest);
}

const withPhoneControlAndroid: ConfigPlugin = (config) => {
  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;

    // 1. Add QUERY_ALL_PACKAGES & SYSTEM_ALERT_WINDOW fallback permissions
    const permissions = (manifest['uses-permission'] ??= []);
    const neededPermissions = [
      'android.permission.QUERY_ALL_PACKAGES',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ];
    for (const perm of neededPermissions) {
      const exists = permissions.some((p) => p?.$?.['android:name'] === perm);
      if (!exists) {
        permissions.push({ $: { 'android:name': perm } });
      }
    }

    // 2. Register AccessibilityService & NotificationListenerService
    const application = manifest.application?.[0];
    if (!application) return modConfig;
    const services: ExtendedManifestService[] = (application.service ??= []);

    const a11yServiceName = '.KallieAccessibilityService';
    if (!services.some((s) => s?.$?.['android:name'] === a11yServiceName)) {
      services.push({
        $: {
          'android:name': a11yServiceName,
          'android:label': 'Kallie',
          'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
          'android:exported': 'false',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.accessibilityservice.AccessibilityService',
                },
              },
            ],
          },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.accessibilityservice',
              'android:resource': '@xml/kallie_accessibility_service',
            },
          },
        ],
      });
    }

    const notifServiceName = '.KallieNotificationListener';
    if (!services.some((s) => s?.$?.['android:name'] === notifServiceName)) {
      services.push({
        $: {
          'android:name': notifServiceName,
          'android:label': '@string/kallie_notification_listener_label',
          'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
          'android:exported': 'false',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.service.notification.NotificationListenerService',
                },
              },
            ],
          },
        ],
      });
    }

    return modConfig;
  });

  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const templatesRoot = path.join(modConfig.modRequest.projectRoot, TEMPLATE_DIR);
      const root = modConfig.modRequest.platformProjectRoot;
      const pkgDir = path.join(root, PACKAGE_DIR);
      const xmlDir = path.join(root, RES_XML_DIR);
      const valuesDir = path.join(root, RES_VALUES_DIR);

      fs.mkdirSync(pkgDir, { recursive: true });
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.mkdirSync(valuesDir, { recursive: true });

      copyTemplate(
        path.join(templatesRoot, 'res', 'xml', 'kallie_accessibility_service.xml'),
        path.join(xmlDir, 'kallie_accessibility_service.xml'),
      );
      copyTemplate(
        path.join(templatesRoot, 'res', 'values', 'kallie_phone_control.xml'),
        path.join(valuesDir, 'kallie_phone_control.xml'),
      );

      for (const fileName of KOTLIN_TEMPLATE_FILES) {
        copyTemplate(path.join(templatesRoot, fileName), path.join(pkgDir, fileName));
      }

      return modConfig;
    },
  ]);

  config = withMainApplication(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    if (!contents.includes('KalliePhoneControlPackage()')) {
      contents = contents.replace(
        /PackageList\(this\)\.packages\.apply\s*\{/,
        'PackageList(this).packages.apply {\n              add(KalliePhoneControlPackage())',
      );
    }
    modConfig.modResults.contents = contents;
    return modConfig;
  });

  return config;
};

export default withPhoneControlAndroid;
