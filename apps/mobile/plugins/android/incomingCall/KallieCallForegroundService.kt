package com.kallie.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.util.concurrent.CopyOnWriteArrayList

class KallieCallForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null
  private var instanceSessionId: String? = null

  companion object {
    const val CHANNEL_ONGOING_CALLS = "kallie_ongoing_calls_v2"
    const val LEGACY_CHANNEL_ONGOING_CALLS = "kallie_ongoing_calls"
    const val ONGOING_NOTIFICATION_ID = 44001
    const val ACTION_START = "com.kallie.app.action.START_ONGOING_CALL"
    const val ACTION_STOP = "com.kallie.app.action.STOP_ONGOING_CALL"

    @Volatile
    var activeSessionId: String? = null
      private set

    @Volatile
    var isForegroundRunning: Boolean = false
      private set

    private val readyListeners = CopyOnWriteArrayList<(Boolean) -> Unit>()

    private fun notifyReadyListeners(started: Boolean) {
      val snapshot = ArrayList(readyListeners)
      readyListeners.clear()
      for (cb in snapshot) {
        try { cb(started) } catch (_: Throwable) {}
      }
    }

    fun hasMicrophonePermission(context: Context): Boolean {
      return ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.RECORD_AUDIO
      ) == PackageManager.PERMISSION_GRANTED
    }

    fun start(
      context: Context,
      sessionId: String,
      title: String,
      onReady: ((Boolean) -> Unit)? = null
    ): Boolean {
      // CRITICAL (Android 12-16): NEVER invoke startForegroundService() unless RECORD_AUDIO
      // is already granted; otherwise onStartCommand cannot enter microphone FGS and Android
      // throws fatal RemoteServiceException$ForegroundServiceDidNotStartInTimeException.
      if (!hasMicrophonePermission(context)) {
        onReady?.invoke(false)
        return false
      }
      if (isForegroundRunning && activeSessionId == sessionId && sessionId.isNotBlank()) {
        onReady?.invoke(true)
        return true
      }
      if (onReady != null) {
        readyListeners.add(onReady)
      }
      val intent = Intent(context, KallieCallForegroundService::class.java).apply {
        action = ACTION_START
        putExtra(KallieIncomingCallModule.EXTRA_SESSION_ID, sessionId)
        putExtra(KallieIncomingCallModule.EXTRA_TITLE, title)
      }
      return try {
        ContextCompat.startForegroundService(context, intent)
        true
      } catch (_: Throwable) {
        if (onReady != null) {
          readyListeners.remove(onReady)
          onReady(false)
        }
        false
      }
    }

    fun stop(context: Context) {
      activeSessionId = null
      isForegroundRunning = false
      notifyReadyListeners(false)
      try {
        context.stopService(Intent(context, KallieCallForegroundService::class.java))
      } catch (_: Throwable) {
        // Ignore if service was not running
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }

    val sessionId = intent?.getStringExtra(KallieIncomingCallModule.EXTRA_SESSION_ID) ?: ""
    val title = intent?.getStringExtra(KallieIncomingCallModule.EXTRA_TITLE) ?: "Kallie"

    ensureOngoingChannel()
    val notification = buildOngoingNotification(sessionId, title)

    val hasMicPerm = hasMicrophonePermission(this)
    if (!hasMicPerm) {
      // Permission was revoked mid-flight between start() and onStartCommand().
      // On Android 8+, a service launched via startForegroundService() must still
      // call startForeground() before stopSelf() or the OS kills the process.
      try {
        startForeground(ONGOING_NOTIFICATION_ID, notification)
      } catch (_: Throwable) {
        // Ignore if OS rejects FGS promotion without mic permission
      }
      activeSessionId = null
      isForegroundRunning = false
      notifyReadyListeners(false)
      stopSelf()
      return START_NOT_STICKY
    }

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        ServiceCompat.startForeground(
          this,
          ONGOING_NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        )
      } else {
        startForeground(ONGOING_NOTIFICATION_ID, notification)
      }
    } catch (_: Throwable) {
      activeSessionId = null
      isForegroundRunning = false
      notifyReadyListeners(false)
      stopSelf()
      return START_NOT_STICKY
    }

    val resolvedSessionId = sessionId.ifBlank { activeSessionId }
    instanceSessionId = resolvedSessionId
    activeSessionId = resolvedSessionId
    isForegroundRunning = true
    acquirePartialWakeLock()
    acquireLowLatencyWifiLock()
    notifyReadyListeners(true)

    return START_NOT_STICKY
  }

  override fun onDestroy() {
    if (activeSessionId == null || activeSessionId == instanceSessionId) {
      activeSessionId = null
      isForegroundRunning = false
      notifyReadyListeners(false)
    }
    releaseLowLatencyWifiLock()
    releasePartialWakeLock()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    super.onDestroy()
  }

  private fun ensureOngoingChannel() {
    KallieIncomingCallModule.ensureChannels(this)
  }

  private fun buildOngoingNotification(sessionId: String, title: String): Notification {
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    val openAuraIntent = Intent(this, MainActivity::class.java).apply {
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_CLEAR_TOP
      )
      putExtra(KallieIncomingCallModule.EXTRA_ACTION, "open_active")
      putExtra(KallieIncomingCallModule.EXTRA_SESSION_ID, sessionId)
      putExtra(KallieIncomingCallModule.EXTRA_TITLE, title)
    }
    val openAuraPendingIntent = PendingIntent.getActivity(
      this,
      ONGOING_NOTIFICATION_ID,
      openAuraIntent,
      flags
    )

    val hangUpIntent = Intent(this, KallieCallActionReceiver::class.java).apply {
      putExtra(KallieIncomingCallModule.EXTRA_ACTION, "hangup")
      putExtra(KallieIncomingCallModule.EXTRA_SESSION_ID, sessionId)
    }
    val hangUpPendingIntent = PendingIntent.getBroadcast(
      this,
      ONGOING_NOTIFICATION_ID + 1,
      hangUpIntent,
      flags
    )

    val caller = Person.Builder()
      .setName("Kallie")
      .setImportant(true)
      .build()

    return NotificationCompat.Builder(this, CHANNEL_ONGOING_CALLS)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("Kallie")
      .setContentText("Ongoing call")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setColor(Color.parseColor("#10B981"))
      .setColorized(true)
      .setOngoing(true)
      .setSilent(true)
      .setUsesChronometer(true)
      .setWhen(System.currentTimeMillis())
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(openAuraPendingIntent)
      .setStyle(NotificationCompat.CallStyle.forOngoingCall(caller, hangUpPendingIntent))
      .build()
  }

  private fun acquirePartialWakeLock() {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
    val lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kallie:active_call").apply {
      setReferenceCounted(false)
    }
    try {
      lock.acquire(2 * 60 * 60 * 1000L)
      wakeLock = lock
    } catch (_: Throwable) {
      // Ignore wake lock failures
    }
  }

  private fun releasePartialWakeLock() {
    val lock = wakeLock ?: return
    try {
      if (lock.isHeld) {
        lock.release()
      }
    } catch (_: Throwable) {
      // Ignore
    }
    wakeLock = null
  }

  private fun acquireLowLatencyWifiLock() {
    if (wifiLock?.isHeld == true) return
    val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      WifiManager.WIFI_MODE_FULL_LOW_LATENCY
    } else {
      @Suppress("DEPRECATION")
      WifiManager.WIFI_MODE_FULL_HIGH_PERF
    }
    try {
      val lock = wm.createWifiLock(mode, "kallie:active_call_wifi").apply {
        setReferenceCounted(false)
      }
      lock.acquire()
      wifiLock = lock
    } catch (_: Throwable) {
      // Ignore OEM wifi lock restrictions
    }
  }

  private fun releaseLowLatencyWifiLock() {
    val lock = wifiLock ?: return
    try {
      if (lock.isHeld) {
        lock.release()
      }
    } catch (_: Throwable) {
      // Ignore
    }
    wifiLock = null
  }
}
