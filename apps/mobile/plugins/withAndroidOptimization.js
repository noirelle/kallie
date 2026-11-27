const fs = require('fs');
const path = require('path');
const {
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
} = require('expo/config-plugins');

/**
 * Optimizes Android release APK size (~125.6 MB -> ~14-18 MB):
 * 1. Restricts native ABIs to arm64-v8a (override via EXPO_ANDROID_ARCHS) — drops ~83 MB of x86/x86_64/armeabi-v7a.
 * 2. Sets expo.useLegacyPackaging=true to DEFLATE-compress native .so libraries (~60% smaller, Android 15+ 16 KB safe).
 * 3. Sets android.enableBundleCompression=false so Hermes can mmap index.android.bundle directly from APK (faster cold boot, lower RAM).
 * 4. Disables unused Fresco GIF/WebP native decoders (saves libgifimage.so + libstatic-webp.so + DEX).
 * 5. Enables R8 minification, resource shrinking, PNG crunching, and English-only resourceConfigurations.
 * 6. Keeps ProGuard rules for LiveKit WebRTC & CallKeep JNI/reflection classes.
 */
function withAndroidOptimization(config) {
  const archs = process.env.EXPO_ANDROID_ARCHS || 'arm64-v8a';

  config = withGradleProperties(config, (modConfig) => {
    const props = modConfig.modResults;
    const upsert = (key, value) => {
      const existing = props.find((p) => p.type === 'property' && p.key === key);
      if (existing) {
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

    // Strip unused non-English locale strings from AndroidX / Play Services / Firebase
    if (!contents.includes('resourceConfigurations') && !contents.includes('resConfigs')) {
      contents = contents.replace(
        /(defaultConfig\s*\{)/,
        '$1\n        resourceConfigurations += ["en"]',
      );
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });

  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const proguardPath = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro',
      );
      const keepMarker = '# Kallie WebRTC & CallKeep ProGuard rules';
      const keepRules = `
${keepMarker}
-keep class org.webrtc.** { *; }
-keep class io.livekit.** { *; }
-keep class com.livekit.** { *; }
-keep class io.wazo.callkeep.** { *; }
-dontwarn org.webrtc.**
-dontwarn io.livekit.**
-dontwarn io.wazo.callkeep.**
`;
      if (fs.existsSync(proguardPath)) {
        const current = fs.readFileSync(proguardPath, 'utf8');
        if (!current.includes(keepMarker)) {
          fs.writeFileSync(proguardPath, current + keepRules, 'utf8');
        }
      }
      return modConfig;
    },
  ]);

  return config;
}

module.exports = withAndroidOptimization;
