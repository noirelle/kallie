import {
  type ConfigPlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withGradleProperties,
} from 'expo/config-plugins';

/**
 * Optimizes Android release APK size (~10-13 MB serverless arm64-v8a build):
 * 1. Restricts native ABIs to arm64-v8a (override via EXPO_ANDROID_ARCHS).
 * 2. Sets expo.useLegacyPackaging=true to DEFLATE-compress native .so libraries.
 * 3. Sets android.enableBundleCompression=false so Hermes mmaps JS bundle directly (faster cold boot, lower RAM).
 * 4. Disables unused Fresco GIF/WebP native decoders.
 * 5. Enables R8 minification, resource shrinking, PNG crunching, and English-only resourceConfigurations.
 */
const withAndroidOptimization: ConfigPlugin = (config) => {
  const archs = process.env.EXPO_ANDROID_ARCHS || 'arm64-v8a';

  config = withGradleProperties(config, (modConfig) => {
    const props = modConfig.modResults;
    const upsert = (key: string, value: string) => {
      const existing = props.find((p) => p.type === 'property' && p.key === key);
      if (existing && existing.type === 'property') {
        existing.value = value;
      } else {
        props.push({ type: 'property', key, value });
      }
    };

    upsert('reactNativeArchitectures', archs);
    upsert('expo.useLegacyPackaging', 'true');
    upsert('android.enableBundleCompression', 'false');
    upsert('expo.gif.enabled', 'false');
    upsert('expo.webp.enabled', 'false');
    upsert('expo.webp.animated', 'false');
    upsert('android.enableMinifyInReleaseBuilds', 'true');
    upsert('android.enableShrinkResourcesInReleaseBuilds', 'true');
    upsert('android.enablePngCrunchInReleaseBuilds', 'true');

    return modConfig;
  });

  config = withAppBuildGradle(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    if (!contents.includes('resourceConfigurations') && !contents.includes('resConfigs')) {
      contents = contents.replace(
        /(defaultConfig\s*\{)/,
        '$1\n        resourceConfigurations += ["en"]',
      );
    }

    // Prevent Windows Ninja 260-char MAX_PATH failures during local CMake builds
    if (!contents.includes('CMAKE_OBJECT_PATH_MAX')) {
      contents = contents.replace(
        /(defaultConfig\s*\{)/,
        `$1\n        if (System.getProperty("os.name").toLowerCase().contains("windows")) {\n            externalNativeBuild {\n                cmake {\n                    arguments "-DCMAKE_OBJECT_PATH_MAX=200"\n                }\n            }\n        }`,
      );
    }

    if (!contents.includes('buildStagingDirectory')) {
      contents = contents.replace(
        /(android\s*\{)/,
        `$1\n    if (System.getProperty("os.name").toLowerCase().contains("windows")) {\n        externalNativeBuild {\n            cmake {\n                buildStagingDirectory = file("C:/k_cxx")\n            }\n        }\n    }`,
      );
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });

  // Allow local LAN / Tailscale HTTP endpoints (Desktop Bridge & Ollama) on Android 9+
  config = withAndroidManifest(config, (modConfig) => {
    const app = modConfig.modResults.manifest.application?.[0];
    if (app?.$) {
      app.$['android:usesCleartextTraffic'] = 'true';
    }
    return modConfig;
  });

  return config;
};

export default withAndroidOptimization;
