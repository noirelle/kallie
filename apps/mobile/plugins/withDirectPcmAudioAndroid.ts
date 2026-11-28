import fs from 'node:fs';
import path from 'node:path';
import {
  type ConfigPlugin,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} from 'expo/config-plugins';

const PACKAGE_DIR = path.join('app', 'src', 'main', 'java', 'com', 'kallie', 'app');
const TEMPLATE_DIR = path.join('plugins', 'android', 'directAudio');
const TEMPLATE_FILES = [
  'KallieDirectAudioModule.kt',
  'KallieDirectAudioPackage.kt',
] as const;

function copyTemplate(src: string, dest: string): void {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing Android plugin template: ${src}`);
  }
  fs.copyFileSync(src, dest);
}

const withDirectPcmAudioAndroid: ConfigPlugin = (config) => {
  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    manifest.queries = manifest.queries || [{}];
    const queriesBlock = manifest.queries[0] || (manifest.queries[0] = {});
    queriesBlock.intent = queriesBlock.intent || [];

    const requiredActions = [
      'android.speech.RecognitionService',
      'android.intent.action.TTS_SERVICE',
    ];
    for (const actionName of requiredActions) {
      const exists = queriesBlock.intent.some((item) =>
        (item.action || []).some((a) => a?.$?.['android:name'] === actionName),
      );
      if (!exists) {
        queriesBlock.intent.push({
          action: [{ $: { 'android:name': actionName } }],
        });
      }
    }

    return modConfig;
  });

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

  config = withMainApplication(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    if (!contents.includes('KallieDirectAudioPackage()')) {
      contents = contents.replace(
        /PackageList\(this\)\.packages\.apply\s*\{/,
        'PackageList(this).packages.apply {\n              add(KallieDirectAudioPackage())',
      );
    }
    modConfig.modResults.contents = contents;
    return modConfig;
  });

  return config;
};

export default withDirectPcmAudioAndroid;
