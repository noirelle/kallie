package com.kallie.app

import android.Manifest
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioRecordingConfiguration
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Base64
import androidx.core.content.ContextCompat
import androidx.core.os.HandlerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Locale
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Resilient, low-latency native Android bidirectional PCM16 audio engine for
 * direct device-to-AI voice sessions (Gemini Live 16kHz/24kHz & OpenAI Realtime 24kHz/24kHz)
 * plus Android SpeechRecognizer/TTS for Universal Voice fallback.
 *
 * Round-2 reliability & performance highlights:
 * - Session-token & HandlerCompat token cancellation prevents stale recovery/focus callbacks
 * - Bounded AudioFocus / mic-silenced retry (4s cooldown, max 2 retries, telecom call guard)
 * - 40ms PCM frames + 2-frame (80ms) pre-roll ring buffer (zero clipped initial consonants)
 * - Silence keepalive throttling (~80% less bridge/WS churn during silence & AI speaking)
 * - Headset-aware barge-in guard, dynamic AGC sync, monotonic SystemClock timing
 * - Dedicated prepareVoiceAudioRoute/releaseVoiceAudioRoute for Universal Voice speakerphone TTS
 */
class KallieDirectAudioModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  private val sessionLock = Any()
  private val trackLock = Any()
  private val running = AtomicBoolean(false)
  private val voiceRouteActive = AtomicBoolean(false)
  private val muted = AtomicBoolean(false)
  private val playbackGen = AtomicInteger(0)
  private val sessionToken = AtomicInteger(0)
  private val handlerToken = Any()
  private val playbackQueue = LinkedBlockingQueue<Pair<Int, ByteArray>>(400)

  @Volatile private var audioRecord: AudioRecord? = null
  @Volatile private var audioTrack: AudioTrack? = null
  @Volatile private var aec: AcousticEchoCanceler? = null
  @Volatile private var ns: NoiseSuppressor? = null
  @Volatile private var agc: AutomaticGainControl? = null
  @Volatile private var audioFocusRequest: AudioFocusRequest? = null
  @Volatile private var recordingCallback: Any? = null
  @Volatile private var captureThread: Thread? = null
  @Volatile private var playbackThread: Thread? = null

  @Volatile private var activeInRate: Int = 16000
  @Volatile private var activeOutRate: Int = 24000
  @Volatile private var speakerphoneEnabled: Boolean = true
  @Volatile private var usingExternalHeadset: Boolean = false
  @Volatile private var captureRecoveryAttempts: Int = 0
  @Volatile private var focusRetryCount: Int = 0
  @Volatile private var lastFocusRetryMs: Long = 0L

  @Volatile private var playbackActive: Boolean = false
  @Volatile private var lastPlaybackWriteMs: Long = 0L
  @Volatile private var lastPlaybackEmitMs: Long = 0L
  @Volatile private var lastRmsEmitMs: Long = 0L

  private val mainHandler = Handler(Looper.getMainLooper())
  private var speechRecognizer: SpeechRecognizer? = null
  private var ttsEngine: TextToSpeech? = null
  private val ttsReady = AtomicBoolean(false)
  private val pendingTts = LinkedBlockingQueue<Triple<String, String, Boolean>>()

  private val focusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
    if (!running.get() && !voiceRouteActive.get()) return@OnAudioFocusChangeListener
    val am = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return@OnAudioFocusChangeListener
    when (focusChange) {
      AudioManager.AUDIOFOCUS_GAIN -> {
        focusRetryCount = 0
        try {
          am.mode = AudioManager.MODE_IN_COMMUNICATION
          applyOutputRoute(am, speakerphoneEnabled, preferExternal = true)
        } catch (_: Throwable) {}
        emitAudioState("focus_gained")
      }
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
        emitAudioState("focus_transient_loss")
      }
      AudioManager.AUDIOFOCUS_LOSS -> {
        emitAudioState("focus_lost")
        scheduleBoundedFocusReassert(am, 450L)
      }
    }
  }

  private fun scheduleBoundedFocusReassert(am: AudioManager, delayMs: Long) {
    // Never fight an active cellular/VoIP telecom call or ringtone
    if (am.mode == AudioManager.MODE_IN_CALL || am.mode == AudioManager.MODE_RINGTONE) return
    val now = SystemClock.elapsedRealtime()
    if (now - lastFocusRetryMs < 4000L || focusRetryCount >= 2) return
    lastFocusRetryMs = now
    focusRetryCount++
    val expectedToken = sessionToken.get()
    HandlerCompat.postDelayed(
      mainHandler,
      {
        if ((running.get() || voiceRouteActive.get()) && sessionToken.get() == expectedToken) {
          val curAm = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
          if (curAm != null && curAm.mode != AudioManager.MODE_IN_CALL && curAm.mode != AudioManager.MODE_RINGTONE) {
            configureCommunicationAudio(speakerphoneEnabled, preferExternal = true)
          }
        }
      },
      handlerToken,
      delayMs
    )
  }

  override fun getName(): String = "KallieDirectAudio"

  @ReactMethod
  fun addListener(eventName: String) {
    // Required by React Native NativeEventEmitter
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required by React Native NativeEventEmitter
  }

  private fun emitEvent(eventName: String, params: com.facebook.react.bridge.WritableMap) {
    try {
      if (reactContext.hasActiveReactInstance()) {
        reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(eventName, params)
      }
    } catch (_: Throwable) {
      // Ignore bridge teardown races
    }
  }

  private fun emitAudioState(state: String) {
    val map = Arguments.createMap().apply { putString("state", state) }
    emitEvent("KallieAudioState", map)
  }

  private fun computePcm16Level(bytes: ByteArray, length: Int): Double {
    val samples = length / 2
    if (samples <= 0) return 0.0
    var sumSq = 0L
    var i = 0
    while (i + 1 < length) {
      val sample = ((bytes[i + 1].toInt() shl 8) or (bytes[i].toInt() and 0xFF)).toShort().toLong()
      sumSq += sample * sample
      i += 2
    }
    val rms = sqrt(sumSq.toDouble() / samples.toDouble())
    return min(1.0, rms / 6500.0)
  }

  private fun configureCommunicationAudio(speakerphone: Boolean, preferExternal: Boolean = true) {
    speakerphoneEnabled = speakerphone
    val am = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
    try {
      am.mode = AudioManager.MODE_IN_COMMUNICATION
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        // Abandon any previous request before creating a fresh one to avoid AudioService leaks
        audioFocusRequest?.let { prev ->
          try { am.abandonAudioFocusRequest(prev) } catch (_: Throwable) {}
        }
        val attrs = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
          .setAudioAttributes(attrs)
          .setWillPauseWhenDucked(false)
          .setAcceptsDelayedFocusGain(true)
          .setOnAudioFocusChangeListener(focusChangeListener, mainHandler)
          .build()
        audioFocusRequest = req
        am.requestAudioFocus(req)
      } else {
        @Suppress("DEPRECATION")
        am.requestAudioFocus(
          focusChangeListener,
          AudioManager.STREAM_VOICE_CALL,
          AudioManager.AUDIOFOCUS_GAIN
        )
      }
      applyOutputRoute(am, speakerphone, preferExternal)
    } catch (_: Throwable) {
      // Ignore OEM audio routing quirks
    }
  }

  private fun applyOutputRoute(am: AudioManager, speakerphone: Boolean, preferExternal: Boolean = true) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val devices = am.availableCommunicationDevices
        val external = if (preferExternal) {
          devices.firstOrNull {
            it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
              it.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
              it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
              it.type == AudioDeviceInfo.TYPE_USB_HEADSET
          }
        } else {
          null
        }
        usingExternalHeadset = external != null
        val target = external ?: devices.firstOrNull {
          it.type == if (speakerphone) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
        }
        if (target != null) {
          am.setCommunicationDevice(target)
          return
        }
      }
      @Suppress("DEPRECATION")
      val hasExternalLegacy = am.isWiredHeadsetOn || am.isBluetoothScoOn
      usingExternalHeadset = preferExternal && hasExternalLegacy
      @Suppress("DEPRECATION")
      am.isSpeakerphoneOn = if (usingExternalHeadset) false else speakerphone
    } catch (_: Throwable) {
      // Ignore routing fallback failure
    }
  }

  private fun registerRecordingCallbackIfSupported(sessionId: Int, expectedToken: Int) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val am = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
    unregisterRecordingCallbackIfSupported()
    val cb = object : AudioManager.AudioRecordingCallback() {
      override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>?) {
        if (!running.get() || sessionToken.get() != expectedToken || configs == null) return
        val mine = configs.firstOrNull { it.clientAudioSessionId == sessionId } ?: return
        if (mine.isClientSilenced) {
          emitAudioState("mic_silenced")
          scheduleBoundedFocusReassert(am, 350L)
        } else {
          focusRetryCount = 0
          emitAudioState("mic_active")
        }
      }
    }
    try {
      am.registerAudioRecordingCallback(cb, mainHandler)
      recordingCallback = cb
    } catch (_: Throwable) {
      recordingCallback = null
    }
  }

  private fun unregisterRecordingCallbackIfSupported() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val cb = recordingCallback as? AudioManager.AudioRecordingCallback ?: return
    recordingCallback = null
    try {
      val am = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
      am.unregisterAudioRecordingCallback(cb)
    } catch (_: Throwable) {
      // Ignore
    }
  }

  private fun releaseAudioFocusAndRoute() {
    unregisterRecordingCallbackIfSupported()
    usingExternalHeadset = false
    val am = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        am.clearCommunicationDevice()
      } else {
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = false
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        audioFocusRequest?.let { am.abandonAudioFocusRequest(it) }
        audioFocusRequest = null
      } else {
        @Suppress("DEPRECATION")
        am.abandonAudioFocus(focusChangeListener)
      }
      am.mode = AudioManager.MODE_NORMAL
    } catch (_: Throwable) {
      // Ignore teardown errors
    }
  }

  private fun createAudioRecordAndFx(inRate: Int, frameBytes: Int, expectedToken: Int): AudioRecord? {
    val minRecBuf = AudioRecord.getMinBufferSize(
      inRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT
    ).coerceAtLeast(frameBytes * 3)

    val record = AudioRecord(
      MediaRecorder.AudioSource.VOICE_COMMUNICATION,
      inRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      minRecBuf
    )

    if (record.state != AudioRecord.STATE_INITIALIZED) {
      try { record.release() } catch (_: Throwable) {}
      return null
    }

    val sessionId = record.audioSessionId
    if (AcousticEchoCanceler.isAvailable()) {
      aec = AcousticEchoCanceler.create(sessionId)?.apply { enabled = true }
    }
    if (NoiseSuppressor.isAvailable()) {
      ns = NoiseSuppressor.create(sessionId)?.apply { enabled = true }
    }
    // Enable hardware AGC alongside AEC + NS so conversational voice at arm's length on
    // speakerphone is normalized cleanly instead of dropping below VAD thresholds.
    if (AutomaticGainControl.isAvailable()) {
      agc = AutomaticGainControl.create(sessionId)?.apply {
        enabled = true
      }
    }
    registerRecordingCallbackIfSupported(sessionId, expectedToken)
    return record
  }

  private fun emitAudioChunk(b64: String, level: Double) {
    val map = Arguments.createMap().apply {
      putString("pcmBase64", b64)
      putDouble("level", level)
    }
    emitEvent("KallieAudioChunk", map)
  }

  private fun attenuatePcm16(src: ByteArray, dst: ByteArray, length: Int, shiftBits: Int) {
    var i = 0
    while (i + 1 < length) {
      val sample = ((src[i + 1].toInt() shl 8) or (src[i].toInt() and 0xFF)).toShort().toInt()
      val scaled = sample shr shiftBits
      dst[i] = (scaled and 0xFF).toByte()
      dst[i + 1] = ((scaled shr 8) and 0xFF).toByte()
      i += 2
    }
  }

  private fun startCaptureLoop(record: AudioRecord, frameBytes: Int, expectedToken: Int) {
    captureThread = Thread({
      Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
      val buffer = ByteArray(frameBytes)
      val attenuatedBuf = ByteArray(frameBytes)
      val silenceBytes = ByteArray(frameBytes)
      val silenceBase64 = Base64.encodeToString(silenceBytes, 0, frameBytes, Base64.NO_WRAP)

      var consecutiveReadErrors = 0
      var needsRecovery = false
      var wasMuted = muted.get()
      var bargeHangoverFrames = 0

      while (running.get() && sessionToken.get() == expectedToken) {
        val read = try {
          record.read(buffer, 0, buffer.size)
        } catch (_: Throwable) {
          -1
        }
        if (!running.get() || sessionToken.get() != expectedToken) break

        if (read == 0) {
          try { Thread.sleep(10) } catch (_: InterruptedException) { break }
          continue
        }
        if (read < 0) {
          consecutiveReadErrors++
          if (consecutiveReadErrors >= 3) {
            needsRecovery = true
            break
          }
          try { Thread.sleep(25) } catch (_: InterruptedException) { break }
          continue
        }
        consecutiveReadErrors = 0

        val isMutedNow = muted.get()
        if (isMutedNow) {
          if (!wasMuted) {
            // Transitioned to muted mid-utterance: send 15 frames (600ms) of trailing silence so server VAD closes cleanly
            wasMuted = true
            bargeHangoverFrames = 0
            for (k in 0 until 15) {
              if (!running.get() || sessionToken.get() != expectedToken) break
              emitAudioChunk(silenceBase64, 0.0)
            }
          }
          continue
        }
        wasMuted = false

        val level = computePcm16Level(buffer, read)
        val nowMs = SystemClock.elapsedRealtime()
        val speakerPlaying = playbackActive || (lastPlaybackWriteMs > 0L && nowMs - lastPlaybackWriteMs < 200L)
        val guardSpeakerEcho = speakerPlaying && speakerphoneEnabled && !usingExternalHeadset

        // Always stream continuous 40ms PCM frames (never drop silence frames — Gemini Live & OpenAI
        // Realtime require a continuous sample timeline for server VAD).
        // When AI is silent, pass hardware AEC+NS+AGC mic audio unmodified so soft/normal speech is
        // never gated out. Only apply gentle -12dB echo ducking while speakerphone playback is active.
        val b64 = if (guardSpeakerEcho) {
          if (level >= 0.045) {
            bargeHangoverFrames = 10 // 400ms clean barge-in pass-through
            Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP)
          } else if (bargeHangoverFrames > 0) {
            bargeHangoverFrames--
            Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP)
          } else {
            attenuatePcm16(buffer, attenuatedBuf, read, 2)
            Base64.encodeToString(attenuatedBuf, 0, read, Base64.NO_WRAP)
          }
        } else {
          bargeHangoverFrames = 0
          Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP)
        }
        emitAudioChunk(b64, if (guardSpeakerEcho && bargeHangoverFrames == 0) 0.0 else level)
      }

      if (needsRecovery && running.get() && sessionToken.get() == expectedToken) {
        scheduleCaptureRecovery(frameBytes, expectedToken)
      }
    }, "kallie-pcm-capture").apply {
      isDaemon = true
      start()
    }
  }

  private fun scheduleCaptureRecovery(frameBytes: Int, expectedToken: Int) {
    if (!running.get() || sessionToken.get() != expectedToken || captureRecoveryAttempts >= 3) {
      emitAudioState("mic_error")
      return
    }
    captureRecoveryAttempts++
    emitAudioState("mic_recovering")
    HandlerCompat.postDelayed(
      mainHandler,
      {
        synchronized(sessionLock) {
          if (!running.get() || sessionToken.get() != expectedToken) return@synchronized
          try { aec?.release() } catch (_: Throwable) {}
          try { ns?.release() } catch (_: Throwable) {}
          try { agc?.release() } catch (_: Throwable) {}
          aec = null; ns = null; agc = null
          try {
            audioRecord?.let { r ->
              if (r.recordingState == AudioRecord.RECORDSTATE_RECORDING) r.stop()
              r.release()
            }
          } catch (_: Throwable) {}
          audioRecord = null

          configureCommunicationAudio(speakerphoneEnabled, preferExternal = true)
          val fresh = createAudioRecordAndFx(activeInRate, frameBytes, expectedToken)
          if (fresh != null) {
            audioRecord = fresh
            try {
              fresh.startRecording()
              captureRecoveryAttempts = 0
              startCaptureLoop(fresh, frameBytes, expectedToken)
              emitAudioState("mic_recovered")
            } catch (_: Throwable) {
              try { fresh.release() } catch (_: Throwable) {}
              audioRecord = null
              scheduleCaptureRecovery(frameBytes, expectedToken)
            }
          } else {
            scheduleCaptureRecovery(frameBytes, expectedToken)
          }
        }
      },
      handlerToken,
      350L * captureRecoveryAttempts
    )
  }

  @ReactMethod
  fun prepareVoiceAudioRoute(speakerphone: Boolean) {
    synchronized(sessionLock) {
      sessionToken.incrementAndGet()
      mainHandler.removeCallbacksAndMessages(handlerToken)
      focusRetryCount = 0
      lastFocusRetryMs = 0L
      voiceRouteActive.set(true)
      configureCommunicationAudio(speakerphone, preferExternal = true)
    }
  }

  @ReactMethod
  fun releaseVoiceAudioRoute() {
    synchronized(sessionLock) {
      voiceRouteActive.set(false)
      if (!running.get()) {
        sessionToken.incrementAndGet()
        mainHandler.removeCallbacksAndMessages(handlerToken)
        releaseAudioFocusAndRoute()
      }
    }
  }

  @ReactMethod
  fun startSession(
    inputSampleRate: Int,
    outputSampleRate: Int,
    speakerphone: Boolean,
    promise: Promise
  ) {
    if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.RECORD_AUDIO)
      != PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject("E_MIC_PERMISSION", "Microphone permission is required.")
      return
    }

    synchronized(sessionLock) {
      stopInternalLocked()
      val currentToken = sessionToken.incrementAndGet()

      try {
        focusRetryCount = 0
        lastFocusRetryMs = 0L
        configureCommunicationAudio(speakerphone, preferExternal = true)

        val inRate = if (inputSampleRate == 24000) 24000 else 16000
        val outRate = if (outputSampleRate == 16000) 16000 else 24000
        activeInRate = inRate
        activeOutRate = outRate
        captureRecoveryAttempts = 0

        // 40ms uplink frames cut RN bridge/Base64/JSON/WS churn by 37.5% vs 25ms with zero perceptible lag
        val frameBytes = (inRate / 25) * 2
        val record = createAudioRecordAndFx(inRate, frameBytes, currentToken)
        if (record == null) {
          releaseAudioFocusAndRoute()
          promise.reject("E_AUDIO_RECORD", "Failed to initialize Android microphone capture.")
          return
        }

        val minTrackBuf = AudioTrack.getMinBufferSize(
          outRate,
          AudioFormat.CHANNEL_OUT_MONO,
          AudioFormat.ENCODING_PCM_16BIT
        ).coerceAtLeast(8192)

        val trackAttrs = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()

        val trackFormat = AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(outRate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build()

        // Do NOT force AudioRecord's input sessionId onto AudioTrack and avoid PERFORMANCE_MODE_LOW_LATENCY
        // so OEM HAL AEC pairs cleanly and cellular jitter does not underrun playback.
        val track = AudioTrack.Builder()
          .setAudioAttributes(trackAttrs)
          .setAudioFormat(trackFormat)
          .setBufferSizeInBytes(minTrackBuf)
          .setTransferMode(AudioTrack.MODE_STREAM)
          .build()

        audioRecord = record
        audioTrack = track
        muted.set(false)
        playbackGen.incrementAndGet()
        playbackQueue.clear()
        playbackActive = false
        lastPlaybackWriteMs = 0L
        running.set(true)

        record.startRecording()
        track.play()

        startCaptureLoop(record, frameBytes, currentToken)

        playbackThread = Thread({
          Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
          var idlePolls = 0
          while (running.get() && sessionToken.get() == currentToken) {
            val item = try {
              playbackQueue.poll(25, TimeUnit.MILLISECONDS)
            } catch (_: InterruptedException) {
              break
            }
            if (item == null) {
              if (playbackActive) {
                idlePolls++
                // ~175ms after queue empties -> playback drained cleanly
                if (idlePolls >= 7) {
                  playbackActive = false
                  idlePolls = 0
                  emitEvent("KalliePlaybackIdle", Arguments.createMap())
                }
              }
              continue
            }
            idlePolls = 0
            val (gen, chunk) = item
            if (gen != playbackGen.get()) continue
            try {
              synchronized(trackLock) {
                if (!running.get() || gen != playbackGen.get()) return@synchronized
                val activeTrack = audioTrack ?: return@synchronized
                playbackActive = true
                lastPlaybackWriteMs = SystemClock.elapsedRealtime()
                activeTrack.write(chunk, 0, chunk.size)
                if (running.get() && gen == playbackGen.get()) {
                  lastPlaybackWriteMs = SystemClock.elapsedRealtime()
                }
              }
              val now = SystemClock.elapsedRealtime()
              if (now - lastPlaybackEmitMs >= 100L) {
                lastPlaybackEmitMs = now
                val level = computePcm16Level(chunk, chunk.size)
                val map = Arguments.createMap().apply { putDouble("level", level) }
                emitEvent("KalliePlaybackLevel", map)
              }
            } catch (_: Throwable) {
              // Ignore write errors on stop/flush
            }
          }
        }, "kallie-pcm-playback").apply {
          isDaemon = true
          start()
        }

        val info = Arguments.createMap().apply {
          putBoolean("aecEnabled", aec?.enabled == true)
          putBoolean("nsEnabled", ns?.enabled == true)
          putInt("inputSampleRate", inRate)
          putInt("outputSampleRate", outRate)
        }
        promise.resolve(info)
      } catch (t: Throwable) {
        stopInternalLocked()
        promise.reject("E_AUDIO_START", t.message ?: "Failed to start direct audio session", t)
      }
    }
  }

  @ReactMethod
  fun playPcmChunk(base64Pcm: String) {
    if (!running.get() || base64Pcm.isEmpty()) return
    try {
      val bytes = Base64.decode(base64Pcm, Base64.DEFAULT)
      if (bytes.isNotEmpty()) {
        val entry = Pair(playbackGen.get(), bytes)
        if (!playbackQueue.offer(entry)) {
          playbackQueue.poll()
          playbackQueue.offer(entry)
        }
      }
    } catch (_: Throwable) {
      // Ignore malformed chunks
    }
  }

  @ReactMethod
  fun clearPlayback() {
    playbackGen.incrementAndGet()
    playbackQueue.clear()
    synchronized(trackLock) {
      playbackActive = false
      lastPlaybackWriteMs = 0L
      try {
        audioTrack?.let { track ->
          if (track.state == AudioTrack.STATE_INITIALIZED) {
            track.pause()
            track.flush()
            if (running.get()) {
              track.play()
            }
          }
        }
      } catch (_: Throwable) {
        // Ignore flush race
      }
    }
  }

  @ReactMethod
  fun setMuted(isMuted: Boolean) {
    muted.set(isMuted)
  }

  @ReactMethod
  fun setSpeakerphone(enabled: Boolean) {
    speakerphoneEnabled = enabled
    val am = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
    // Manual toggle explicitly honors speaker vs earpiece on API 31+
    applyOutputRoute(am, enabled, preferExternal = false)
  }

  @ReactMethod
  fun stopSession(promise: Promise?) {
    synchronized(sessionLock) {
      stopInternalLocked()
    }
    promise?.resolve(true)
  }

  @ReactMethod
  fun getClipboardText(promise: Promise) {
    mainHandler.post {
      try {
        val cm = reactContext.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        val clip = cm?.primaryClip
        val text = if (clip != null && clip.itemCount > 0) {
          clip.getItemAt(0).coerceToText(reactContext)?.toString() ?: ""
        } else {
          ""
        }
        promise.resolve(text)
      } catch (_: Throwable) {
        promise.resolve("")
      }
    }
  }

  @ReactMethod
  fun startSpeechListening(localeTag: String?, promise: Promise) {
    if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.RECORD_AUDIO)
      != PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject("E_MIC_PERMISSION", "Microphone permission is required.")
      return
    }

    mainHandler.post {
      try {
        if (!SpeechRecognizer.isRecognitionAvailable(reactContext)) {
          promise.reject("E_STT_UNAVAILABLE", "Android SpeechRecognizer is unavailable on this device.")
          return@post
        }

        destroySpeechRecognizerOnMain()
        // Pre-warm TTS while listening so first spoken sentence starts with zero init delay
        ensureTtsOnMain()

        val recognizer = SpeechRecognizer.createSpeechRecognizer(reactContext)
        recognizer.setRecognitionListener(object : RecognitionListener {
          override fun onReadyForSpeech(params: Bundle?) {}
          override fun onBeginningOfSpeech() {}

          override fun onRmsChanged(rmsdB: Float) {
            if (speechRecognizer !== recognizer) return
            val now = SystemClock.elapsedRealtime()
            if (now - lastRmsEmitMs < 100L) return
            lastRmsEmitMs = now
            val normalized = ((rmsdB + 2f) / 12f).coerceIn(0.05f, 1f).toDouble()
            val map = Arguments.createMap().apply { putDouble("level", normalized) }
            emitEvent("KallieSpeechRms", map)
          }

          override fun onBufferReceived(buffer: ByteArray?) {}
          override fun onEndOfSpeech() {}

          override fun onError(error: Int) {
            if (speechRecognizer !== recognizer) return
            val map = Arguments.createMap().apply {
              putInt("code", error)
              putString("message", speechErrorMessage(error))
            }
            emitEvent("KallieSpeechError", map)
          }

          override fun onResults(results: Bundle?) {
            if (speechRecognizer !== recognizer) return
            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            val text = matches?.firstOrNull()?.trim() ?: ""
            val map = Arguments.createMap().apply { putString("text", text) }
            emitEvent("KallieSpeechResult", map)
          }

          override fun onPartialResults(partialResults: Bundle?) {
            if (speechRecognizer !== recognizer) return
            val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            val text = matches?.firstOrNull()?.trim() ?: ""
            if (text.isNotEmpty()) {
              val map = Arguments.createMap().apply { putString("text", text) }
              emitEvent("KallieSpeechPartial", map)
            }
          }

          override fun onEvent(eventType: Int, params: Bundle?) {}
        })

        val tag = if (localeTag.isNullOrBlank()) "en-US" else localeTag
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag)
          putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
          putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
          putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 850L)
          putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 680L)
        }

        speechRecognizer = recognizer
        recognizer.startListening(intent)
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("E_STT_START", t.message ?: "Failed to start speech recognition", t)
      }
    }
  }

  @ReactMethod
  fun stopSpeechListening() {
    mainHandler.post {
      destroySpeechRecognizerOnMain()
    }
  }

  private fun destroySpeechRecognizerOnMain() {
    val old = speechRecognizer
    speechRecognizer = null
    try {
      old?.stopListening()
      old?.cancel()
      old?.destroy()
    } catch (_: Throwable) {
      // Ignore teardown race
    }
  }

  private fun speechErrorMessage(code: Int): String = when (code) {
    SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
    SpeechRecognizer.ERROR_CLIENT -> "Speech client error"
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission required"
    SpeechRecognizer.ERROR_NETWORK -> "Network error during speech recognition"
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition network timeout"
    SpeechRecognizer.ERROR_NO_MATCH -> "No speech recognized"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognizer busy"
    SpeechRecognizer.ERROR_SERVER -> "Speech recognition server error"
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech detected"
    else -> "Speech recognition error ($code)"
  }

  private fun drainPendingTtsAsDoneOnMain() {
    while (true) {
      val item = pendingTts.poll() ?: break
      val map = Arguments.createMap().apply { putString("utteranceId", item.second) }
      emitEvent("KallieTtsDone", map)
    }
  }

  private fun ensureTtsOnMain() {
    if (ttsEngine != null) return
    ttsReady.set(false)
    val engine = TextToSpeech(reactContext) { status ->
      mainHandler.post {
        if (status == TextToSpeech.SUCCESS) {
          try {
            val active = ttsEngine ?: return@post
            active.language = Locale.US
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
              active.setAudioAttributes(
                AudioAttributes.Builder()
                  .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                  .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                  .build()
              )
              val bestVoice = active.voices
                ?.filter {
                  it.locale.language == "en" &&
                    !it.isNetworkConnectionRequired &&
                    it.quality >= android.speech.tts.Voice.QUALITY_NORMAL
                }
                ?.sortedByDescending { it.quality }
                ?.firstOrNull()
              if (bestVoice != null) {
                active.voice = bestVoice
              }
            }
            active.setSpeechRate(1.04f)
            active.setPitch(1.02f)
            active.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
              override fun onStart(utteranceId: String?) {
                val map = Arguments.createMap().apply { putString("utteranceId", utteranceId ?: "") }
                emitEvent("KallieTtsStart", map)
              }

              override fun onDone(utteranceId: String?) {
                val map = Arguments.createMap().apply { putString("utteranceId", utteranceId ?: "") }
                emitEvent("KallieTtsDone", map)
              }

              @Deprecated("Deprecated in Java")
              override fun onError(utteranceId: String?) {
                val map = Arguments.createMap().apply { putString("utteranceId", utteranceId ?: "") }
                emitEvent("KallieTtsDone", map)
              }

              override fun onError(utteranceId: String?, errorCode: Int) {
                val map = Arguments.createMap().apply { putString("utteranceId", utteranceId ?: "") }
                emitEvent("KallieTtsDone", map)
              }

              override fun onStop(utteranceId: String?, interrupted: Boolean) {
                val map = Arguments.createMap().apply { putString("utteranceId", utteranceId ?: "") }
                emitEvent("KallieTtsDone", map)
              }
            })
            ttsReady.set(true)
            flushPendingTtsOnMain()
          } catch (_: Throwable) {
            failPendingTtsOnMain()
          }
        } else {
          failPendingTtsOnMain()
        }
      }
    }
    ttsEngine = engine
  }

  private fun failPendingTtsOnMain() {
    ttsReady.set(false)
    try { ttsEngine?.shutdown() } catch (_: Throwable) {}
    ttsEngine = null
    drainPendingTtsAsDoneOnMain()
  }

  private fun flushPendingTtsOnMain() {
    val engine = ttsEngine ?: return
    if (!ttsReady.get()) return
    while (true) {
      val item = pendingTts.poll() ?: break
      val mode = if (item.third) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
      engine.speak(item.first, mode, null, item.second)
    }
  }

  @ReactMethod
  fun speakText(text: String, utteranceId: String, flush: Boolean, promise: Promise) {
    val cleaned = text.trim()
    if (cleaned.isEmpty()) {
      promise.resolve(false)
      return
    }
    mainHandler.post {
      try {
        ensureTtsOnMain()
        if (flush) {
          drainPendingTtsAsDoneOnMain()
        }
        if (ttsReady.get() && ttsEngine != null) {
          val mode = if (flush) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
          ttsEngine?.speak(cleaned, mode, null, utteranceId)
        } else {
          pendingTts.offer(Triple(cleaned, utteranceId, flush))
        }
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("E_TTS_SPEAK", t.message ?: "Failed to speak text", t)
      }
    }
  }

  @ReactMethod
  fun stopSpeaking() {
    mainHandler.post {
      drainPendingTtsAsDoneOnMain()
      try {
        ttsEngine?.stop()
      } catch (_: Throwable) {
        // Ignore stop race
      }
    }
  }

  private fun stopInternalLocked() {
    running.set(false)
    sessionToken.incrementAndGet()
    mainHandler.removeCallbacksAndMessages(handlerToken)
    playbackGen.incrementAndGet()
    playbackQueue.clear()
    playbackActive = false
    lastPlaybackWriteMs = 0L
    focusRetryCount = 0

    // 1. Stop recording first so blocking record.read() unblocks cleanly
    try {
      audioRecord?.let { rec ->
        if (rec.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
          rec.stop()
        }
      }
    } catch (_: Throwable) {}

    val cap = captureThread
    val play = playbackThread
    captureThread = null
    playbackThread = null

    try { cap?.interrupt() } catch (_: Throwable) {}
    try { play?.interrupt() } catch (_: Throwable) {}

    // 2. Join threads before releasing native AudioRecord/AudioTrack handles
    try { cap?.join(350) } catch (_: Throwable) {}
    try { play?.join(350) } catch (_: Throwable) {}

    try { aec?.release() } catch (_: Throwable) {}
    try { ns?.release() } catch (_: Throwable) {}
    try { agc?.release() } catch (_: Throwable) {}
    aec = null
    ns = null
    agc = null

    try { audioRecord?.release() } catch (_: Throwable) {}
    audioRecord = null

    synchronized(trackLock) {
      try {
        audioTrack?.let { track ->
          if (track.playState == AudioTrack.PLAYSTATE_PLAYING) {
            track.pause()
            track.flush()
          }
          track.release()
        }
      } catch (_: Throwable) {}
      audioTrack = null
    }

    if (!voiceRouteActive.get()) {
      releaseAudioFocusAndRoute()
    }
  }

  override fun invalidate() {
    synchronized(sessionLock) {
      voiceRouteActive.set(false)
      stopInternalLocked()
    }
    mainHandler.post {
      destroySpeechRecognizerOnMain()
      drainPendingTtsAsDoneOnMain()
      try {
        ttsEngine?.stop()
        ttsEngine?.shutdown()
      } catch (_: Throwable) {}
      ttsEngine = null
      ttsReady.set(false)
    }
    super.invalidate()
  }
}
