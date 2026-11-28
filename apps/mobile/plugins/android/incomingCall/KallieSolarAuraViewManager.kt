package com.kallie.app

import androidx.annotation.Keep
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

@Keep
class KallieSolarAuraViewManager : SimpleViewManager<KallieSolarAuraView>() {
  override fun getName(): String = "KallieSolarAuraView"

  override fun createViewInstance(reactContext: ThemedReactContext): KallieSolarAuraView {
    return KallieSolarAuraView(reactContext).apply {
      setFloatingMode(false)
    }
  }

  @Keep
  @ReactProp(name = "state")
  fun setState(view: KallieSolarAuraView, state: String?) {
    view.setAuraState(state)
  }

  @Keep
  @ReactProp(name = "connectionStatus")
  fun setConnectionStatus(view: KallieSolarAuraView, status: String?) {
    view.setConnectionStatus(status)
  }

  @Keep
  @ReactProp(name = "audioLevel", defaultFloat = 0.14f)
  fun setAudioLevel(view: KallieSolarAuraView, level: Float) {
    view.setAudioLevel(level)
  }
}
