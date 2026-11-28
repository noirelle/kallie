package com.kallie.app

import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.min

class KalliePhoneControlModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  private data class AppEntry(
    val label: String,
    val packageName: String,
    val lowerLabel: String,
    val normalizedLabel: String,
    val tokens: List<String>,
    val acronym: String,
    val pkgSegments: List<String>
  )

  companion object {
    @Volatile
    private var activeContextRef: WeakReference<ReactApplicationContext>? = null

    @Volatile
    private var activeModuleRef: WeakReference<KalliePhoneControlModule>? = null

    private val SCHEME_REGEX = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:")
    private val CAMEL_SPLIT_REGEX = Regex("(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")
    private val NON_ALNUM_REGEX = Regex("[^a-z0-9]+")
    private val IGNORE_PKG_SEGMENTS = setOf("com", "org", "net", "io", "app", "android", "mobile", "google", "oplus", "coloros")

    private fun tokenizeLabel(raw: String): List<String> {
      val splitCamel = CAMEL_SPLIT_REGEX.replace(raw, " ")
      return NON_ALNUM_REGEX.split(splitCamel.lowercase()).filter { it.isNotEmpty() }
    }

    private fun normalizeAlnum(raw: String): String {
      return NON_ALNUM_REGEX.replace(raw.lowercase(), "")
    }

    private fun levenshtein(a: String, b: String, maxDist: Int): Int {
      if (a == b) return 0
      if (abs(a.length - b.length) > maxDist) return maxDist + 1
      val m = a.length
      val n = b.length
      var prev = IntArray(n + 1) { it }
      var curr = IntArray(n + 1)
      for (i in 1..m) {
        curr[0] = i
        var rowMin = i
        val ca = a[i - 1]
        for (j in 1..n) {
          val cost = if (ca == b[j - 1]) 0 else 1
          val v = min(min(curr[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost)
          curr[j] = v
          if (v < rowMin) rowMin = v
        }
        if (rowMin > maxDist) return maxDist + 1
        val tmp = prev
        prev = curr
        curr = tmp
      }
      return prev[n]
    }

    private fun getActiveContext(): ReactApplicationContext? {
      val ctx = activeContextRef?.get() ?: return null
      return if (ctx.hasActiveReactInstance()) ctx else null
    }

    fun onAccessibilityConnected() {
      activeModuleRef?.get()?.clearFallbackNotchController()
      emitAccessibilityStatus(true)
    }

    fun emitNotchStop() {
      val ctx = getActiveContext() ?: return
      try {
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("KallieNotchStop", Arguments.createMap())
      } catch (_: Throwable) {}
    }

    fun emitNotchConfirm(requestId: String, approved: Boolean) {
      val ctx = getActiveContext() ?: return
      try {
        val map = Arguments.createMap().apply {
          putString("requestId", requestId)
          putBoolean("approved", approved)
        }
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("KallieNotchConfirm", map)
      } catch (_: Throwable) {}
    }

    fun emitAccessibilityStatus(connected: Boolean) {
      val ctx = getActiveContext() ?: return
      try {
        val map = Arguments.createMap().apply {
          putBoolean("connected", connected)
        }
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("KallieAccessibilityStatus", map)
      } catch (_: Throwable) {}
    }
  }

  private val bgExecutor = Executors.newSingleThreadExecutor()
  private val notchLock = Any()
  private var fallbackNotchController: KallieNotchOverlayController? = null
  private var packageChangeReceiver: BroadcastReceiver? = null

  @Volatile private var cachedLauncherApps: List<AppEntry> = emptyList()
  @Volatile private var cachedLauncherAppsAtMs: Long = 0L

  init {
    activeContextRef = WeakReference(reactContext)
    activeModuleRef = WeakReference(this)
    registerPackageChangeReceiver()
    // Pre-warm dynamic app index asynchronously so the very first voice open_app is instant (0ms)
    bgExecutor.execute {
      try {
        getLauncherAppsCached(forceRefresh = true)
      } catch (_: Throwable) {}
    }
  }

  private fun registerPackageChangeReceiver() {
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        cachedLauncherAppsAtMs = 0L
        bgExecutor.execute {
          try {
            getLauncherAppsCached(forceRefresh = true)
          } catch (_: Throwable) {}
        }
      }
    }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_PACKAGE_ADDED)
      addAction(Intent.ACTION_PACKAGE_REMOVED)
      addAction(Intent.ACTION_PACKAGE_REPLACED)
      addDataScheme("package")
    }
    try {
      ContextCompat.registerReceiver(
        reactContext,
        receiver,
        filter,
        ContextCompat.RECEIVER_EXPORTED
      )
      packageChangeReceiver = receiver
    } catch (_: Throwable) {
      packageChangeReceiver = null
    }
  }

  override fun getName(): String = "KalliePhoneControl"

  @ReactMethod
  fun addListener(eventName: String) {
    // Required by NativeEventEmitter
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required by NativeEventEmitter
  }

  private inline fun withAccessibility(
    promise: Promise,
    block: (KallieAccessibilityService) -> Unit
  ) {
    val svc = KallieAccessibilityService.instance
    if (svc == null) {
      promise.resolve(Arguments.createMap().apply {
        putBoolean("ok", false)
        putString("error", "Phone Control Accessibility is not enabled.")
      })
      return
    }
    block(svc)
  }

  private fun clearFallbackNotchController() {
    synchronized(notchLock) {
      fallbackNotchController?.hide()
      fallbackNotchController = null
    }
  }

  private fun isAccessibilityEnabledInSettings(): Boolean {
    if (KallieAccessibilityService.isConnected()) return true
    return try {
      val enabled = Settings.Secure.getString(
        reactContext.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
      ) ?: return false
      val expected = ComponentName(reactContext, KallieAccessibilityService::class.java).flattenToString()
      enabled.split(':').any { it.equals(expected, ignoreCase = true) }
    } catch (_: Throwable) {
      false
    }
  }

  private fun isNotificationListenerEnabled(): Boolean {
    if (KallieNotificationListener.isConnected()) return true
    return try {
      val enabled = Settings.Secure.getString(
        reactContext.contentResolver,
        "enabled_notification_listeners"
      ) ?: return false
      val expected = ComponentName(reactContext, KallieNotificationListener::class.java).flattenToString()
      enabled.split(':').any { it.equals(expected, ignoreCase = true) }
    } catch (_: Throwable) {
      false
    }
  }

  private fun canDrawSystemOverlays(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      Settings.canDrawOverlays(reactContext)
    } else {
      true
    }
  }

  private fun getActiveNotchController(): KallieNotchOverlayController? {
    val a11yNotch = KallieAccessibilityService.instance?.notchController
    if (a11yNotch != null) {
      clearFallbackNotchController()
      return a11yNotch
    }
    if (canDrawSystemOverlays()) {
      synchronized(notchLock) {
        if (fallbackNotchController == null) {
          fallbackNotchController = KallieNotchOverlayController(
            context = reactContext.applicationContext,
            isAccessibilityContext = false,
            onReturnToApp = { launchSelf() },
            onStopPressed = { emitNotchStop() },
            onConfirmResult = { reqId, approved -> emitNotchConfirm(reqId, approved) }
          )
        }
        return fallbackNotchController
      }
    }
    return null
  }

  private fun startActivityReliable(intent: Intent): Boolean {
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val a11y = KallieAccessibilityService.instance
    if (a11y != null && a11y.launchIntent(intent)) {
      return true
    }
    return try {
      reactContext.startActivity(intent)
      true
    } catch (_: Throwable) {
      false
    }
  }

  private fun launchSelf(): Boolean {
    val a11y = KallieAccessibilityService.instance
    if (a11y != null && a11y.bringKallieToFront()) {
      return true
    }
    val intent = reactContext.packageManager.getLaunchIntentForPackage(reactContext.packageName)?.apply {
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
      )
    } ?: return false
    return startActivityReliable(intent)
  }

  private fun getLauncherAppsCached(forceRefresh: Boolean = false): List<AppEntry> {
    val now = System.currentTimeMillis()
    val existing = cachedLauncherApps
    if (!forceRefresh && existing.isNotEmpty() && now - cachedLauncherAppsAtMs < 300_000L) {
      return existing
    }
    val pm = reactContext.packageManager
    val mainIntent = Intent(Intent.ACTION_MAIN, null).apply {
      addCategory(Intent.CATEGORY_LAUNCHER)
    }
    val resolved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      pm.queryIntentActivities(mainIntent, PackageManager.ResolveInfoFlags.of(0L))
    } else {
      @Suppress("DEPRECATION")
      pm.queryIntentActivities(mainIntent, 0)
    }

    val seen = HashSet<String>()
    val apps = ArrayList<AppEntry>(resolved.size)
    for (info in resolved) {
      val pkg = info.activityInfo?.packageName ?: continue
      if (!seen.add(pkg)) continue
      val label = info.loadLabel(pm)?.toString()?.trim().orEmpty().ifBlank { pkg }
      val tokens = tokenizeLabel(label)
      val acronym = tokens.mapNotNull { it.firstOrNull() }.joinToString("")
      val pkgSegments = pkg.lowercase()
        .split('.', '_')
        .filter { it.length >= 2 && it !in IGNORE_PKG_SEGMENTS }
      apps.add(
        AppEntry(
          label = label,
          packageName = pkg,
          lowerLabel = label.lowercase(),
          normalizedLabel = normalizeAlnum(label),
          tokens = tokens,
          acronym = acronym,
          pkgSegments = pkgSegments
        )
      )
    }
    apps.sortBy { it.lowerLabel }
    cachedLauncherApps = apps
    cachedLauncherAppsAtMs = now
    return apps
  }

  @ReactMethod
  fun getCapabilities(promise: Promise) {
    val a11yConnected = KallieAccessibilityService.isConnected()
    val a11yEnabled = isAccessibilityEnabledInSettings()
    val notifConnected = KallieNotificationListener.isConnected()
    val notifEnabled = isNotificationListenerEnabled()
    val overlayGranted = canDrawSystemOverlays()

    val map = Arguments.createMap().apply {
      putBoolean("accessibilityConnected", a11yConnected)
      putBoolean("accessibilityEnabled", a11yEnabled)
      putBoolean("notificationAccessConnected", notifConnected)
      putBoolean("notificationAccessEnabled", notifEnabled)
      putBoolean("overlayPermissionGranted", overlayGranted)
      putBoolean("notchAvailable", a11yConnected || overlayGranted)
    }
    promise.resolve(map)
  }

  @ReactMethod
  fun openAccessibilitySettings(promise: Promise) {
    promise.resolve(startActivityReliable(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)))
  }

  @ReactMethod
  fun openNotificationListenerSettings(promise: Promise) {
    promise.resolve(startActivityReliable(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)))
  }

  @ReactMethod
  fun openOverlaySettings(promise: Promise) {
    val intent = Intent(
      Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
      Uri.parse("package:" + reactContext.packageName)
    )
    promise.resolve(startActivityReliable(intent))
  }

  @ReactMethod
  fun listInstalledApps(query: String?, promise: Promise) {
    bgExecutor.execute {
      try {
        val apps = getLauncherAppsCached()
        val q = query?.trim() ?: ""
        val filtered = if (q.isEmpty()) {
          apps
        } else {
          apps
            .map { Pair(it, scoreAppMatch(it, q)) }
            .filter { it.second > 0 }
            .sortedByDescending { it.second }
            .map { it.first }
        }
        val arr = Arguments.createArray()
        for (entry in filtered.take(100)) {
          val item = Arguments.createMap().apply {
            putString("label", entry.label)
            putString("packageName", entry.packageName)
          }
          arr.pushMap(item)
        }
        promise.resolve(arr)
      } catch (err: Throwable) {
        promise.reject("LIST_APPS_ERR", err.message, err)
      }
    }
  }

  private fun launchAndVerify(
    intent: Intent,
    pkg: String,
    label: String,
    promise: Promise
  ) {
    val a11y = KallieAccessibilityService.instance
    if (a11y != null) {
      val settled = AtomicBoolean(false)
      // Pre-registers foreground listener BEFORE launching intent (zero race window)
      a11y.launchAndWaitForForegroundPackage(intent, pkg, 3000L) { launched, verified, actualPkg ->
        if (!settled.compareAndSet(false, true)) return@launchAndWaitForForegroundPackage
        if (!launched) {
          promise.resolve(Arguments.createMap().apply {
            putBoolean("ok", false)
            putString("error", "Android blocked launching $label. Enable Phone Control Accessibility.")
          })
          return@launchAndWaitForForegroundPackage
        }
        // If we are still stuck inside Kallie after timeout, report failure honestly
        if (!verified && actualPkg == reactContext.packageName && pkg != reactContext.packageName) {
          promise.resolve(Arguments.createMap().apply {
            putBoolean("ok", false)
            putString("packageName", pkg)
            putString("label", label)
            putString("actualPackage", actualPkg)
            putString("error", "Could not bring $label to the foreground (still on Kallie).")
          })
          return@launchAndWaitForForegroundPackage
        }
        promise.resolve(Arguments.createMap().apply {
          putBoolean("ok", true)
          putString("packageName", pkg)
          putString("label", label)
          putBoolean("verified", verified)
          if (actualPkg.isNotBlank()) putString("actualPackage", actualPkg)
        })
      }
      return
    }

    val started = startActivityReliable(intent)
    if (!started) {
      promise.resolve(Arguments.createMap().apply {
        putBoolean("ok", false)
        putString("error", "Android blocked launching $label. Enable Phone Control Accessibility.")
      })
      return
    }
    promise.resolve(Arguments.createMap().apply {
      putBoolean("ok", true)
      putString("packageName", pkg)
      putString("label", label)
      putBoolean("verified", false)
    })
  }

  /**
   * 100% Dynamic (Zero-Hardcoded) App Matcher:
   * Scores any installed Android app against natural spoken queries using:
   * exact label, normalized label, auto-generated camelCase/word acronyms (e.g. YT, WA, MLBB),
   * token coverage, substring, Levenshtein typo tolerance (for voice STT), and package segments.
   */
  private fun scoreAppMatch(entry: AppEntry, rawQuery: String): Int {
    val cleaned = rawQuery.trim().lowercase()
      .removePrefix("open ")
      .removePrefix("launch ")
      .removePrefix("start ")
      .removeSuffix(" app")
      .trim()
      .ifBlank { rawQuery.trim().lowercase() }

    val qNorm = normalizeAlnum(cleaned)
    if (qNorm.isEmpty()) return 0
    val qTokens = tokenizeLabel(cleaned)

    // Tier 1: Exact label or normalized match
    if (entry.lowerLabel == cleaned || entry.normalizedLabel == qNorm) {
      return 1000
    }

    // Tier 2: Label prefix match (prefer shorter exact-head apps like "YouTube" over "YouTube Music")
    if (entry.lowerLabel.startsWith(cleaned) || entry.normalizedLabel.startsWith(qNorm)) {
      val lengthPenalty = (entry.normalizedLabel.length - qNorm.length).coerceIn(0, 60)
      return 880 - lengthPenalty
    }

    // Tier 3: Auto-generated acronym match from real app name (e.g. "yt" -> YouTube, "wa" -> WhatsApp, "ml" -> Mobile Legends)
    if (entry.acronym.isNotEmpty() && qNorm.length in 2..6) {
      if (entry.acronym == qNorm) {
        return 820
      }
      if (entry.acronym.startsWith(qNorm) && entry.tokens.size >= qNorm.length) {
        return 780 - (entry.acronym.length - qNorm.length) * 10
      }
    }

    // Tier 4: All query tokens match app word tokens (exact or prefix)
    if (qTokens.isNotEmpty() && entry.tokens.isNotEmpty()) {
      val allMatched = qTokens.all { qt ->
        entry.tokens.any { et -> et == qt || (qt.length >= 2 && et.startsWith(qt)) }
      }
      if (allMatched) {
        val extraTokensPenalty = (entry.tokens.size - qTokens.size).coerceAtLeast(0) * 12
        return 740 - extraTokensPenalty.coerceAtMost(60)
      }
    }

    // Tier 5: Substring inside label (require >= 3 chars to avoid stray 1-2 letter collisions)
    if (qNorm.length >= 3 && entry.normalizedLabel.contains(qNorm)) {
      val lengthPenalty = (entry.normalizedLabel.length - qNorm.length).coerceIn(0, 60)
      return 640 - lengthPenalty
    }

    // Tier 6: Typo-tolerant fuzzy match (handles voice STT misspellings like "mesenger", "shopi", "kapkat")
    if (qNorm.length >= 4) {
      val maxDist = if (qNorm.length >= 6) 2 else 1
      val fullDist = levenshtein(qNorm, entry.normalizedLabel, maxDist)
      if (fullDist <= maxDist) {
        return 590 - fullDist * 35
      }
      for (token in entry.tokens) {
        if (token.length >= 4) {
          val tokDist = levenshtein(qNorm, token, maxDist)
          if (tokDist <= maxDist) {
            return 555 - tokDist * 35
          }
        }
      }
    }

    // Tier 7: Package-name segment exact match (e.g. "spotify" in com.spotify.music)
    if (qNorm.length >= 3 && entry.pkgSegments.any { it == qNorm }) {
      return 480
    }

    return 0
  }

  private fun rankApps(candidates: List<AppEntry>, query: String): List<Pair<AppEntry, Int>> {
    return candidates
      .mapNotNull { entry ->
        val score = scoreAppMatch(entry, query)
        if (score > 0) Pair(entry, score) else null
      }
      .sortedByDescending { it.second }
  }

  @ReactMethod
  fun openApp(appNameOrPackage: String, promise: Promise) {
    val raw = appNameOrPackage.trim()
    if (raw.isEmpty()) {
      promise.resolve(Arguments.createMap().apply {
        putBoolean("ok", false)
        putString("error", "App name or package cannot be empty.")
      })
      return
    }

    bgExecutor.execute {
      try {
        val pm = reactContext.packageManager

        // 1. Direct package name match (0ms)
        val directIntent = pm.getLaunchIntentForPackage(raw)
        if (directIntent != null) {
          val label = try {
            val info = pm.getApplicationInfo(raw, 0)
            pm.getApplicationLabel(info)?.toString()?.trim().orEmpty().ifBlank { raw }
          } catch (_: Throwable) {
            raw
          }
          launchAndVerify(directIntent, raw, label, promise)
          return@execute
        }

        // 2. Dynamic zero-hardcode scoring across ALL launchable apps installed on the device
        var candidates = getLauncherAppsCached()
        var ranked = rankApps(candidates, raw)
        if (ranked.isEmpty()) {
          candidates = getLauncherAppsCached(forceRefresh = true)
          ranked = rankApps(candidates, raw)
        }

        val top = ranked.firstOrNull()
        if (top == null) {
          // Return real installed app labels so the AI can immediately pick the right app or clarify
          val installedArr = Arguments.createArray()
          for (entry in candidates.take(60)) {
            installedArr.pushString(entry.label)
          }
          promise.resolve(Arguments.createMap().apply {
            putBoolean("ok", false)
            putString("error", "No installed app matched \"$raw\". Check installedApps to pick the exact app or ask the user.")
            putArray("installedApps", installedArr)
          })
          return@execute
        }

        // Ambiguity Guard: if multiple apps match closely and none is an exact match,
        // never guess — return the matching apps so Kallie asks the user which one to open.
        if (ranked.size >= 2) {
          val topScore = top.second
          val secondScore = ranked[1].second
          if (topScore < 1000 && (topScore - secondScore) < 80) {
            val closeMatches = ranked
              .filter { topScore - it.second < 80 }
              .take(6)
              .map { it.first.label }
            val matchesArr = Arguments.createArray()
            for (name in closeMatches) {
              matchesArr.pushString(name)
            }
            promise.resolve(Arguments.createMap().apply {
              putBoolean("ok", false)
              putBoolean("ambiguous", true)
              putArray("matches", matchesArr)
              putString(
                "error",
                "Multiple installed apps match \"$raw\": ${closeMatches.joinToString(", ")}. Ask the user which one to open."
              )
            })
            return@execute
          }
        }

        val best = top.first
        val launchIntent = pm.getLaunchIntentForPackage(best.packageName)
        if (launchIntent == null) {
          promise.resolve(Arguments.createMap().apply {
            putBoolean("ok", false)
            putString("error", "Found ${best.label} but it has no launchable activity.")
          })
          return@execute
        }

        launchAndVerify(launchIntent, best.packageName, best.label, promise)
      } catch (err: Throwable) {
        promise.resolve(Arguments.createMap().apply {
          putBoolean("ok", false)
          putString("error", err.message ?: "Failed to launch app")
        })
      }
    }
  }

  @ReactMethod
  fun openUrl(url: String, promise: Promise) {
    val raw = url.trim()
    if (raw.isEmpty()) {
      promise.resolve(Arguments.createMap().apply {
        putBoolean("ok", false)
        putString("error", "URL cannot be empty.")
      })
      return
    }
    val normalized = if (!SCHEME_REGEX.containsMatchIn(raw) && raw.contains('.') && !raw.contains(' ')) {
      "https://$raw"
    } else {
      raw
    }

    try {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(normalized))
      val a11y = KallieAccessibilityService.instance
      if (a11y != null) {
        val settled = AtomicBoolean(false)
        a11y.launchAndWaitForForegroundLeave(intent, reactContext.packageName, 1800L) { launched, leftApp, actualPkg ->
          if (!settled.compareAndSet(false, true)) return@launchAndWaitForForegroundLeave
          promise.resolve(Arguments.createMap().apply {
            putBoolean("ok", launched)
            putBoolean("verified", leftApp)
            if (actualPkg.isNotBlank()) putString("actualPackage", actualPkg)
            if (!launched) putString("error", "No app installed to handle this link or Android blocked launch.")
          })
        }
        return
      }

      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactContext.startActivity(intent)
      promise.resolve(Arguments.createMap().apply {
        putBoolean("ok", true)
        putBoolean("verified", false)
      })
    } catch (_: ActivityNotFoundException) {
      promise.resolve(Arguments.createMap().apply {
        putBoolean("ok", false)
        putString("error", "No app installed to handle this link.")
      })
    } catch (err: Throwable) {
      promise.resolve(Arguments.createMap().apply {
        putBoolean("ok", false)
        putString("error", err.message ?: "Failed to open URL.")
      })
    }
  }

  @ReactMethod
  fun bringKallieToFront(promise: Promise) {
    val a11y = KallieAccessibilityService.instance
    val launch = reactContext.packageManager.getLaunchIntentForPackage(reactContext.packageName)?.apply {
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
      )
    }
    if (a11y != null && launch != null) {
      val settled = AtomicBoolean(false)
      a11y.launchAndWaitForForegroundPackage(launch, reactContext.packageName, 1200L) { launched, verified, _ ->
        if (settled.compareAndSet(false, true)) {
          promise.resolve(launched && verified)
        }
      }
      return
    }
    promise.resolve(launchSelf())
  }

  @ReactMethod
  fun getDeviceStatus(promise: Promise) {
    try {
      val batteryIntent = reactContext.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
      val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
      val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
      val batteryPct = if (level >= 0 && scale > 0) (level * 100) / scale else -1
      val status = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
      val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
        status == BatteryManager.BATTERY_STATUS_FULL

      val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      val maxMusic = audioManager?.getStreamMaxVolume(AudioManager.STREAM_MUSIC) ?: 15
      val curMusic = audioManager?.getStreamVolume(AudioManager.STREAM_MUSIC) ?: 0
      val musicVolumePct = if (maxMusic > 0) (curMusic * 100) / maxMusic else 0

      val fgPkg = KallieAccessibilityService.instance?.currentForegroundPackage
        ?.ifBlank { KallieAccessibilityService.instance?.lastForegroundPackage ?: "" } ?: ""

      val map = Arguments.createMap().apply {
        putInt("batteryPercent", batteryPct)
        putBoolean("isCharging", isCharging)
        putInt("mediaVolumePercent", musicVolumePct)
        putString("foregroundPackage", fgPkg)
        putBoolean("accessibilityConnected", KallieAccessibilityService.isConnected())
        putBoolean("notificationAccessConnected", KallieNotificationListener.isConnected())
      }
      promise.resolve(map)
    } catch (err: Throwable) {
      promise.reject("DEVICE_STATUS_ERR", err.message, err)
    }
  }

  @ReactMethod
  fun setMediaVolume(percent: Int, promise: Promise) {
    try {
      val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      if (audioManager == null) {
        promise.resolve(false)
        return
      }
      val clamped = percent.coerceIn(0, 100)
      val maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      val target = (maxVol * clamped + 50) / 100
      audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0)
      promise.resolve(true)
    } catch (_: Throwable) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun getScreenUi(maxNodes: Int, promise: Promise) {
    val svc = KallieAccessibilityService.instance
    if (svc == null) {
      promise.resolve(
        """{"ok":false,"error":"Phone Control Accessibility is not enabled. Enable Kallie in Android Accessibility settings."}"""
      )
      return
    }
    svc.dumpScreenUiJsonAsync(maxNodes) { json ->
      promise.resolve(json)
    }
  }

  @ReactMethod
  fun inspectNodeLabel(nodeIndex: Int, promise: Promise) {
    val svc = KallieAccessibilityService.instance
    if (svc == null) {
      promise.resolve("")
      return
    }
    svc.inspectNodeLabel(nodeIndex) { label ->
      promise.resolve(label)
    }
  }

  @ReactMethod
  fun tapElement(query: String?, nodeIndex: Int, promise: Promise) {
    withAccessibility(promise) { svc ->
      val settled = AtomicBoolean(false)
      val idxOrNull = if (nodeIndex >= 0) nodeIndex else null
      svc.tapElement(query, idxOrNull) { ok, message ->
        if (settled.compareAndSet(false, true)) {
          promise.resolve(Arguments.createMap().apply {
            putBoolean("ok", ok)
            if (ok) putString("message", message) else putString("error", message)
          })
        }
      }
    }
  }

  @ReactMethod
  fun tapXY(x: Double, y: Double, promise: Promise) {
    withAccessibility(promise) { svc ->
      val settled = AtomicBoolean(false)
      svc.tapXY(x.toFloat(), y.toFloat()) { ok, err ->
        if (settled.compareAndSet(false, true)) {
          promise.resolve(Arguments.createMap().apply {
            putBoolean("ok", ok)
            if (!ok && err != null) putString("error", err)
          })
        }
      }
    }
  }

  @ReactMethod
  fun typeText(text: String, targetQuery: String?, submitMode: String, promise: Promise) {
    withAccessibility(promise) { svc ->
      val settled = AtomicBoolean(false)
      svc.typeText(text, targetQuery, submitMode) { ok, message ->
        if (settled.compareAndSet(false, true)) {
          promise.resolve(Arguments.createMap().apply {
            putBoolean("ok", ok)
            if (ok) putString("message", message) else putString("error", message)
          })
        }
      }
    }
  }

  @ReactMethod
  fun scrollScreen(direction: String, promise: Promise) {
    withAccessibility(promise) { svc ->
      val settled = AtomicBoolean(false)
      svc.scrollDirection(direction) { ok, err ->
        if (settled.compareAndSet(false, true)) {
          promise.resolve(Arguments.createMap().apply {
            putBoolean("ok", ok)
            if (!ok && err != null) putString("error", err)
          })
        }
      }
    }
  }

  @ReactMethod
  fun swipeScreen(
    x1: Double,
    y1: Double,
    x2: Double,
    y2: Double,
    durationMs: Int,
    promise: Promise
  ) {
    withAccessibility(promise) { svc ->
      val settled = AtomicBoolean(false)
      svc.swipe(x1.toFloat(), y1.toFloat(), x2.toFloat(), y2.toFloat(), durationMs.toLong()) { ok, err ->
        if (settled.compareAndSet(false, true)) {
          promise.resolve(Arguments.createMap().apply {
            putBoolean("ok", ok)
            if (!ok && err != null) putString("error", err)
          })
        }
      }
    }
  }

  @ReactMethod
  fun performSystemAction(action: String, promise: Promise) {
    withAccessibility(promise) { svc ->
      val (ok, err) = svc.runSystemAction(action)
      promise.resolve(Arguments.createMap().apply {
        putBoolean("ok", ok)
        if (!ok && err != null) putString("error", err)
      })
    }
  }

  @ReactMethod
  fun takeScreenshot(maxWidth: Int, promise: Promise) {
    withAccessibility(promise) { svc ->
      val settled = AtomicBoolean(false)
      svc.captureScreenshotBase64(maxWidth) { base64, err ->
        if (settled.compareAndSet(false, true)) {
          promise.resolve(Arguments.createMap().apply {
            putBoolean("ok", base64 != null)
            if (base64 != null) putString("jpegBase64", base64)
            if (err != null) putString("error", err)
          })
        }
      }
    }
  }

  @ReactMethod
  fun listRecentNotifications(appFilter: String?, promise: Promise) {
    bgExecutor.execute {
      try {
        promise.resolve(KallieNotificationListener.listRecentEnvelopeJson(appFilter))
      } catch (err: Throwable) {
        promise.resolve("""{"notificationAccessConnected":false,"notifications":[]}""")
      }
    }
  }

  @ReactMethod
  fun hasReplyableNotification(key: String, promise: Promise) {
    promise.resolve(KallieNotificationListener.hasReplyableNotification(key))
  }

  @ReactMethod
  fun replyToNotification(key: String, replyText: String, promise: Promise) {
    bgExecutor.execute {
      val (ok, msg) = KallieNotificationListener.replyToKey(key, replyText)
      promise.resolve(Arguments.createMap().apply {
        putBoolean("ok", ok)
        if (ok) putString("message", msg) else putString("error", msg)
      })
    }
  }

  @ReactMethod
  fun showNotch(state: String, statusText: String, audioLevel: Double) {
    getActiveNotchController()?.showOrUpdate(state, statusText, audioLevel.toFloat(), autoAttach = true)
  }

  @ReactMethod
  fun updateNotch(state: String, statusText: String, audioLevel: Double) {
    getActiveNotchController()?.showOrUpdate(state, statusText, audioLevel.toFloat(), autoAttach = false)
  }

  @ReactMethod
  fun setNotchAudioLevel(audioLevel: Double) {
    getActiveNotchController()?.setAudioLevel(audioLevel.toFloat())
  }

  @ReactMethod
  fun clearNotchAction() {
    getActiveNotchController()?.clearActionState()
  }

  @ReactMethod
  fun showNotchConfirm(requestId: String, title: String, preview: String, approveLabel: String) {
    val controller = getActiveNotchController()
    if (controller == null || !controller.showConfirm(requestId, title, preview, approveLabel)) {
      emitNotchConfirm(requestId, false)
    }
  }

  @ReactMethod
  fun clearNotchConfirm(requestId: String?) {
    getActiveNotchController()?.clearConfirm(requestId)
  }

  @ReactMethod
  fun hideNotch() {
    KallieAccessibilityService.instance?.notchController?.hide()
    clearFallbackNotchController()
  }

  @ReactMethod
  fun showTapIndicator(x: Double, y: Double) {
    getActiveNotchController()?.showTapIndicator(x.toFloat(), y.toFloat())
  }

  override fun invalidate() {
    clearFallbackNotchController()
    packageChangeReceiver?.let { receiver ->
      try { reactContext.unregisterReceiver(receiver) } catch (_: Throwable) {}
    }
    packageChangeReceiver = null
    try { bgExecutor.shutdownNow() } catch (_: Throwable) {}
    if (activeContextRef?.get() === reactContext) {
      activeContextRef = null
    }
    if (activeModuleRef?.get() === this) {
      activeModuleRef = null
    }
    super.invalidate()
  }
}
