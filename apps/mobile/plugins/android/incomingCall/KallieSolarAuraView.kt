package com.kallie.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.Shader
import android.view.View
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Shared Native Android Solar Core Aura View (Option F — Solar Core):
 * Used identically on BOTH the Main Screen / Call Canvas (via KallieSolarAuraViewManager)
 * and the Movable Floating Overlay Orb (via KallieNotchOverlayController).
 *
 * Round-2 GPU/battery optimizations:
 * - Precomputed 72-point harmonic trig lookup tables (replaces 360 trig calls/frame with 6)
 * - Removed HWUI stencil-buffer canvas.clipPath(coronaPath) overhead
 * - Window visibility gating (pauses automatically when screen off or app backgrounded)
 * - Adaptive frame rate (~60fps active full-screen, ~30fps floating/idle, ~15fps muted/offline)
 */
class KallieSolarAuraView(context: Context) : View(context) {
  companion object {
    private const val CORONA_POINTS = 72
    private val COS_A = FloatArray(CORONA_POINTS)
    private val SIN_A = FloatArray(CORONA_POINTS)
    private val SIN_4A = FloatArray(CORONA_POINTS)
    private val COS_4A = FloatArray(CORONA_POINTS)
    private val COS_7A = FloatArray(CORONA_POINTS)
    private val SIN_7A = FloatArray(CORONA_POINTS)
    private val SIN_3A = FloatArray(CORONA_POINTS)
    private val COS_3A = FloatArray(CORONA_POINTS)

    init {
      for (i in 0 until CORONA_POINTS) {
        val angle = (i.toDouble() / CORONA_POINTS.toDouble()) * PI * 2.0
        COS_A[i] = cos(angle).toFloat()
        SIN_A[i] = sin(angle).toFloat()
        SIN_4A[i] = sin(angle * 4.0).toFloat()
        COS_4A[i] = cos(angle * 4.0).toFloat()
        COS_7A[i] = cos(angle * 7.0).toFloat()
        SIN_7A[i] = sin(angle * 7.0).toFloat()
        SIN_3A[i] = sin(angle * 3.0).toFloat()
        COS_3A[i] = cos(angle * 3.0).toFloat()
      }
    }
  }

  private val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val bloomPaints = Array(3) {
    Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  }
  private val corePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val hotspotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

  private val coronaPath = Path()
  private var lastShaderRadius = 0f
  private var lastTintBucket = -1

  private var mode: String = "idle"
  private var connectionStatus: String = "idle"
  private var rawAudioLevel: Float = 0.14f
  private var isFloatingMode: Boolean = false
  private var isAnimating: Boolean = false
  private var paused: Boolean = false
  private var windowVisible: Boolean = true

  private var phase: Float = 0f
  private var smoothedEnergy: Float = 0.14f
  private var smoothedBrightness: Float = 0.94f
  private var lastFrameNanos: Long = 0L

  private fun desiredFrameDelayMs(): Long {
    val isOffline = connectionStatus == "disconnected" || mode == "disconnected"
    val isMuted = mode == "muted"
    return when {
      isOffline || isMuted -> 66L // ~15fps low-power pulse
      isFloatingMode || mode == "idle" -> 33L // ~30fps smooth idle/floating
      else -> 0L // display VSYNC (active speaking/listening canvas)
    }
  }

  private val frameRunnable = object : Runnable {
    override fun run() {
      if (!isAnimating || paused || !windowVisible || !isAttachedToWindow) return
      val now = System.nanoTime()
      val dt = if (lastFrameNanos == 0L) {
        0.016f
      } else {
        ((now - lastFrameNanos) / 1_000_000_000f).coerceIn(0.008f, 0.08f)
      }
      lastFrameNanos = now
      stepAnimation(dt)
      invalidate()

      val delayMs = desiredFrameDelayMs()
      if (delayMs > 0L) {
        postDelayed(this, delayMs)
      } else {
        postOnAnimation(this)
      }
    }
  }

  fun setAuraState(state: String?) {
    val next = state?.trim()?.lowercase()?.ifBlank { "idle" } ?: "idle"
    if (mode != next) {
      mode = next
      if (isAttachedToWindow && !paused && windowVisible && !isAnimating) {
        startLoop()
      }
    }
  }

  fun setConnectionStatus(status: String?) {
    val next = status?.trim()?.lowercase()?.ifBlank { "idle" } ?: "idle"
    if (connectionStatus != next) {
      connectionStatus = next
      if (isAttachedToWindow && !paused && windowVisible && !isAnimating) {
        startLoop()
      }
    }
  }

  fun setAudioLevel(level: Float) {
    rawAudioLevel = level.coerceIn(0f, 1f)
  }

  fun setFloatingMode(floating: Boolean) {
    if (isFloatingMode != floating) {
      isFloatingMode = floating
      lastShaderRadius = 0f
      invalidate()
    }
  }

  fun setPaused(shouldPause: Boolean) {
    if (paused == shouldPause) return
    paused = shouldPause
    if (paused) {
      stopLoop()
    } else if (isAttachedToWindow && windowVisible && visibility == VISIBLE) {
      startLoop()
    }
  }

  private fun startLoop() {
    if (isAnimating || paused || !windowVisible || !isAttachedToWindow) return
    isAnimating = true
    lastFrameNanos = 0L
    removeCallbacks(frameRunnable)
    postOnAnimation(frameRunnable)
  }

  private fun stopLoop() {
    isAnimating = false
    lastFrameNanos = 0L
    removeCallbacks(frameRunnable)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    windowVisible = windowVisibility == VISIBLE
    if (!paused && windowVisible && visibility == VISIBLE) {
      startLoop()
    }
  }

  override fun onDetachedFromWindow() {
    stopLoop()
    super.onDetachedFromWindow()
  }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    windowVisible = visibility == VISIBLE
    if (windowVisible && isAttachedToWindow && !paused && this.visibility == VISIBLE) {
      startLoop()
    } else {
      stopLoop()
    }
  }

  override fun onVisibilityChanged(changedView: View, visibility: Int) {
    super.onVisibilityChanged(changedView, visibility)
    if (visibility == VISIBLE && isAttachedToWindow && !paused && windowVisible) {
      startLoop()
    } else if (visibility != VISIBLE) {
      stopLoop()
    }
  }

  private fun stepAnimation(dt: Float) {
    val isOffline = connectionStatus == "disconnected" || mode == "disconnected"
    val isWeak = connectionStatus == "weak"
    val isMuted = mode == "muted"

    val targetEnergy = when {
      isOffline -> 0.06f
      isMuted -> 0.08f
      mode == "speaking" -> max(0.56f, min(1f, if (rawAudioLevel > 0.04f) rawAudioLevel else 0.78f))
      mode == "acting" || mode == "thinking" -> 0.52f
      mode == "connecting" || connectionStatus == "connecting" -> 0.42f
      mode == "listening" -> max(0.24f, min(0.76f, 0.24f + rawAudioLevel * 0.58f))
      else -> 0.14f
    }

    val targetBrightness = when {
      isOffline -> 0.44f
      isMuted -> 0.54f
      isWeak -> 0.72f
      mode == "speaking" -> 1.0f
      mode == "listening" || mode == "acting" || mode == "thinking" -> 0.96f
      else -> 0.92f
    }

    val energyLerp = min(1f, dt * (if (mode == "speaking") 11f else 5.5f))
    smoothedEnergy += (targetEnergy - smoothedEnergy) * energyLerp
    smoothedBrightness += (targetBrightness - smoothedBrightness) * min(1f, dt * 4.5f)

    val speed = when {
      isOffline || isMuted -> 0.35f
      mode == "speaking" -> 1.75f
      mode == "acting" || mode == "thinking" -> 1.45f
      mode == "connecting" || connectionStatus == "connecting" -> 1.30f
      mode == "listening" -> 1.0f
      else -> 0.62f
    }

    phase = (phase + dt * speed * 1.45f) % (PI.toFloat() * 200f)
  }

  private fun currentTintBucket(): Int {
    return when {
      connectionStatus == "disconnected" || mode == "disconnected" -> 2
      connectionStatus == "weak" || mode == "muted" -> 1
      else -> 0
    }
  }

  private fun ensureShaders(cx: Float, cy: Float, baseR: Float) {
    val bucket = currentTintBucket()
    if (baseR <= 0f || (abs(baseR - lastShaderRadius) < 0.5f && bucket == lastTintBucket)) {
      return
    }
    lastShaderRadius = baseR
    lastTintBucket = bucket

    shadowPaint.shader = RadialGradient(
      cx,
      cy + baseR * 0.14f,
      baseR * 1.50f,
      intArrayOf(
        Color.parseColor("#66000000"),
        Color.parseColor("#24000000"),
        Color.TRANSPARENT
      ),
      floatArrayOf(0.45f, 0.75f, 1f),
      Shader.TileMode.CLAMP
    )

    val coreColors = when (bucket) {
      2 -> intArrayOf(
        Color.parseColor("#7A7A86"),
        Color.parseColor("#52525B"),
        Color.parseColor("#2E2E36"),
        Color.parseColor("#2652525B")
      )
      1 -> intArrayOf(
        Color.parseColor("#D4D4DC"),
        Color.parseColor("#A8A8B4"),
        Color.parseColor("#72727E"),
        Color.parseColor("#33A8A8B4")
      )
      else -> intArrayOf(
        Color.parseColor("#FFFFFF"),
        Color.parseColor("#F5F5F9"),
        Color.parseColor("#D6D6E2"),
        Color.parseColor("#44FFFFFF")
      )
    }

    corePaint.shader = RadialGradient(
      cx - baseR * 0.14f,
      cy - baseR * 0.16f,
      baseR * 1.24f,
      coreColors,
      floatArrayOf(0f, 0.58f, 0.88f, 1f),
      Shader.TileMode.CLAMP
    )

    val bloomColor = when (bucket) {
      2 -> Color.parseColor("#71717A")
      1 -> Color.parseColor("#D4D4D8")
      else -> Color.WHITE
    }

    for (k in 0..2) {
      val mult = 1.28f + k * 0.28f
      bloomPaints[k].shader = RadialGradient(
        cx,
        cy,
        baseR * mult,
        intArrayOf(
          bloomColor,
          Color.TRANSPARENT
        ),
        floatArrayOf(0.32f, 1f),
        Shader.TileMode.CLAMP
      )
    }

    hotspotPaint.shader = RadialGradient(
      cx,
      cy,
      baseR * 0.72f,
      intArrayOf(
        Color.parseColor("#CCFFFFFF"),
        Color.parseColor("#38FFFFFF"),
        Color.TRANSPARENT
      ),
      floatArrayOf(0f, 0.52f, 1f),
      Shader.TileMode.CLAMP
    )
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val w = width.toFloat()
    val h = height.toFloat()
    if (w <= 0f || h <= 0f) return

    val cx = w / 2f
    val cy = h / 2f
    val minDim = min(w, h)
    // Reserve generous room around the core so the 3-layer velvety solar bloom never clips
    val baseR = minDim * 0.275f
    val dynamicR = baseR * (1f + smoothedEnergy * 0.115f)
    ensureShaders(cx, cy, baseR)

    // 1. Grounded soft elevation shadow when floating over other apps
    if (isFloatingMode) {
      canvas.drawCircle(cx, cy + baseR * 0.12f, baseR * 1.48f, shadowPaint)
    }

    // 2. 3-Layer Velvety Radial Solar Emission Bloom
    val bloomScale = 1f + smoothedEnergy * 0.16f
    for (k in 2 downTo 0) {
      val layerMult = 1.28f + k * 0.28f
      val baseOpacity = (0.30f / (k + 1)) + smoothedEnergy * (0.14f / (k + 1) * 1.4f)
      bloomPaints[k].alpha = (baseOpacity * smoothedBrightness * 255f).toInt().coerceIn(0, 255)
      canvas.save()
      canvas.scale(bloomScale, bloomScale, cx, cy)
      canvas.drawCircle(cx, cy, baseR * layerMult, bloomPaints[k])
      canvas.restore()
    }

    // 3. Solid Incandescent Solar Core with LUT-accelerated 72-Point Harmonic Corona Undulation
    val ampA = baseR * (0.020f + smoothedEnergy * 0.068f)
    val ampB = baseR * (0.011f + smoothedEnergy * 0.032f)
    val ampC = baseR * (0.006f + smoothedEnergy * 0.018f)

    val pA = phase * 2.4
    val pB = phase * 1.85
    val pC = phase * 1.15
    val cosPA = cos(pA).toFloat()
    val sinPA = sin(pA).toFloat()
    val cosPB = cos(pB).toFloat()
    val sinPB = sin(pB).toFloat()
    val cosPC = cos(pC).toFloat()
    val sinPC = sin(pC).toFloat()

    coronaPath.reset()
    for (i in 0 until CORONA_POINTS) {
      // sin(4a + pA) = sin(4a)cos(pA) + cos(4a)sin(pA)
      val wA = (SIN_4A[i] * cosPA + COS_4A[i] * sinPA) * ampA
      // cos(7a - pB) = cos(7a)cos(pB) + sin(7a)sin(pB)
      val wB = (COS_7A[i] * cosPB + SIN_7A[i] * sinPB) * ampB
      // sin(3a + pC) = sin(3a)cos(pC) + cos(3a)sin(pC)
      val wC = (SIN_3A[i] * cosPC + COS_3A[i] * sinPC) * ampC
      val r = dynamicR + wA + wB + wC
      val px = cx + COS_A[i] * r
      val py = cy + SIN_A[i] * r
      if (i == 0) {
        coronaPath.moveTo(px, py)
      } else {
        coronaPath.lineTo(px, py)
      }
    }
    coronaPath.close()

    corePaint.alpha = (smoothedBrightness * 255f).toInt().coerceIn(120, 255)
    canvas.drawPath(coronaPath, corePaint)

    // 4. Subtle drifting internal solar luminance hotspot (stays inside core without stencil clipPath)
    val hotX = cos(phase * 0.85).toFloat() * dynamicR * 0.14f
    val hotY = sin(phase * 1.10).toFloat() * dynamicR * 0.14f
    canvas.save()
    canvas.translate(hotX, hotY)
    hotspotPaint.alpha = ((0.38f + smoothedEnergy * 0.42f) * smoothedBrightness * 255f).toInt().coerceIn(0, 255)
    canvas.drawCircle(cx, cy, baseR * 0.72f, hotspotPaint)
    canvas.restore()
  }
}
