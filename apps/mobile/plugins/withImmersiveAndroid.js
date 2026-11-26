const { withMainActivity } = require('@expo/config-plugins');

/**
 * Expo Config Plugin for Android sticky immersive full-screen mode.
 * Hides both the system status bar and navigation bar natively using
 * WindowInsetsControllerCompat (BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE)
 * and renders edge-to-edge into display cutouts.
 */
function withImmersiveAndroid(config) {
  return withMainActivity(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    const requiredImports = [
      'import android.os.Build',
      'import android.view.WindowManager',
      'import androidx.core.view.WindowCompat',
      'import androidx.core.view.WindowInsetsCompat',
      'import androidx.core.view.WindowInsetsControllerCompat',
    ];

    for (const imp of requiredImports) {
      if (!contents.includes(imp)) {
        contents = contents.replace(
          /^(package [^\r\n]+\r?\n)/,
          `$1${imp}\n`,
        );
      }
    }

    if (!contents.includes('private fun applyImmersiveMode()')) {
      const helperMethod = `
  private fun applyImmersiveMode() {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      window.attributes.layoutInDisplayCutoutMode =
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.systemBarsBehavior =
      WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    controller.hide(
      WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.navigationBars()
    )
  }

  override fun onResume() {
    super.onResume()
    applyImmersiveMode()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      applyImmersiveMode()
    }
  }
`;

      if (contents.includes('super.onCreate(null)')) {
        contents = contents.replace(
          'super.onCreate(null)',
          'super.onCreate(null)\n    applyImmersiveMode()',
        );
      } else if (contents.includes('super.onCreate(savedInstanceState)')) {
        contents = contents.replace(
          'super.onCreate(savedInstanceState)',
          'super.onCreate(savedInstanceState)\n    applyImmersiveMode()',
        );
      }

      const lastBrace = contents.lastIndexOf('}');
      if (lastBrace !== -1) {
        contents =
          contents.slice(0, lastBrace) + helperMethod + contents.slice(lastBrace);
      }
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });
}

module.exports = withImmersiveAndroid;
