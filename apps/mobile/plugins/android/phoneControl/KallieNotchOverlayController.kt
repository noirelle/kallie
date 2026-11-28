package com.kallie.app

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Luminous White Movable Aura Orb Overlay (Kallie Floating Voice Orb):
 * - 3D pearl-white glowing Aura orb with soft drop shadow (crisp on both light & dark apps)
 * - Compact dark-glass "Listening" / "Speaking" / "Thinking" / "Muted" status pill below the orb
 * - 100% freely movable anywhere on screen with smooth tracking, orientation clamping & soft settle
 * - Tap orb to jump straight back into Kallie's active call screen
 * - Drag to bottom-center ✕ target to cancel confirmation/automation or end the call cleanly
 * - Dedicated monochrome Confirm / Cancel floating card for sensitive actions
 * - Reference-counted FLAG_NOT_TOUCHABLE passthrough for reliable Accessibility gesture injection
 */
class KallieNotchOverlayController(
  private val context: Context,
  private val isAccessibilityContext: Boolean,
  private val onReturnToApp: () -> Unit,
  private val onStopPressed: () -> Unit,
  private val onConfirmResult: (requestId: String, approved: Boolean) -> Unit
) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

  private var orbRoot: LinearLayout? = null
  private var orbSolarView: KallieSolarAuraView? = null
  private var stateBadgeDot: View? = null
  private var stateBadgeText: ShimmerStatusTextView? = null
  private var dotPulseAnimator: ValueAnimator? = null
  private var orbLp: WindowManager.LayoutParams? = null

  private var dismissContainer: FrameLayout? = null
  private var dismissCircle: TextView? = null
  private var isDismissAttached = false
  private var isHoveringDismiss = false

  private var confirmCardView: LinearLayout? = null
  private var confirmTitleView: TextView? = null
  private var confirmPreviewView: TextView? = null
  private var sendButtonView: TextView? = null
  private var isConfirmAttached = false

  private var activeConfirmId: String? = null
  private var wasAttachedBeforeConfirm = false
  private var attachedForCall = false
  private var passthroughRefCount = 0

  @Volatile private var isAttached = false
  @Volatile private var attachedWindowType: Int? = null
  private var isDragging = false
  private var isSuppressedBySystemUi = false
  private var settleAnimator: ValueAnimator? = null
  private val activeRipples = ArrayList<Pair<View, ValueAnimator>>()

  private var currentState = "listening"
  private var currentStatus = "Listening"
  private var lastPassiveState = "listening"
  private var lastPassiveStatus = "Listening"
  private var currentAudioLevel = 0.14f
  private var actionLeaseUntilMs: Long = 0L

  // Persist user's chosen free-floating position across updates
  private var savedOrbX: Int? = null
  private var savedOrbY: Int? = null

  // Cached pixel dimensions (avoids recomputing TypedValue.applyDimension every drag frame)
  private val windowWidthPx: Int = dp(96f)
  private val windowHeightPx: Int = dp(104f)
  private val orbCanvasSizePx: Int = dp(82f)
  private val edgeMarginPx: Int = dp(8f)
  private val minTopMarginPx: Int = dp(48f)
  private val minBottomMarginPx: Int = dp(72f)
  private val dragSlackPx: Int = dp(6f)
  private val dismissHoverRadiusPx: Int = dp(76f)

  private fun dp(value: Float): Int {
    return TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      value,
      context.resources.displayMetrics
    ).toInt()
  }

  private fun screenWidth(): Int = context.resources.displayMetrics.widthPixels

  private fun screenHeight(): Int = context.resources.displayMetrics.heightPixels

  fun isAttachedNow(): Boolean = isAttached

  fun needsSystemShadeSuppression(): Boolean = isAttached && isUsingAccessibilityLayer()

  private fun hapticTick() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
        vm?.defaultVibrator?.vibrate(
          VibrationEffect.createOneShot(14L, VibrationEffect.DEFAULT_AMPLITUDE)
        )
      } else {
        @Suppress("DEPRECATION")
        val vib = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          vib?.vibrate(VibrationEffect.createOneShot(14L, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
          @Suppress("DEPRECATION")
          vib?.vibrate(14L)
        }
      }
    } catch (_: Throwable) {
      // Ignore if vibrator unavailable
    }
  }

  private fun resolveOverlayWindowType(): Int? {
    // Prefer TYPE_APPLICATION_OVERLAY when "Display over other apps" is granted:
    // Android's SurfaceFlinger natively composites it BELOW Notification Shade,
    // Quick Settings (Wi-Fi/Control Center), and Lock Screen at 0ms / 120fps.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Settings.canDrawOverlays(context)) {
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      } else {
        @Suppress("DEPRECATION")
        WindowManager.LayoutParams.TYPE_PHONE
      }
    }
    if (isAccessibilityContext && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
      return WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
    }
    return null
  }

  private fun isUsingAccessibilityLayer(): Boolean {
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1 &&
      attachedWindowType == WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
  }

  private fun createRoundedBackground(
    radiusDp: Float,
    fillColor: Int,
    strokeColor: Int,
    strokeDp: Float = 1f
  ): GradientDrawable {
    return GradientDrawable().apply {
      shape = GradientDrawable.RECTANGLE
      cornerRadius = dp(radiusDp).toFloat()
      setColor(fillColor)
      setStroke(max(1, dp(strokeDp)), strokeColor)
    }
  }

  private fun createCircleBackground(fillColor: Int, strokeColor: Int): GradientDrawable {
    return GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(fillColor)
      setStroke(max(1, dp(1f)), strokeColor)
    }
  }

  private fun baseOverlayFlags(touchable: Boolean): Int {
    var flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
      WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
      WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
    if (!touchable) {
      flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
    }
    return flags
  }

  private fun createOrbLayoutParams(): WindowManager.LayoutParams? {
    val windowType = resolveOverlayWindowType() ?: return null
    val w = windowWidthPx
    val h = windowHeightPx
    val maxX = max(edgeMarginPx, screenWidth() - w - edgeMarginPx)
    val maxY = max(minTopMarginPx, screenHeight() - h - minBottomMarginPx)
    val defaultX = maxX
    val defaultY = (screenHeight() * 0.28f).toInt().coerceIn(minTopMarginPx, maxY)

    // Always clamp saved coordinates inside current viewport (protects portrait <-> landscape rotation)
    val startX = (savedOrbX ?: defaultX).coerceIn(edgeMarginPx, maxX)
    val startY = (savedOrbY ?: defaultY).coerceIn(minTopMarginPx, maxY)

    return WindowManager.LayoutParams(
      w,
      h,
      windowType,
      baseOverlayFlags(touchable = passthroughRefCount == 0),
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = startX
      y = startY
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        layoutInDisplayCutoutMode =
          WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      }
    }
  }

  private fun restorePassiveStateOnMain(detachIfTransient: Boolean = false) {
    currentState = lastPassiveState
    currentStatus = lastPassiveStatus
    applyBadgeState()
    if (detachIfTransient && !wasAttachedBeforeConfirm && !attachedForCall) {
      detachOrbOnly()
    }
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun buildOrbView(): LinearLayout {
    val root = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      clipChildren = false
      clipToPadding = false
    }

    val canvasSize = orbCanvasSizePx
    val solarView = KallieSolarAuraView(context).apply {
      setFloatingMode(true)
      setAuraState(currentState)
      setConnectionStatus(if (currentState == "disconnected") "disconnected" else "connected")
      setAudioLevel(currentAudioLevel)
      layoutParams = LinearLayout.LayoutParams(canvasSize, canvasSize)
    }

    val badgeRow = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      background = createRoundedBackground(
        14f,
        Color.parseColor("#DC09090B"),
        Color.parseColor("#38FFFFFF"),
        strokeDp = 0.85f
      )
      setPadding(dp(9f), dp(3.5f), dp(10f), dp(3.5f))
      elevation = dp(5f).toFloat()
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        topMargin = -dp(5f)
      }
    }

    val badgeDot = View(context).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.WHITE)
      }
      layoutParams = LinearLayout.LayoutParams(dp(5f), dp(5f)).apply {
        marginEnd = dp(6f)
      }
    }

    val badgeText = ShimmerStatusTextView(context).apply {
      text = "Listening"
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 10.5f)
      typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
      letterSpacing = 0.04f
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
      maxWidth = dp(78f)
    }

    badgeRow.addView(badgeDot)
    badgeRow.addView(badgeText)
    root.addView(solarView)
    root.addView(badgeRow)

    orbSolarView = solarView
    stateBadgeDot = badgeDot
    stateBadgeText = badgeText
    startDotPulse(badgeDot)

    val touchSlopPx = dp(8f).toFloat()
    var downRawX = 0f
    var downRawY = 0f
    var downOrbX = 0
    var downOrbY = 0
    var downTimeMs = 0L
    var movedBeyondSlop = false

    root.setOnTouchListener { view, event ->
      val lp = orbLp ?: return@setOnTouchListener false
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          settleAnimator?.cancel()
          downRawX = event.rawX
          downRawY = event.rawY
          downOrbX = lp.x
          downOrbY = lp.y
          downTimeMs = System.currentTimeMillis()
          movedBeyondSlop = false
          isDragging = false
          view.animate().scaleX(1.06f).scaleY(1.06f).setDuration(90L).start()
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - downRawX
          val dy = event.rawY - downRawY
          if (!movedBeyondSlop && hypot(dx.toDouble(), dy.toDouble()) > touchSlopPx) {
            movedBeyondSlop = true
            isDragging = true
            attachDismissTarget()
          }
          if (movedBeyondSlop) {
            val maxX = max(0, screenWidth() - windowWidthPx)
            val maxY = max(0, screenHeight() - windowHeightPx)
            lp.x = (downOrbX + dx.toInt()).coerceIn(-dragSlackPx, maxX + dragSlackPx)
            lp.y = (downOrbY + dy.toInt()).coerceIn(dp(24f), maxY)
            savedOrbX = lp.x
            savedOrbY = lp.y
            safeUpdateLayout(view, lp)
            val centerX = lp.x + windowWidthPx / 2f
            val centerY = lp.y + orbCanvasSizePx / 2f
            updateDismissHoverState(centerX, centerY)
          }
          true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          view.animate().scaleX(1f).scaleY(1f).setDuration(130L).start()
          val wasDragging = isDragging
          isDragging = false

          if (wasDragging) {
            val shouldStop = isHoveringDismiss
            detachDismissTarget()
            if (shouldStop) {
              hapticTick()
              val pendingId = activeConfirmId
              if (pendingId != null) {
                // Drag-to-X during confirmation cancels the confirmation card WITHOUT hanging up the call
                activeConfirmId = null
                detachConfirmCard()
                restorePassiveStateOnMain(detachIfTransient = true)
                onConfirmResult(pendingId, false)
              } else {
                if (!attachedForCall) {
                  detachOrbOnly()
                }
                onStopPressed()
              }
            } else {
              settleOrbWithinBounds()
            }
          } else if (
            event.actionMasked == MotionEvent.ACTION_UP &&
            System.currentTimeMillis() - downTimeMs < 350L
          ) {
            if (activeConfirmId == null) {
              onReturnToApp()
            }
          }
          true
        }
        else -> false
      }
    }

    return root
  }

  private fun settleOrbWithinBounds() {
    val view = orbRoot ?: return
    val lp = orbLp ?: return
    if (!isAttached) return

    val minX = edgeMarginPx
    val maxX = max(minX, screenWidth() - windowWidthPx - edgeMarginPx)
    val minY = minTopMarginPx
    val maxY = max(minY, screenHeight() - windowHeightPx - minBottomMarginPx)

    val targetX = lp.x.coerceIn(minX, maxX)
    val targetY = lp.y.coerceIn(minY, maxY)
    val startX = lp.x
    val startY = lp.y

    if (startX == targetX && startY == targetY) {
      savedOrbX = targetX
      savedOrbY = targetY
      return
    }

    settleAnimator?.cancel()
    settleAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 200L
      interpolator = OvershootInterpolator(0.6f)
      addUpdateListener { anim ->
        if (!isAttached) return@addUpdateListener
        val frac = anim.animatedValue as Float
        lp.x = (startX + (targetX - startX) * frac).toInt()
        lp.y = (startY + (targetY - startY) * frac).toInt()
        savedOrbX = lp.x
        savedOrbY = lp.y
        safeUpdateLayout(view, lp)
      }
      start()
    }
  }

  private fun resolveBadgeLabel(): String {
    val raw = currentStatus.trim()
    return when (currentState) {
      "speaking" -> "Speaking"
      "acting" -> if (raw.isNotEmpty() && !raw.equals("Kallie", ignoreCase = true)) raw else "Working…"
      "thinking" -> if (raw.isNotEmpty() && !raw.equals("Kallie", ignoreCase = true)) raw else "Thinking…"
      "muted" -> "Muted"
      "disconnected" -> "Offline"
      "confirm" -> "Confirm"
      else -> "Listening"
    }
  }

  private fun startDotPulse(dot: View) {
    dotPulseAnimator?.cancel()
    dotPulseAnimator = ValueAnimator.ofFloat(0.38f, 1f).apply {
      duration = 900L
      repeatCount = ValueAnimator.INFINITE
      repeatMode = ValueAnimator.REVERSE
      addUpdateListener { anim ->
        val v = anim.animatedValue as Float
        dot.alpha = v
        val s = 0.88f + 0.22f * v
        dot.scaleX = s
        dot.scaleY = s
      }
      start()
    }
  }

  private fun syncDotPulsePlayback(shouldPause: Boolean) {
    val anim = dotPulseAnimator ?: return
    if (shouldPause) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT && anim.isRunning && !anim.isPaused) {
        anim.pause()
      }
      stateBadgeDot?.alpha = 0.55f
    } else {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT && anim.isPaused) {
        anim.resume()
      } else if (!anim.isStarted) {
        anim.start()
      }
    }
  }

  private fun applyBadgeState() {
    val dotDrawable = stateBadgeDot?.background as? GradientDrawable
    val isDim = currentState == "muted" || currentState == "disconnected"
    val dotColor = if (isDim) Color.parseColor("#71717A") else Color.WHITE
    dotDrawable?.setColor(dotColor)
    syncDotPulsePlayback(isDim || (isSuppressedBySystemUi && isUsingAccessibilityLayer()))
    stateBadgeText?.text = resolveBadgeLabel()
    stateBadgeText?.setShimmerEnabled(!isDim)
    orbSolarView?.setAuraState(currentState)
    orbSolarView?.setConnectionStatus(if (currentState == "disconnected") "disconnected" else "connected")
    orbSolarView?.setAudioLevel(currentAudioLevel)
  }

  private fun dismissCenterX(): Float = screenWidth() / 2f

  private fun dismissCenterY(): Float = screenHeight() - dp(84f).toFloat()

  private fun attachDismissTarget() {
    if (isDismissAttached) return
    val windowType = resolveOverlayWindowType() ?: return
    val targetSize = dp(58f)

    val circle = TextView(context).apply {
      text = "✕"
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
      gravity = Gravity.CENTER
      background = createCircleBackground(
        Color.parseColor("#E6141414"),
        Color.parseColor("#4DFFFFFF")
      )
      elevation = dp(8f).toFloat()
      layoutParams = FrameLayout.LayoutParams(targetSize, targetSize, Gravity.CENTER)
    }

    val wrap = FrameLayout(context).apply {
      alpha = 0f
      scaleX = 0.78f
      scaleY = 0.78f
      addView(circle)
    }

    val boxSize = dp(76f)
    val lp = WindowManager.LayoutParams(
      boxSize,
      boxSize,
      windowType,
      baseOverlayFlags(touchable = false),
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = (dismissCenterX() - boxSize / 2f).toInt()
      y = (dismissCenterY() - boxSize / 2f).toInt()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        layoutInDisplayCutoutMode =
          WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      }
    }

    try {
      windowManager.addView(wrap, lp)
      dismissContainer = wrap
      dismissCircle = circle
      isDismissAttached = true
      isHoveringDismiss = false
      wrap.animate()
        .alpha(1f)
        .scaleX(1f)
        .scaleY(1f)
        .setDuration(150L)
        .setInterpolator(DecelerateInterpolator())
        .start()
    } catch (_: Throwable) {
      dismissContainer = null
      dismissCircle = null
      isDismissAttached = false
    }
  }

  private fun updateDismissHoverState(orbCenterX: Float, orbCenterY: Float) {
    if (!isDismissAttached) return
    val dist = hypot(
      (orbCenterX - dismissCenterX()).toDouble(),
      (orbCenterY - dismissCenterY()).toDouble()
    )
    val hovering = dist <= dismissHoverRadiusPx
    if (hovering == isHoveringDismiss) return
    isHoveringDismiss = hovering

    val circle = dismissCircle ?: return
    if (hovering) {
      hapticTick()
      circle.background = createCircleBackground(
        Color.parseColor("#F0EF4444"),
        Color.parseColor("#80FFFFFF")
      )
      circle.animate().scaleX(1.18f).scaleY(1.18f).setDuration(120L).start()
    } else {
      circle.background = createCircleBackground(
        Color.parseColor("#E6141414"),
        Color.parseColor("#4DFFFFFF")
      )
      circle.animate().scaleX(1f).scaleY(1f).setDuration(120L).start()
    }
  }

  private fun detachDismissTarget() {
    val wrap = dismissContainer
    dismissContainer = null
    dismissCircle = null
    isDismissAttached = false
    isHoveringDismiss = false
    if (wrap != null) {
      try {
        windowManager.removeViewImmediate(wrap)
      } catch (_: Throwable) {
        // Ignore if already detached
      }
    }
  }

  private fun buildConfirmCard(): LinearLayout {
    val card = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      background = createRoundedBackground(
        22f,
        Color.parseColor("#FA000000"),
        Color.parseColor("#38FFFFFF")
      )
      setPadding(dp(16f), dp(14f), dp(16f), dp(14f))
      elevation = dp(12f).toFloat()
    }

    val titleView = TextView(context).apply {
      setTextColor(Color.parseColor("#A1A1AA"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
      typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
    }

    val previewView = TextView(context).apply {
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      maxLines = 3
      ellipsize = TextUtils.TruncateAt.END
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        topMargin = dp(4f)
        bottomMargin = dp(12f)
      }
    }

    val btnRow = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.END
    }

    val cancelBtn = TextView(context).apply {
      text = "Cancel"
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
      gravity = Gravity.CENTER
      background = createRoundedBackground(16f, Color.parseColor("#141414"), Color.parseColor("#38FFFFFF"))
      setPadding(dp(14f), dp(8f), dp(14f), dp(8f))
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
        marginEnd = dp(8f)
      }
      setOnClickListener {
        val reqId = activeConfirmId ?: return@setOnClickListener
        activeConfirmId = null
        detachConfirmCard()
        restorePassiveStateOnMain(detachIfTransient = true)
        onConfirmResult(reqId, false)
      }
    }

    val approveBtn = TextView(context).apply {
      text = "Send"
      setTextColor(Color.BLACK)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
      gravity = Gravity.CENTER
      background = createRoundedBackground(16f, Color.WHITE, Color.WHITE)
      setPadding(dp(14f), dp(8f), dp(14f), dp(8f))
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      setOnClickListener {
        val reqId = activeConfirmId ?: return@setOnClickListener
        activeConfirmId = null
        detachConfirmCard()
        restorePassiveStateOnMain(detachIfTransient = true)
        onConfirmResult(reqId, true)
      }
    }

    btnRow.addView(cancelBtn)
    btnRow.addView(approveBtn)
    card.addView(titleView)
    card.addView(previewView)
    card.addView(btnRow)

    confirmTitleView = titleView
    confirmPreviewView = previewView
    sendButtonView = approveBtn
    return card
  }

  private fun attachOrUpdateConfirmCard(title: String, preview: String, approveLabel: String): Boolean {
    val windowType = resolveOverlayWindowType() ?: return false

    if (!isConfirmAttached) {
      val card = buildConfirmCard()
      val lp = WindowManager.LayoutParams(
        dp(304f),
        WindowManager.LayoutParams.WRAP_CONTENT,
        windowType,
        baseOverlayFlags(touchable = true),
        PixelFormat.TRANSLUCENT
      ).apply {
        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        y = dp(64f)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          layoutInDisplayCutoutMode =
            WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
      }
      try {
        windowManager.addView(card, lp)
        confirmCardView = card
        isConfirmAttached = true
      } catch (_: Throwable) {
        confirmCardView = null
        isConfirmAttached = false
        return false
      }
    }

    confirmTitleView?.text = title.ifBlank { "Confirm action" }
    confirmPreviewView?.text = preview.ifBlank { "Proceed with this action?" }
    sendButtonView?.text = approveLabel.ifBlank { "Send" }
    return true
  }

  private fun detachConfirmCard() {
    val card = confirmCardView
    confirmCardView = null
    confirmTitleView = null
    confirmPreviewView = null
    sendButtonView = null
    isConfirmAttached = false
    if (card != null) {
      try {
        card.animate().cancel()
        windowManager.removeViewImmediate(card)
      } catch (_: Throwable) {
        // Ignore if already detached
      }
    }
  }

  private fun ensureOrbAttached(): Boolean {
    val desiredType = resolveOverlayWindowType() ?: return false
    if (isAttached && attachedWindowType == desiredType) return true
    if (isAttached && attachedWindowType != desiredType) {
      // User granted "Display over other apps" — upgrade live to TYPE_APPLICATION_OVERLAY
      detachOrbOnly()
    }
    val lp = createOrbLayoutParams() ?: return false
    val view = buildOrbView()
    val shouldSuppress = isSuppressedBySystemUi &&
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1 &&
      desiredType == WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
    if (shouldSuppress) {
      view.visibility = View.GONE
      view.alpha = 0f
    }
    return try {
      windowManager.addView(view, lp)
      orbRoot = view
      orbLp = lp
      attachedWindowType = desiredType
      isAttached = true
      orbSolarView?.setPaused(shouldSuppress)
      stateBadgeText?.setPaused(shouldSuppress)
      syncDotPulsePlayback(shouldSuppress || currentState == "muted" || currentState == "disconnected")
      true
    } catch (_: Throwable) {
      orbRoot = null
      orbSolarView = null
      stateBadgeDot = null
      stateBadgeText = null
      orbLp = null
      attachedWindowType = null
      isAttached = false
      false
    }
  }

  private fun detachOrbOnly() {
    dotPulseAnimator?.cancel()
    dotPulseAnimator = null
    orbSolarView?.setPaused(true)
    stateBadgeText?.setPaused(true)
    val view = orbRoot
    orbRoot = null
    orbSolarView = null
    stateBadgeDot = null
    stateBadgeText = null
    orbLp = null
    attachedWindowType = null
    isAttached = false
    if (view != null) {
      try {
        view.animate().cancel()
        windowManager.removeViewImmediate(view)
      } catch (_: Throwable) {
        // Ignore if already detached
      }
    }
  }

  fun setSystemOverlaySuppressed(suppressed: Boolean) {
    mainHandler.post {
      if (isSuppressedBySystemUi == suppressed) return@post
      isSuppressedBySystemUi = suppressed
      val view = orbRoot ?: return@post
      if (!isAttached) return@post
      if (!isUsingAccessibilityLayer()) {
        orbSolarView?.setPaused(false)
        stateBadgeText?.setPaused(false)
        if (view.visibility != View.VISIBLE) {
          view.visibility = View.VISIBLE
          view.alpha = 1f
        }
        return@post
      }

      if (suppressed) {
        orbSolarView?.setPaused(true)
        stateBadgeText?.setPaused(true)
        syncDotPulsePlayback(true)
        isDragging = false
        detachDismissTarget()
        view.animate().cancel()
        view.animate()
          .alpha(0f)
          .setDuration(75L)
          .withEndAction {
            if (isSuppressedBySystemUi && isUsingAccessibilityLayer()) {
              view.visibility = View.GONE
            }
          }
          .start()
        confirmCardView?.visibility = View.GONE
      } else {
        view.animate().cancel()
        view.visibility = View.VISIBLE
        view.animate()
          .alpha(1f)
          .setDuration(140L)
          .setInterpolator(DecelerateInterpolator())
          .start()
        confirmCardView?.visibility = View.VISIBLE
        orbSolarView?.setPaused(false)
        stateBadgeText?.setPaused(false)
        syncDotPulsePlayback(currentState == "muted" || currentState == "disconnected")
      }
    }
  }

  private fun safeUpdateLayout(view: View, lp: WindowManager.LayoutParams) {
    try {
      windowManager.updateViewLayout(view, lp)
    } catch (_: Throwable) {
      // Ignore layout update race
    }
  }

  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
    } else {
      mainHandler.post(block)
    }
  }

  fun setAudioLevel(audioLevel: Float) {
    if (!isAttached) return
    val clamped = audioLevel.coerceIn(0f, 1f)
    mainHandler.post {
      if (!isAttached) return@post
      currentAudioLevel = clamped
      orbSolarView?.setAudioLevel(clamped)
    }
  }

  fun clearActionState() {
    mainHandler.post {
      actionLeaseUntilMs = 0L
      if (activeConfirmId == null && currentState == "acting") {
        restorePassiveStateOnMain(detachIfTransient = false)
      }
    }
  }

  fun setGesturePassthrough(passthrough: Boolean) {
    runOnMain {
      passthroughRefCount = if (passthrough) {
        passthroughRefCount + 1
      } else {
        max(0, passthroughRefCount - 1)
      }
      val view = orbRoot ?: return@runOnMain
      val lp = orbLp ?: return@runOnMain
      if (!isAttached) return@runOnMain
      val desiredFlags = baseOverlayFlags(touchable = passthroughRefCount == 0)
      if (lp.flags != desiredFlags) {
        lp.flags = desiredFlags
        safeUpdateLayout(view, lp)
      }
    }
  }

  fun showOrUpdate(
    state: String,
    statusText: String,
    audioLevel: Float,
    autoAttach: Boolean = true
  ): Boolean {
    if (resolveOverlayWindowType() == null) {
      return false
    }

    val nextState = state.ifBlank { "listening" }
    val nextStatus = statusText.take(28)
    val clampedAudio = audioLevel.coerceIn(0f, 1f)

    mainHandler.post {
      currentAudioLevel = clampedAudio
      if (autoAttach) {
        if (nextState != "acting" && nextState != "confirm") {
          attachedForCall = true
        }
        if (!ensureOrbAttached()) return@post
      } else if (!isAttached) {
        // Non-attaching update (e.g. text-chat automation): never spawn a zombie orb
        return@post
      }

      // Track last passive voice state (listening / speaking / thinking / muted / disconnected)
      if (nextState != "acting" && nextState != "confirm") {
        lastPassiveState = nextState
        if (nextStatus.isNotBlank()) {
          lastPassiveStatus = nextStatus
        }
      }

      // Priority state machine: confirm > active acting lease > passive voice state
      if (activeConfirmId != null && nextState != "confirm") {
        return@post
      }

      val now = System.currentTimeMillis()
      if (nextState == "acting") {
        actionLeaseUntilMs = now + 2600L
        currentState = "acting"
        if (nextStatus.isNotBlank()) currentStatus = nextStatus
        applyBadgeState()
        return@post
      }

      if (currentState == "acting" && now < actionLeaseUntilMs) {
        // Keep active action label visible while audio ticks arrive
        return@post
      }

      currentState = nextState
      if (nextStatus.isNotBlank()) {
        currentStatus = nextStatus
      }
      applyBadgeState()
    }
    return true
  }

  fun showConfirm(
    requestId: String,
    title: String,
    preview: String,
    approveLabel: String = "Send"
  ): Boolean {
    if (resolveOverlayWindowType() == null) return false
    mainHandler.post {
      wasAttachedBeforeConfirm = isAttached
      ensureOrbAttached()
      activeConfirmId = requestId
      actionLeaseUntilMs = 0L
      currentState = "confirm"
      currentStatus = "Confirm"
      applyBadgeState()
      val attached = attachOrUpdateConfirmCard(title, preview, approveLabel)
      if (!attached) {
        activeConfirmId = null
        restorePassiveStateOnMain(detachIfTransient = true)
        onConfirmResult(requestId, false)
      }
    }
    return true
  }

  fun clearConfirm(requestId: String? = null) {
    mainHandler.post {
      if (requestId == null || activeConfirmId == requestId) {
        activeConfirmId = null
        detachConfirmCard()
        if (currentState == "confirm") {
          restorePassiveStateOnMain(detachIfTransient = true)
        } else if (!wasAttachedBeforeConfirm && !attachedForCall) {
          detachOrbOnly()
        }
      }
    }
  }

  private fun clearActiveRipplesOnMain() {
    val snapshot = ArrayList(activeRipples)
    activeRipples.clear()
    for ((view, anim) in snapshot) {
      try { anim.cancel() } catch (_: Throwable) {}
      try { windowManager.removeViewImmediate(view) } catch (_: Throwable) {}
    }
  }

  fun hide() {
    runOnMain {
      settleAnimator?.cancel()
      settleAnimator = null
      val pendingId = activeConfirmId
      activeConfirmId = null
      wasAttachedBeforeConfirm = false
      attachedForCall = false
      passthroughRefCount = 0
      actionLeaseUntilMs = 0L
      isDragging = false
      clearActiveRipplesOnMain()
      detachDismissTarget()
      detachConfirmCard()
      detachOrbOnly()
      // Always resolve pending JS confirmation so phoneToolQueue never deadlocks for 25s
      if (pendingId != null) {
        onConfirmResult(pendingId, false)
      }
    }
  }

  fun showTapIndicator(x: Float, y: Float) {
    val windowType = resolveOverlayWindowType() ?: return
    mainHandler.post {
      val sizePx = dp(52f)
      val rippleView = TapRippleView(context)
      val lp = WindowManager.LayoutParams(
        sizePx,
        sizePx,
        windowType,
        baseOverlayFlags(touchable = false),
        PixelFormat.TRANSLUCENT
      ).apply {
        gravity = Gravity.TOP or Gravity.START
        this.x = (x - sizePx / 2f).toInt()
        this.y = (y - sizePx / 2f).toInt()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          layoutInDisplayCutoutMode =
            WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
      }

      try {
        windowManager.addView(rippleView, lp)
      } catch (_: Throwable) {
        return@post
      }

      val animator = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 300L
        interpolator = DecelerateInterpolator()
        addUpdateListener { anim ->
          rippleView.progress = anim.animatedValue as Float
          rippleView.invalidate()
        }
      }
      val entry = Pair<View, ValueAnimator>(rippleView, animator)
      activeRipples.add(entry)
      animator.addListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: Animator) {
          activeRipples.remove(entry)
          try {
            windowManager.removeViewImmediate(rippleView)
          } catch (_: Throwable) {
            // Ignore teardown race
          }
        }
      })
      animator.start()
    }
  }

  /**
   * Native Android Shimmer Glass label throttled to ~30fps with window-visibility gating.
   */
  private class ShimmerStatusTextView(context: Context) : TextView(context) {
    private val shimmerMatrix = Matrix()
    private var shimmerShader: LinearGradient? = null
    private var lastWidth = 0
    private var offsetPx = 0f
    private var shimmerEnabled = true
    private var paused = false
    private var windowVisible = true
    private var animating = false

    private val tick = object : Runnable {
      override fun run() {
        if (!animating || paused || !windowVisible || !shimmerEnabled || !isAttachedToWindow) return
        val w = width.toFloat()
        if (w > 0f) {
          offsetPx += w * 0.064f
          if (offsetPx > w * 2.2f) {
            offsetPx = -w * 1.1f
          }
          shimmerMatrix.setTranslate(offsetPx, 0f)
          shimmerShader?.setLocalMatrix(shimmerMatrix)
          invalidate()
        }
        postDelayed(this, 33L)
      }
    }

    fun setShimmerEnabled(enabled: Boolean) {
      if (shimmerEnabled == enabled) return
      shimmerEnabled = enabled
      if (!enabled) {
        stopShimmer()
        paint.shader = null
        setTextColor(Color.parseColor("#A1A1AA"))
        invalidate()
      } else {
        setTextColor(Color.WHITE)
        rebuildShader(width)
        startShimmer()
      }
    }

    fun setPaused(shouldPause: Boolean) {
      if (paused == shouldPause) return
      paused = shouldPause
      if (paused) {
        stopShimmer()
      } else if (shimmerEnabled && windowVisible && isAttachedToWindow) {
        startShimmer()
      }
    }

    private fun rebuildShader(w: Int) {
      if (w <= 0 || !shimmerEnabled) return
      lastWidth = w
      val span = max(w.toFloat(), 80f)
      shimmerShader = LinearGradient(
        -span * 0.6f,
        0f,
        span * 0.6f,
        0f,
        intArrayOf(
          Color.parseColor("#8CFFFFFF"),
          Color.parseColor("#FFFFFFFF"),
          Color.parseColor("#8CFFFFFF")
        ),
        floatArrayOf(0f, 0.5f, 1f),
        Shader.TileMode.CLAMP
      )
      paint.shader = shimmerShader
    }

    private fun startShimmer() {
      if (animating || paused || !windowVisible || !shimmerEnabled) return
      animating = true
      removeCallbacks(tick)
      postDelayed(tick, 33L)
    }

    private fun stopShimmer() {
      animating = false
      removeCallbacks(tick)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
      super.onSizeChanged(w, h, oldw, oldh)
      if (w > 0 && w != lastWidth) {
        rebuildShader(w)
      }
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
      super.onWindowVisibilityChanged(visibility)
      windowVisible = visibility == VISIBLE
      if (windowVisible && shimmerEnabled && !paused && isAttachedToWindow) {
        startShimmer()
      } else {
        stopShimmer()
      }
    }

    override fun onAttachedToWindow() {
      super.onAttachedToWindow()
      windowVisible = windowVisibility == VISIBLE
      if (shimmerEnabled && !paused && windowVisible) {
        rebuildShader(width)
        startShimmer()
      }
    }

    override fun onDetachedFromWindow() {
      stopShimmer()
      super.onDetachedFromWindow()
    }
  }

  private class TapRippleView(context: Context) : View(context) {
    var progress: Float = 0f
    private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = 4.5f
      color = Color.WHITE
    }
    private val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.FILL
      color = Color.WHITE
    }

    override fun onDraw(canvas: Canvas) {
      super.onDraw(canvas)
      val cx = width / 2f
      val cy = height / 2f
      val maxR = min(cx, cy) - 4f
      val alpha = ((1f - progress) * 230f).toInt().coerceIn(0, 255)
      ringPaint.alpha = alpha
      dotPaint.alpha = ((1f - progress) * 140f).toInt().coerceIn(0, 255)
      canvas.drawCircle(cx, cy, maxR * (0.25f + 0.75f * progress), ringPaint)
      canvas.drawCircle(cx, cy, maxR * 0.18f * (1f - progress * 0.5f), dotPaint)
    }
  }
}
