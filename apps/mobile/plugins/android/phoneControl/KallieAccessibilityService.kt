package com.kallie.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.app.KeyguardManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class KallieAccessibilityService : AccessibilityService() {
  companion object {
    @Volatile
    var instance: KallieAccessibilityService? = null
      private set

    fun isConnected(): Boolean = instance != null

    private val SEND_ID_REGEX = Regex("(^|_)(send|btn_send|send_btn|send_button|composer_send)(_|$)")
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private val bgExecutor = Executors.newSingleThreadExecutor()
  private val foregroundListeners = CopyOnWriteArrayList<(String) -> Unit>()

  var notchController: KallieNotchOverlayController? = null
    private set

  @Volatile
  var lastForegroundPackage: String = ""
    private set

  @Volatile
  var currentForegroundPackage: String = ""
    private set

  private var systemShadeOpen = false

  private val shadeRestorePoll = object : Runnable {
    override fun run() {
      if (!systemShadeOpen) return
      if (notchController?.needsSystemShadeSuppression() != true) {
        updateSystemShadeSuppression(false)
        return
      }
      val stillOpen = isSystemShadeOrPanelOpen()
      if (!stillOpen) {
        updateSystemShadeSuppression(false)
      } else {
        mainHandler.postDelayed(this, 240L)
      }
    }
  }

  private fun isSystemUiPackage(pkg: String): Boolean {
    return pkg == "com.android.systemui" ||
      pkg.startsWith("com.oplus.systemui") ||
      pkg.startsWith("com.coloros.systemui")
  }

  private fun isSystemShadeOrPanelOpen(event: AccessibilityEvent? = null): Boolean {
    try {
      val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
      if (km?.isKeyguardLocked == true) {
        return true
      }
    } catch (_: Throwable) {
      // Ignore keyguard lookup errors
    }

    val dm = Resources.getSystem().displayMetrics
    val minShadeHeight = (dm.heightPixels * 0.24f).toInt()
    val minShadeWidth = (dm.widthPixels * 0.45f).toInt()

    val windowList = try { windows } catch (_: Throwable) { null }
    if (!windowList.isNullOrEmpty()) {
      val bounds = Rect()
      for (win in windowList) {
        val root = win.root
        val pkg = root?.packageName?.toString() ?: ""
        recycleSingleNodeIfLegacy(root)
        val isSystemUiPkg = isSystemUiPackage(pkg)
        val isSystemType = win.type == AccessibilityWindowInfo.TYPE_SYSTEM

        if (!isSystemType && !isSystemUiPkg) continue

        win.getBoundsInScreen(bounds)
        val isLargePanel = bounds.height() >= minShadeHeight && bounds.width() >= minShadeWidth
        if (isLargePanel && (isSystemUiPkg || win.isFocused || win.isActive)) {
          return true
        }
      }
    }

    if (event != null && event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
      val evPkg = event.packageName?.toString() ?: ""
      val evClass = event.className?.toString() ?: ""
      if (
        (evPkg == "com.android.systemui" || evPkg.contains("systemui")) &&
        (evClass.contains("Shade", ignoreCase = true) ||
          evClass.contains("QuickSettings", ignoreCase = true) ||
          evClass.contains("ControlCenter", ignoreCase = true) ||
          evClass.contains("StatusBar", ignoreCase = true) ||
          evClass.contains("Panel", ignoreCase = true))
      ) {
        return true
      }
    }

    return false
  }

  private fun updateSystemShadeSuppression(suppressed: Boolean) {
    if (systemShadeOpen == suppressed) return
    systemShadeOpen = suppressed
    notchController?.setSystemOverlaySuppressed(suppressed)
    mainHandler.removeCallbacks(shadeRestorePoll)
    if (suppressed) {
      mainHandler.postDelayed(shadeRestorePoll, 240L)
    }
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    notchController = KallieNotchOverlayController(
      context = this,
      isAccessibilityContext = true,
      onReturnToApp = { bringKallieToFront() },
      onStopPressed = { KalliePhoneControlModule.emitNotchStop() },
      onConfirmResult = { reqId, approved ->
        KalliePhoneControlModule.emitNotchConfirm(reqId, approved)
      }
    )
    KalliePhoneControlModule.onAccessibilityConnected()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val evType = event?.eventType ?: 0
    if (
      evType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
      evType == AccessibilityEvent.TYPE_WINDOWS_CHANGED
    ) {
      // Gate expensive multi-window Binder IPC behind actual accessibility-layer orb attachment
      if (notchController?.needsSystemShadeSuppression() == true) {
        updateSystemShadeSuppression(isSystemShadeOrPanelOpen(event))
      } else if (systemShadeOpen) {
        updateSystemShadeSuppression(false)
      }
    }

    val pkg = event?.packageName?.toString() ?: return
    if (pkg.isNotBlank() && !isSystemUiPackage(pkg)) {
      currentForegroundPackage = pkg
      if (pkg != packageName) {
        lastForegroundPackage = pkg
      }
      if (evType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
        for (listener in foregroundListeners) {
          try { listener(pkg) } catch (_: Throwable) {}
        }
      }
    }
  }

  override fun onInterrupt() {
    // No-op
  }

  override fun onUnbind(intent: Intent?): Boolean {
    mainHandler.removeCallbacks(shadeRestorePoll)
    foregroundListeners.clear()
    systemShadeOpen = false
    notchController?.hide()
    notchController = null
    instance = null
    KalliePhoneControlModule.emitAccessibilityStatus(false)
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    mainHandler.removeCallbacks(shadeRestorePoll)
    foregroundListeners.clear()
    systemShadeOpen = false
    notchController?.hide()
    notchController = null
    instance = null
    try { bgExecutor.shutdownNow() } catch (_: Throwable) {}
    super.onDestroy()
  }

  private fun readActiveRootPackage(): String {
    val root = try { rootInActiveWindow } catch (_: Throwable) { null }
    val pkg = root?.packageName?.toString() ?: currentForegroundPackage
    recycleSingleNodeIfLegacy(root)
    return pkg
  }

  /**
   * Launches an Activity using the AccessibilityService context, which holds Android 10–16
   * Background Activity Launch (BAL) exemption for reliable cross-app switching.
   */
  fun launchIntent(intent: Intent): Boolean {
    return try {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      startActivity(intent)
      true
    } catch (_: Throwable) {
      false
    }
  }

  fun bringKallieToFront(): Boolean {
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
      )
    } ?: return false
    return launchIntent(launch)
  }

  /**
   * Pre-registers a foreground listener BEFORE calling startActivity() so fast window
   * switches can never race ahead of listener registration.
   */
  fun launchAndWaitForForegroundPackage(
    intent: Intent,
    expectedPkg: String,
    timeoutMs: Long = 3000L,
    onDone: (launched: Boolean, verified: Boolean, actualPkg: String) -> Unit
  ) {
    val settled = AtomicBoolean(false)
    lateinit var listener: (String) -> Unit

    val timeoutRunnable = Runnable {
      foregroundListeners.remove(listener)
      if (settled.compareAndSet(false, true)) {
        val active = readActiveRootPackage()
        onDone(true, active == expectedPkg, active)
      }
    }

    listener = { pkg ->
      if (pkg == expectedPkg && settled.compareAndSet(false, true)) {
        foregroundListeners.remove(listener)
        mainHandler.removeCallbacks(timeoutRunnable)
        // Wait 350ms for Android 12+ splash/trampoline views to finish inflating
        mainHandler.postDelayed({ onDone(true, true, pkg) }, 350L)
      }
    }

    foregroundListeners.add(listener)

    if (!launchIntent(intent)) {
      foregroundListeners.remove(listener)
      if (settled.compareAndSet(false, true)) {
        onDone(false, false, readActiveRootPackage())
      }
      return
    }

    // Re-check after launch in case window was already foregrounded
    val alreadyPkg = readActiveRootPackage()
    if (alreadyPkg == expectedPkg && settled.compareAndSet(false, true)) {
      foregroundListeners.remove(listener)
      mainHandler.postDelayed({ onDone(true, true, alreadyPkg) }, 220L)
      return
    }

    mainHandler.postDelayed(timeoutRunnable, timeoutMs)
  }

  /**
   * Pre-registers a listener waiting for the foreground to leave `leavePkg` (used by open_url).
   */
  fun launchAndWaitForForegroundLeave(
    intent: Intent,
    leavePkg: String,
    timeoutMs: Long = 1800L,
    onDone: (launched: Boolean, leftApp: Boolean, actualPkg: String) -> Unit
  ) {
    val settled = AtomicBoolean(false)
    lateinit var listener: (String) -> Unit

    val timeoutRunnable = Runnable {
      foregroundListeners.remove(listener)
      if (settled.compareAndSet(false, true)) {
        val active = readActiveRootPackage()
        onDone(true, active.isNotBlank() && active != leavePkg, active)
      }
    }

    listener = { pkg ->
      if (pkg.isNotBlank() && pkg != leavePkg && settled.compareAndSet(false, true)) {
        foregroundListeners.remove(listener)
        mainHandler.removeCallbacks(timeoutRunnable)
        mainHandler.postDelayed({ onDone(true, true, pkg) }, 300L)
      }
    }

    foregroundListeners.add(listener)

    if (!launchIntent(intent)) {
      foregroundListeners.remove(listener)
      if (settled.compareAndSet(false, true)) {
        onDone(false, false, readActiveRootPackage())
      }
      return
    }

    mainHandler.postDelayed(timeoutRunnable, timeoutMs)
  }

  fun waitForForegroundPackage(
    expectedPkg: String,
    timeoutMs: Long = 1600L,
    onDone: (Boolean, String) -> Unit
  ) {
    val settled = AtomicBoolean(false)
    lateinit var listener: (String) -> Unit

    val timeoutRunnable = Runnable {
      foregroundListeners.remove(listener)
      if (settled.compareAndSet(false, true)) {
        val active = readActiveRootPackage()
        onDone(active == expectedPkg, active)
      }
    }

    listener = { pkg ->
      if (pkg == expectedPkg && settled.compareAndSet(false, true)) {
        foregroundListeners.remove(listener)
        mainHandler.removeCallbacks(timeoutRunnable)
        mainHandler.postDelayed({ onDone(true, pkg) }, 220L)
      }
    }

    // Register listener BEFORE checking active window to eliminate race window
    foregroundListeners.add(listener)
    val alreadyPkg = readActiveRootPackage()
    if (alreadyPkg == expectedPkg && settled.compareAndSet(false, true)) {
      foregroundListeners.remove(listener)
      onDone(true, alreadyPkg)
      return
    }

    mainHandler.postDelayed(timeoutRunnable, timeoutMs)
  }

  private fun findBestTargetRoot(): AccessibilityNodeInfo? {
    val windowList = try { windows } catch (_: Throwable) { null }
    if (!windowList.isNullOrEmpty()) {
      val candidates = ArrayList<Pair<AccessibilityWindowInfo, AccessibilityNodeInfo>>()
      for (win in windowList) {
        if (win.type == AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY) continue
        val root = win.root ?: continue
        val rootPkg = root.packageName?.toString() ?: ""
        val allowed = win.type == AccessibilityWindowInfo.TYPE_APPLICATION ||
          (win.type == AccessibilityWindowInfo.TYPE_SYSTEM &&
            (win.isFocused || win.isActive) &&
            !isSystemUiPackage(rootPkg))
        if (allowed) {
          candidates.add(Pair(win, root))
        } else {
          recycleSingleNodeIfLegacy(root)
        }
      }

      if (candidates.isNotEmpty()) {
        candidates.sortWith(
          compareByDescending<Pair<AccessibilityWindowInfo, AccessibilityNodeInfo>> { it.first.isFocused }
            .thenByDescending { it.first.isActive }
            .thenByDescending { it.first.layer }
        )

        // Prefer focused/active non-Kallie window, EXCEPT when Kallie itself is the focused foreground app
        val topFocused = candidates.firstOrNull { it.first.isFocused }
        val chosen = if (topFocused != null && topFocused.second.packageName?.toString() == packageName) {
          topFocused
        } else {
          candidates.firstOrNull {
            val pkg = it.second.packageName?.toString() ?: ""
            pkg.isNotBlank() && pkg != packageName
          } ?: candidates.first()
        }

        for (pair in candidates) {
          if (pair !== chosen) {
            recycleSingleNodeIfLegacy(pair.second)
          }
        }
        return chosen.second
      }
    }
    return rootInActiveWindow
  }

  private data class CapturedNode(
    val index: Int,
    val text: String,
    val hint: String,
    val desc: String,
    val viewId: String,
    val className: String,
    val clickable: Boolean,
    val editable: Boolean,
    val scrollable: Boolean,
    val checkable: Boolean,
    val checked: Boolean,
    val enabled: Boolean,
    val rect: Rect,
    val node: AccessibilityNodeInfo
  )

  private fun recycleSingleNodeIfLegacy(node: AccessibilityNodeInfo?) {
    if (node == null || Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return
    try {
      @Suppress("DEPRECATION")
      node.recycle()
    } catch (_: Throwable) {}
  }

  private fun recycleNodesIfLegacy(nodes: Collection<AccessibilityNodeInfo>) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return
    for (n in nodes) {
      try {
        @Suppress("DEPRECATION")
        n.recycle()
      } catch (_: Throwable) {}
    }
  }

  private fun collectNodes(
    root: AccessibilityNodeInfo,
    maxNodes: Int,
    allVisited: MutableList<AccessibilityNodeInfo>
  ): List<CapturedNode> {
    val dm = Resources.getSystem().displayMetrics
    val screenW = dm.widthPixels
    val screenH = dm.heightPixels

    val results = ArrayList<CapturedNode>(minOf(maxNodes + 5, 120))
    val extraEditables = ArrayList<CapturedNode>(4)
    val queue = ArrayDeque<AccessibilityNodeInfo>()
    queue.add(root)
    allVisited.add(root)

    var visitedCount = 0
    val visitCap = maxOf(maxNodes * 8, 420)

    while (queue.isNotEmpty() && visitedCount < visitCap) {
      val current = queue.removeFirst()
      visitedCount++
      if (!current.isVisibleToUser) {
        continue
      }

      val text = current.text?.toString()?.trim() ?: ""
      val hint = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        current.hintText?.toString()?.trim() ?: ""
      } else {
        ""
      }
      val desc = current.contentDescription?.toString()?.trim() ?: ""
      val rawId = current.viewIdResourceName?.trim() ?: ""
      val shortId = if (rawId.contains(":id/")) rawId.substringAfter(":id/") else rawId
      val className = current.className?.toString()?.substringAfterLast('.') ?: ""
      val clickable = current.isClickable
      val editable = current.isEditable
      val scrollable = current.isScrollable
      val checkable = current.isCheckable
      val checked = current.isChecked
      val enabled = current.isEnabled
      val childCount = current.childCount

      // Clip bounds to visible display so off-screen RecyclerView items never yield negative coordinates
      val rawRect = Rect()
      current.getBoundsInScreen(rawRect)
      val visible = Rect(rawRect)
      val onScreen = visible.intersect(0, 0, screenW, screenH) &&
        visible.width() > 4 &&
        visible.height() > 4

      // Skip pure wrapper containers with no semantic label/input/toggle that simply wrap children
      val isPureWrapper = text.isEmpty() && desc.isEmpty() && hint.isEmpty() && !editable && !checkable && childCount > 0
      val hasSemanticSignal = text.isNotEmpty() || desc.isNotEmpty() || hint.isNotEmpty() || clickable || editable || checkable

      if (onScreen && hasSemanticSignal && !isPureWrapper) {
        val displayText = if (text.isNotEmpty()) text else if (editable && hint.isNotEmpty()) hint else ""
        if (results.size < maxNodes) {
          results.add(
            CapturedNode(
              index = results.size,
              text = displayText.take(110),
              hint = hint.take(80),
              desc = desc.take(80),
              viewId = shortId.take(48),
              className = if (editable || checkable) className.take(28) else "",
              clickable = clickable,
              editable = editable,
              scrollable = scrollable,
              checkable = checkable,
              checked = checked,
              enabled = enabled,
              rect = visible,
              node = current
            )
          )
        } else if (editable && extraEditables.size < 4) {
          // Ensure bottom chat composers / search inputs are never starved by top list noise
          extraEditables.add(
            CapturedNode(
              index = results.size + extraEditables.size,
              text = displayText.take(110),
              hint = hint.take(80),
              desc = desc.take(80),
              viewId = shortId.take(48),
              className = className.take(28),
              clickable = clickable,
              editable = true,
              scrollable = scrollable,
              checkable = checkable,
              checked = checked,
              enabled = enabled,
              rect = visible,
              node = current
            )
          )
        }
      }

      if (results.size < maxNodes || extraEditables.size < 4) {
        for (i in 0 until childCount) {
          val child = current.getChild(i)
          if (child != null) {
            allVisited.add(child)
            queue.add(child)
          }
        }
      }
    }

    if (extraEditables.isNotEmpty()) {
      for (ed in extraEditables) {
        results.add(ed.copy(index = results.size))
      }
    }
    return results
  }

  fun dumpScreenUiJsonAsync(maxNodes: Int = 55, onDone: (String) -> Unit) {
    bgExecutor.execute {
      try {
        onDone(dumpScreenUiJson(maxNodes))
      } catch (err: Throwable) {
        val dm = Resources.getSystem().displayMetrics
        onDone(
          JSONObject().apply {
            put("ok", false)
            put("error", err.message ?: "Failed to inspect screen UI.")
            put("w", dm.widthPixels)
            put("h", dm.heightPixels)
          }.toString()
        )
      }
    }
  }

  fun dumpScreenUiJson(maxNodes: Int = 55): String {
    val metrics = Resources.getSystem().displayMetrics
    val root = findBestTargetRoot()
    if (root == null) {
      return JSONObject().apply {
        put("ok", false)
        put("error", "No active screen window available. Make sure the phone is unlocked.")
        put("w", metrics.widthPixels)
        put("h", metrics.heightPixels)
      }.toString()
    }

    val visited = ArrayList<AccessibilityNodeInfo>(128)
    try {
      val pkg = root.packageName?.toString() ?: currentForegroundPackage
      val captured = collectNodes(root, maxNodes.coerceIn(10, 90), visited)
      val nodesArr = JSONArray()
      for (item in captured) {
        val obj = JSONObject().apply {
          put("i", item.index)
          if (item.text.isNotEmpty()) put("t", item.text)
          if (item.desc.isNotEmpty()) put("d", item.desc)
          if (item.viewId.isNotEmpty()) put("id", item.viewId)
          if (item.clickable) put("click", true)
          if (item.editable) put("edit", true)
          if (item.scrollable) put("scroll", true)
          if (item.checkable) put("chk", item.checked)
          if (!item.enabled) put("off", true)
          put("x", item.rect.centerX())
          put("y", item.rect.centerY())
        }
        nodesArr.put(obj)
      }

      return JSONObject().apply {
        put("ok", true)
        put("pkg", pkg)
        put("w", metrics.widthPixels)
        put("h", metrics.heightPixels)
        put("n", captured.size)
        put("nodes", nodesArr)
      }.toString()
    } finally {
      recycleNodesIfLegacy(visited)
    }
  }

  fun inspectNodeLabel(nodeIndex: Int, onDone: (String) -> Unit) {
    bgExecutor.execute {
      try {
        val root = findBestTargetRoot()
        if (root == null) {
          onDone("")
          return@execute
        }
        val visited = ArrayList<AccessibilityNodeInfo>(128)
        try {
          val captured = collectNodes(root, 90, visited)
          val item = if (nodeIndex in captured.indices) captured[nodeIndex] else null
          val label = listOfNotNull(item?.text, item?.hint, item?.desc, item?.viewId)
            .filter { it.isNotBlank() }
            .joinToString(" ")
          onDone(label)
        } finally {
          recycleNodesIfLegacy(visited)
        }
      } catch (_: Throwable) {
        onDone("")
      }
    }
  }

  private fun clampCoord(value: Float, maxExclusive: Int): Float {
    val maxValid = (maxExclusive - 1).coerceAtLeast(0).toFloat()
    return value.coerceIn(0f, maxValid)
  }

  private fun dispatchGestureWithPassthrough(
    gesture: GestureDescription,
    cancelError: String,
    unableError: String,
    onDone: (Boolean, String?) -> Unit
  ) {
    mainHandler.post {
      val notch = notchController
      val needsPassthrough = notch?.isAttachedNow() == true
      if (needsPassthrough) {
        notch?.setGesturePassthrough(true)
      }

      val runDispatch = Runnable {
        val dispatched = try {
          dispatchGesture(
            gesture,
            object : GestureResultCallback() {
              override fun onCompleted(gestureDescription: GestureDescription?) {
                if (needsPassthrough) notch?.setGesturePassthrough(false)
                onDone(true, null)
              }

              override fun onCancelled(gestureDescription: GestureDescription?) {
                if (needsPassthrough) notch?.setGesturePassthrough(false)
                onDone(false, cancelError)
              }
            },
            null
          )
        } catch (err: Throwable) {
          if (needsPassthrough) notch?.setGesturePassthrough(false)
          onDone(false, err.message ?: unableError)
          return@Runnable
        }
        if (!dispatched) {
          if (needsPassthrough) notch?.setGesturePassthrough(false)
          onDone(false, unableError)
        }
      }

      // Give WindowManagerService/InputDispatcher 48ms to commit FLAG_NOT_TOUCHABLE before touch injection
      if (needsPassthrough) {
        mainHandler.postDelayed(runDispatch, 48L)
      } else {
        runDispatch.run()
      }
    }
  }

  fun tapXY(
    x: Float,
    y: Float,
    durationMs: Long = 65L,
    showRipple: Boolean = true,
    onDone: (Boolean, String?) -> Unit
  ) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
      onDone(false, "Gesture injection requires Android 7.0+")
      return
    }
    if (!x.isFinite() || !y.isFinite()) {
      onDone(false, "Invalid tap coordinates.")
      return
    }
    val dm = Resources.getSystem().displayMetrics
    val cx = clampCoord(x, dm.widthPixels)
    val cy = clampCoord(y, dm.heightPixels)

    if (showRipple) {
      notchController?.showTapIndicator(cx, cy)
    }

    val gesture = try {
      val path = Path().apply { moveTo(cx, cy) }
      val stroke = GestureDescription.StrokeDescription(path, 0L, durationMs.coerceIn(30L, 400L))
      GestureDescription.Builder().addStroke(stroke).build()
    } catch (err: Throwable) {
      onDone(false, err.message ?: "Unable to build tap gesture.")
      return
    }

    dispatchGestureWithPassthrough(
      gesture = gesture,
      cancelError = "Tap gesture was cancelled by the system.",
      unableError = "Unable to dispatch tap gesture.",
      onDone = onDone
    )
  }

  private fun findClickableAncestor(
    node: AccessibilityNodeInfo,
    targetRect: Rect? = null,
    visited: MutableList<AccessibilityNodeInfo>? = null,
    maxDepth: Int = 2
  ): AccessibilityNodeInfo? {
    val targetArea = if (targetRect != null) {
      (targetRect.width().toLong() * targetRect.height().toLong()).coerceAtLeast(1L)
    } else {
      0L
    }

    var cursor: AccessibilityNodeInfo? = node
    var depth = 0
    while (cursor != null && depth <= maxDepth) {
      if (cursor.isClickable) {
        if (depth == 0 || targetArea == 0L) return cursor
        val ancRect = Rect()
        cursor.getBoundsInScreen(ancRect)
        val ancArea = ancRect.width().toLong() * ancRect.height().toLong()
        // Avoid clicking a giant outer card/container when an inner icon/leaf should be tapped by XY
        if (ancArea <= targetArea * 4L) {
          return cursor
        }
        return null
      }
      val parent = cursor.parent
      if (parent != null) {
        visited?.add(parent)
      }
      cursor = parent
      depth++
    }
    return null
  }

  private fun matchesQuery(item: CapturedNode, qLower: String): Boolean {
    return item.text.lowercase().contains(qLower) ||
      item.hint.lowercase().contains(qLower) ||
      item.desc.lowercase().contains(qLower) ||
      item.viewId.lowercase().contains(qLower)
  }

  fun tapElement(query: String?, nodeIndex: Int?, onDone: (Boolean, String) -> Unit) {
    bgExecutor.execute {
      try {
        val root = findBestTargetRoot()
        if (root == null) {
          onDone(false, "No active window to inspect.")
          return@execute
        }
        val visited = ArrayList<AccessibilityNodeInfo>(128)
        try {
          val captured = collectNodes(root, 90, visited)
          val qTrimmed = query?.trim()?.lowercase() ?: ""
          var target: CapturedNode? = null

          if (nodeIndex != null && nodeIndex in captured.indices) {
            val indexed = captured[nodeIndex]
            // Verify index hasn't drifted when query was also provided
            if (qTrimmed.isEmpty() || matchesQuery(indexed, qTrimmed)) {
              target = indexed
            }
          }

          if (target == null && qTrimmed.isNotEmpty()) {
            target = captured.firstOrNull {
              it.text.lowercase() == qTrimmed ||
                it.desc.lowercase() == qTrimmed ||
                it.viewId.lowercase() == qTrimmed
            } ?: captured.firstOrNull { matchesQuery(it, qTrimmed) }
          }

          if (target == null) {
            val msg = if (nodeIndex != null && qTrimmed.isNotEmpty()) {
              "Screen changed since last inspection and element no longer matches. Call get_screen_ui again."
            } else {
              "Could not find matching UI element on screen."
            }
            onDone(false, msg)
            return@execute
          }

          val cx = target.rect.centerX().toFloat()
          val cy = target.rect.centerY().toFloat()
          val label = target.text.ifBlank { target.desc.ifBlank { target.viewId.ifBlank { "element" } } }

          notchController?.showTapIndicator(cx, cy)

          val clickableNode = findClickableAncestor(target.node, target.rect, visited, maxDepth = 2)
          if (clickableNode != null && clickableNode.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            onDone(true, "Tapped " + label)
            return@execute
          }

          // Real touch hit-testing handles Compose/Litho/WebView non-clickable leaves accurately
          tapXY(cx, cy, 65L, showRipple = false) { ok, err ->
            if (ok) {
              onDone(true, "Tapped " + label + " at (" + cx.toInt() + ", " + cy.toInt() + ")")
            } else {
              onDone(false, err ?: "Tap failed")
            }
          }
        } finally {
          recycleNodesIfLegacy(visited)
        }
      } catch (err: Throwable) {
        onDone(false, err.message ?: "Failed to tap UI element.")
      }
    }
  }

  private fun injectTextIntoNode(editNode: AccessibilityNodeInfo, text: String): Boolean {
    if (!editNode.isFocused) {
      editNode.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
      editNode.performAction(AccessibilityNodeInfo.ACTION_CLICK)
      try { Thread.sleep(75L) } catch (_: InterruptedException) {}
      try { editNode.refresh() } catch (_: Throwable) {}
    }

    val args = Bundle().apply {
      putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
    }
    if (editNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
      return true
    }

    // Clipboard paste fallback: select existing text first, and restore user's previous clipboard
    return try {
      val cm = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return false
      val previousClip = try { cm.primaryClip } catch (_: Throwable) { null }
      val curLen = editNode.text?.length ?: 0
      if (curLen > 0) {
        val selArgs = Bundle().apply {
          putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, 0)
          putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, curLen)
        }
        editNode.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, selArgs)
      }
      cm.setPrimaryClip(ClipData.newPlainText("kallie_input", text))
      val pasted = editNode.performAction(AccessibilityNodeInfo.ACTION_PASTE)
      if (previousClip != null) {
        mainHandler.postDelayed({
          try { cm.setPrimaryClip(previousClip) } catch (_: Throwable) {}
        }, 350L)
      }
      pasted
    } catch (_: Throwable) {
      false
    }
  }

  private fun findEditableNode(
    root: AccessibilityNodeInfo,
    captured: List<CapturedNode>,
    targetQuery: String?,
    visited: MutableList<AccessibilityNodeInfo>
  ): AccessibilityNodeInfo? {
    if (!targetQuery.isNullOrBlank()) {
      val q = targetQuery.trim().lowercase()
      val matched = captured.firstOrNull {
        it.editable && matchesQuery(it, q)
      }?.node
      if (matched != null) return matched
    }

    val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
    if (focused != null) {
      visited.add(focused)
      if (focused.isEditable) {
        return focused
      }
    }

    return captured.firstOrNull { it.editable }?.node
  }

  fun typeText(
    text: String,
    targetQuery: String?,
    submitMode: String,
    onDone: (Boolean, String) -> Unit
  ) {
    bgExecutor.execute {
      try {
        val root = findBestTargetRoot()
        if (root == null) {
          onDone(false, "No active window available for typing.")
          return@execute
        }
        val visited = ArrayList<AccessibilityNodeInfo>(128)
        var expandTriggerRect: Rect? = null
        var expandClicked = false

        try {
          val captured = collectNodes(root, 90, visited)
          val editNode = findEditableNode(root, captured, targetQuery, visited)

          // Handle click-to-expand search bars (YouTube, Messenger, Chrome)
          if (editNode == null && !targetQuery.isNullOrBlank()) {
            val q = targetQuery.trim().lowercase()
            val trigger = captured.firstOrNull { matchesQuery(it, q) }
            if (trigger != null) {
              expandTriggerRect = Rect(trigger.rect)
              val clickable = findClickableAncestor(trigger.node, trigger.rect, visited, maxDepth = 3)
              val cx = trigger.rect.centerX().toFloat()
              val cy = trigger.rect.centerY().toFloat()
              notchController?.showTapIndicator(cx, cy)
              expandClicked = clickable?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
            }
          }

          if (editNode != null) {
            val rect = Rect()
            editNode.getBoundsInScreen(rect)
            if (rect.width() > 4 && rect.height() > 4) {
              notchController?.showTapIndicator(rect.centerX().toFloat(), rect.centerY().toFloat())
            }
            val setOk = injectTextIntoNode(editNode, text)
            if (!setOk) {
              onDone(false, "Failed to inject text into the input field.")
              return@execute
            }
            completeTypeSubmit(editNode, submitMode, onDone)
            return@execute
          }
        } finally {
          recycleNodesIfLegacy(visited)
        }

        val triggerRect = expandTriggerRect
        if (triggerRect != null) {
          val continueAfterExpand = {
            mainHandler.postDelayed({
              bgExecutor.execute {
                try {
                  val expandedRoot = findBestTargetRoot()
                  if (expandedRoot == null) {
                    onDone(false, "No active window available after opening input.")
                    return@execute
                  }
                  val visited2 = ArrayList<AccessibilityNodeInfo>(128)
                  try {
                    val captured2 = collectNodes(expandedRoot, 90, visited2)
                    val expandedEdit = findEditableNode(expandedRoot, captured2, targetQuery, visited2)
                    if (expandedEdit == null) {
                      onDone(false, "Opened element but no editable input field appeared.")
                      return@execute
                    }
                    val setOk = injectTextIntoNode(expandedEdit, text)
                    if (!setOk) {
                      onDone(false, "Failed to inject text into the expanded input field.")
                      return@execute
                    }
                    completeTypeSubmit(expandedEdit, submitMode, onDone)
                  } finally {
                    recycleNodesIfLegacy(visited2)
                  }
                } catch (err: Throwable) {
                  onDone(false, err.message ?: "Failed to type into expanded input.")
                }
              }
            }, 420L)
          }

          if (!expandClicked) {
            tapXY(triggerRect.centerX().toFloat(), triggerRect.centerY().toFloat(), 65L, showRipple = false) { _, _ ->
              continueAfterExpand()
            }
          } else {
            continueAfterExpand()
          }
          return@execute
        }

        onDone(false, "No editable text field found on screen. Tap the input field first.")
      } catch (err: Throwable) {
        onDone(false, err.message ?: "Failed to type text.")
      }
    }
  }

  private fun completeTypeSubmit(
    editNode: AccessibilityNodeInfo,
    submitMode: String,
    onDone: (Boolean, String) -> Unit
  ) {
    val mode = submitMode.trim().lowercase()
    if (mode.isEmpty() || mode == "none" || mode == "false") {
      onDone(true, "Text entered successfully.")
      return
    }

    // For search / enter modes, wait 120ms & refresh before Android 11+ ACTION_IME_ENTER
    if ((mode == "search" || mode == "enter") && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      try { Thread.sleep(120L) } catch (_: InterruptedException) {}
      try { editNode.refresh() } catch (_: Throwable) {}
      if (editNode.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)) {
        onDone(true, "Typed and submitted via keyboard.")
        return
      }
    }

    mainHandler.postDelayed({
      bgExecutor.execute {
        try {
          val refreshedRoot = findBestTargetRoot()
          if (refreshedRoot != null) {
            val visited = ArrayList<AccessibilityNodeInfo>(128)
            try {
              val refreshedNodes = collectNodes(refreshedRoot, 90, visited)
              val matchingButtons = refreshedNodes.filter { node ->
                // Never click the editable text input box itself
                if (node.editable) return@filter false
                val d = node.desc.lowercase()
                val t = node.text.lowercase()
                val id = node.viewId.lowercase()
                if (mode == "search" || mode == "enter") {
                  d == "search" || t == "search" || d == "go" || t == "go" ||
                    id.contains("search_go") || id.contains("search_button")
                } else {
                  if (id.contains("sender")) return@filter false
                  d == "send" || t == "send" || d.startsWith("send ") || SEND_ID_REGEX.containsMatchIn(id)
                }
              }

              // Prefer bottom-most matching button for chat Send (avoids header/message matches)
              val actionTarget = if (mode == "search" || mode == "enter") {
                matchingButtons.firstOrNull()
              } else {
                matchingButtons.maxByOrNull { it.rect.centerY() }
              }

              if (actionTarget != null) {
                val cx = actionTarget.rect.centerX().toFloat()
                val cy = actionTarget.rect.centerY().toFloat()
                notchController?.showTapIndicator(cx, cy)
                val clickable = findClickableAncestor(actionTarget.node, actionTarget.rect, visited, maxDepth = 2)
                if (clickable != null && clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                  onDone(true, if (mode == "search") "Searched successfully." else "Typed and sent message.")
                  return@execute
                }
                // Fallback to real touch injection if ACTION_CLICK fails on custom Send button
                tapXY(cx, cy, 65L, showRipple = false) { ok, err ->
                  if (ok) {
                    onDone(true, if (mode == "search") "Searched successfully." else "Typed and sent message.")
                  } else {
                    onDone(false, err ?: "Could not tap the $mode button.")
                  }
                }
                return@execute
              }
            } finally {
              recycleNodesIfLegacy(visited)
            }
          }
          onDone(
            false,
            "Text was entered, but the " + mode + " button could not be triggered automatically. Inspect screen and tap it."
          )
        } catch (err: Throwable) {
          onDone(false, err.message ?: "Failed to submit text.")
        }
      }
    }, 280L)
  }

  fun swipe(
    x1: Float,
    y1: Float,
    x2: Float,
    y2: Float,
    durationMs: Long = 380L,
    onDone: (Boolean, String?) -> Unit
  ) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
      onDone(false, "Swipe gesture requires Android 7.0+")
      return
    }
    if (!x1.isFinite() || !y1.isFinite() || !x2.isFinite() || !y2.isFinite()) {
      onDone(false, "Invalid swipe coordinates.")
      return
    }
    val dm = Resources.getSystem().displayMetrics
    val sx1 = clampCoord(x1, dm.widthPixels)
    val sy1 = clampCoord(y1, dm.heightPixels)
    val sx2 = clampCoord(x2, dm.widthPixels)
    val sy2 = clampCoord(y2, dm.heightPixels)

    val gesture = try {
      val path = Path().apply {
        moveTo(sx1, sy1)
        lineTo(sx2, sy2)
      }
      val stroke = GestureDescription.StrokeDescription(path, 0L, durationMs.coerceIn(100L, 1200L))
      GestureDescription.Builder().addStroke(stroke).build()
    } catch (err: Throwable) {
      onDone(false, err.message ?: "Unable to build swipe gesture.")
      return
    }

    dispatchGestureWithPassthrough(
      gesture = gesture,
      cancelError = "Swipe cancelled.",
      unableError = "Unable to dispatch swipe.",
      onDone = onDone
    )
  }

  private fun getSoftKeyboardTopY(screenH: Int): Int {
    val windowList = try { windows } catch (_: Throwable) { null } ?: return screenH
    val rect = Rect()
    var minTop = screenH
    for (win in windowList) {
      if (win.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD) {
        win.getBoundsInScreen(rect)
        if (rect.height() > 80 && rect.top in 1 until minTop) {
          minTop = rect.top
        }
      }
    }
    return minTop
  }

  fun scrollDirection(direction: String, onDone: (Boolean, String?) -> Unit) {
    val dm = Resources.getSystem().displayMetrics
    val w = dm.widthPixels.toFloat()
    val h = dm.heightPixels.toFloat()
    val imeTop = getSoftKeyboardTopY(dm.heightPixels).toFloat()
    val safeBottom = minOf(h * 0.72f, imeTop - h * 0.08f).coerceAtLeast(h * 0.36f)
    val safeTop = minOf(h * 0.26f, safeBottom - h * 0.22f).coerceAtLeast(h * 0.14f)
    val midY = ((safeTop + safeBottom) * 0.5f).coerceIn(h * 0.20f, h * 0.60f)

    // Controlled 460ms vertical swipe prevents high-velocity fling overshoot & avoids open keyboard
    when (direction.lowercase()) {
      "down" -> swipe(w * 0.5f, safeBottom, w * 0.5f, safeTop, 460L, onDone)
      "up" -> swipe(w * 0.5f, safeTop, w * 0.5f, safeBottom, 460L, onDone)
      // Content-scroll convention: "right" reveals content to the right; "left" reveals content to the left
      "right" -> swipe(w * 0.72f, midY, w * 0.28f, midY, 340L, onDone)
      "left" -> swipe(w * 0.28f, midY, w * 0.72f, midY, 340L, onDone)
      else -> onDone(false, "Unknown scroll direction: " + direction)
    }
  }

  fun runSystemAction(action: String): Pair<Boolean, String?> {
    val code = when (action.lowercase()) {
      "back" -> GLOBAL_ACTION_BACK
      "home" -> GLOBAL_ACTION_HOME
      "recents" -> GLOBAL_ACTION_RECENTS
      "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
      "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
      "lock_screen" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        GLOBAL_ACTION_LOCK_SCREEN
      } else {
        return Pair(false, "Lock screen requires Android 9.0 or higher.")
      }
      else -> return Pair(false, "Unknown system action: $action")
    }
    val ok = performGlobalAction(code)
    return if (ok) Pair(true, null) else Pair(false, "Android rejected system action '$action'.")
  }

  fun captureScreenshotBase64(maxWidth: Int, onDone: (String?, String?) -> Unit) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      onDone(null, "On-device Accessibility screenshots require Android 11+")
      return
    }
    try {
      takeScreenshot(
        Display.DEFAULT_DISPLAY,
        bgExecutor,
        object : TakeScreenshotCallback {
          override fun onSuccess(screenshot: ScreenshotResult) {
            var hwBitmap: Bitmap? = null
            var swBitmap: Bitmap? = null
            var scaled: Bitmap? = null
            try {
              hwBitmap = Bitmap.wrapHardwareBuffer(
                screenshot.hardwareBuffer,
                screenshot.colorSpace
              )
              screenshot.hardwareBuffer.close()
              if (hwBitmap == null) {
                onDone(null, "Failed to decode screenshot buffer.")
                return
              }
              val copied = hwBitmap.copy(Bitmap.Config.ARGB_8888, false)
              hwBitmap.recycle()
              hwBitmap = null
              if (copied == null) {
                onDone(null, "Failed to copy screenshot bitmap.")
                return
              }
              swBitmap = copied
              val targetW = maxWidth.coerceIn(240, 1080)
              val finalBitmap = if (copied.width > targetW) {
                val targetH = (copied.height.toFloat() * (targetW.toFloat() / copied.width)).toInt()
                Bitmap.createScaledBitmap(copied, targetW, maxOf(1, targetH), true).also {
                  copied.recycle()
                  swBitmap = null
                }
              } else {
                copied.also { swBitmap = null }
              }
              scaled = finalBitmap
              val out = ByteArrayOutputStream()
              finalBitmap.compress(Bitmap.CompressFormat.JPEG, 65, out)
              val base64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
              onDone(base64, null)
            } catch (err: Throwable) {
              onDone(null, err.message ?: "Screenshot processing error")
            } finally {
              try { hwBitmap?.recycle() } catch (_: Throwable) {}
              try { swBitmap?.recycle() } catch (_: Throwable) {}
              try { scaled?.recycle() } catch (_: Throwable) {}
            }
          }

          override fun onFailure(errorCode: Int) {
            onDone(null, "Screenshot blocked or failed (code " + errorCode + "). Secure screens cannot be captured.")
          }
        }
      )
    } catch (err: Throwable) {
      onDone(null, err.message ?: "Unable to capture screenshot")
    }
  }
}
