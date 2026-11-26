const fs = require('node:fs');
const path = require('node:path');
const {
  withAndroidManifest,
  withDangerousMod,
  withMainActivity,
  withMainApplication,
} = require('@expo/config-plugins');

const PACKAGE_NAME = 'com.kallie.app';
const PACKAGE_DIR = path.join('app', 'src', 'main', 'java', 'com', 'kallie', 'app');

const RECEIVER_KT = `package ${PACKAGE_NAME}

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class KallieCallActionReceiver : BroadcastReceiver() {
  companion object {
    private val networkExecutor = Executors.newSingleThreadExecutor()
  }

  override fun onReceive(context: Context, intent: Intent) {
    val sessionId = intent.getStringExtra(KallieIncomingCallModule.EXTRA_SESSION_ID) ?: return
    val action = intent.getStringExtra(KallieIncomingCallModule.EXTRA_ACTION) ?: "decline"
    val title = intent.getStringExtra(KallieIncomingCallModule.EXTRA_TITLE) ?: "Kallie"

    when (action) {
      "decline" -> handleDecline(context, intent, sessionId)
      "answer_background" -> handleBackgroundAnswer(context, sessionId, title)
      "hangup" -> handleHangUp(context, sessionId)
      else -> {
        NotificationManagerCompat.from(context)
          .cancel(KallieIncomingCallModule.notificationIdFor(sessionId))
        KallieIncomingCallModule.emitOrQueueIntent(action, sessionId, title)
      }
    }
  }

  private fun handleDecline(context: Context, intent: Intent, sessionId: String) {
    // 1. Immediately stop ringing and dismiss notification without opening any UI
    NotificationManagerCompat.from(context)
      .cancel(KallieIncomingCallModule.notificationIdFor(sessionId))
    KallieIncomingCallModule.clearPendingIfMatches(sessionId)

    // 2. Notify active JS runtime if mounted so in-app modal/state stays synchronized
    KallieIncomingCallModule.emitIfReactActive("decline", sessionId, "")

    // 3. Synchronize decline directly with backend via goAsync() so status becomes "declined"
    //    even when the app is backgrounded or process was closed.
    val prefs = context.getSharedPreferences(
      KallieIncomingCallModule.PREFS_NAME,
      Context.MODE_PRIVATE
    )
    val declineUrl = intent.getStringExtra(KallieIncomingCallModule.EXTRA_DECLINE_URL)
      ?: prefs.getString("decline_url_$sessionId", null)
    val declineToken = intent.getStringExtra(KallieIncomingCallModule.EXTRA_DECLINE_TOKEN)
      ?: prefs.getString("decline_token_$sessionId", null)

    prefs.edit()
      .remove("decline_url_$sessionId")
      .remove("decline_token_$sessionId")
      .apply()

    if (declineUrl.isNullOrBlank() || declineToken.isNullOrBlank()) {
      return
    }

    val pendingResult = goAsync()
    networkExecutor.execute {
      var connection: HttpURLConnection? = null
      try {
        val url = URL(declineUrl)
        connection = (url.openConnection() as HttpURLConnection).apply {
          requestMethod = "POST"
          connectTimeout = 8_000
          readTimeout = 8_000
          doOutput = true
          setRequestProperty("Content-Type", "application/json")
        }
        val payload = JSONObject().apply {
          put("declineToken", declineToken)
        }.toString()
        OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
          writer.write(payload)
          writer.flush()
        }
        connection.responseCode
      } catch (_: Throwable) {
        // Best-effort network sync; server 35s timeout remains as safety net
      } finally {
        connection?.disconnect()
        pendingResult.finish()
      }
    }
  }

  private fun handleBackgroundAnswer(context: Context, sessionId: String, title: String) {
    NotificationManagerCompat.from(context)
      .cancel(KallieIncomingCallModule.notificationIdFor(sessionId))
    KallieIncomingCallModule.clearPendingIfMatches(sessionId)

    val hasMicPermission = ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.RECORD_AUDIO
    ) == PackageManager.PERMISSION_GRANTED

    // True background answer (without opening UI) requires an active React runtime
    // plus RECORD_AUDIO permission so the microphone Foreground Service and LiveKit
    // can connect immediately. If the app was cold-killed or mic is not yet granted,
    // fall back cleanly to launching MainActivity straight into the active Aura call.
    if (hasMicPermission && KallieIncomingCallModule.hasActiveReactInstance()) {
      KallieCallForegroundService.start(context, sessionId, title)
      KallieIncomingCallModule.emitOrQueueIntent("answer_background", sessionId, title)
      return
    }

    val launchIntent = Intent(context, MainActivity::class.java).apply {
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_CLEAR_TOP
      )
      putExtra(KallieIncomingCallModule.EXTRA_ACTION, "answer")
      putExtra(KallieIncomingCallModule.EXTRA_SESSION_ID, sessionId)
      putExtra(KallieIncomingCallModule.EXTRA_TITLE, title)
    }
    try {
      context.startActivity(launchIntent)
    } catch (_: Throwable) {
      KallieIncomingCallModule.emitOrQueueIntent("answer", sessionId, title)
    }
  }

  private fun handleHangUp(context: Context, sessionId: String) {
    KallieCallForegroundService.stop(context)
    NotificationManagerCompat.from(context)
      .cancel(KallieIncomingCallModule.notificationIdFor(sessionId))
    KallieIncomingCallModule.clearPendingIfMatches(sessionId)
    KallieIncomingCallModule.emitOrQueueIntent("hangup", sessionId, "")
  }
}
`;

const FOREGROUND_SERVICE_KT = `package ${PACKAGE_NAME}

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
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

class KallieCallForegroundService : Service() {
  private var audioManager: AudioManager? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private var audioDeviceCallback: AudioDeviceCallback? = null
  private var wakeLock: PowerManager.WakeLock? = null

  companion object {
    const val CHANNEL_ONGOING_CALLS = "kallie_ongoing_calls"
    const val ONGOING_NOTIFICATION_ID = 44001
    const val ACTION_START = "com.kallie.app.action.START_ONGOING_CALL"
    const val ACTION_STOP = "com.kallie.app.action.STOP_ONGOING_CALL"

    @Volatile
    var activeSessionId: String? = null
      private set

    fun start(context: Context, sessionId: String, title: String) {
      val intent = Intent(context, KallieCallForegroundService::class.java).apply {
        action = ACTION_START
        putExtra(KallieIncomingCallModule.EXTRA_SESSION_ID, sessionId)
        putExtra(KallieIncomingCallModule.EXTRA_TITLE, title)
      }
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (_: Throwable) {
        // Ignore if Android restricts FGS start in an unexpected state
      }
    }

    fun stop(context: Context) {
      activeSessionId = null
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

    val hasMicPerm = ContextCompat.checkSelfPermission(
      this,
      Manifest.permission.RECORD_AUDIO
    ) == PackageManager.PERMISSION_GRANTED

    if (!hasMicPerm) {
      stopSelf()
      return START_NOT_STICKY
    }

    ensureOngoingChannel()
    val notification = buildOngoingNotification(sessionId, title)

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        ServiceCompat.startForeground(
          this,
          ONGOING_NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        )
      } else {
        startForeground(ONGOING_NOTIFICATION_ID, notification)
      }
    } catch (_: Throwable) {
      activeSessionId = null
      stopSelf()
      return START_NOT_STICKY
    }

    activeSessionId = sessionId.ifBlank { activeSessionId }
    acquireAudioFocusAndRouting()
    acquirePartialWakeLock()

    return START_NOT_STICKY
  }

  override fun onDestroy() {
    activeSessionId = null
    releaseAudioFocusAndRouting()
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
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ONGOING_CALLS) == null) {
      val channel = NotificationChannel(
        CHANNEL_ONGOING_CALLS,
        "Active Kallie Calls",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Ongoing voice call status and hang up control"
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        setShowBadge(false)
        setSound(null, null)
        enableVibration(false)
      }
      manager.createNotificationChannel(channel)
    }
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
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setSilent(true)
      .setUsesChronometer(true)
      .setWhen(System.currentTimeMillis())
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(openAuraPendingIntent)
      .setStyle(NotificationCompat.CallStyle.forOngoingCall(caller, hangUpPendingIntent))
      .build()
  }

  private fun acquireAudioFocusAndRouting() {
    val am = (getSystemService(Context.AUDIO_SERVICE) as? AudioManager) ?: return
    audioManager = am

    try {
      am.mode = AudioManager.MODE_IN_COMMUNICATION
    } catch (_: Throwable) {
      // Ignore if OEM blocks mode change
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest == null) {
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
        .setAudioAttributes(attrs)
        .setAcceptsDelayedFocusGain(false)
        .setOnAudioFocusChangeListener { }
        .build()
      audioFocusRequest = request
      try {
        am.requestAudioFocus(request)
      } catch (_: Throwable) {
        // Ignore audio focus denial
      }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && audioDeviceCallback == null) {
      val callback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
          syncCommunicationRoute(am)
        }

        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
          syncCommunicationRoute(am)
        }
      }
      audioDeviceCallback = callback
      try {
        am.registerAudioDeviceCallback(callback, null)
        syncCommunicationRoute(am)
      } catch (_: Throwable) {
        // Ignore
      }
    }
  }

  private fun syncCommunicationRoute(am: AudioManager) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      try {
        val devices = am.availableCommunicationDevices
        val preferred = devices.firstOrNull {
          it.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
            it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
            it.type == AudioDeviceInfo.TYPE_USB_HEADSET
        } ?: devices.firstOrNull {
          it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
        }
        if (preferred != null) {
          am.setCommunicationDevice(preferred)
        }
      } catch (_: Throwable) {
        // Fallback to LiveKit AudioSession routing
      }
    }
  }

  private fun releaseAudioFocusAndRouting() {
    val am = audioManager ?: return
    audioDeviceCallback?.let { cb ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        try {
          am.unregisterAudioDeviceCallback(cb)
        } catch (_: Throwable) {
          // Ignore
        }
      }
    }
    audioDeviceCallback = null

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      try {
        am.clearCommunicationDevice()
      } catch (_: Throwable) {
        // Ignore
      }
    }

    audioFocusRequest?.let { req ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        try {
          am.abandonAudioFocusRequest(req)
        } catch (_: Throwable) {
          // Ignore
        }
      }
    }
    audioFocusRequest = null

    try {
      am.mode = AudioManager.MODE_NORMAL
    } catch (_: Throwable) {
      // Ignore
    }
    audioManager = null
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
}
`;

const MODULE_KT = `package ${PACKAGE_NAME}

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference

class KallieIncomingCallModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  init {
    activeContextRef = WeakReference(reactContext)
  }

  override fun getName(): String = "KallieIncomingCall"

  companion object {
    const val PREFS_NAME = "kallie_call_prefs"
    const val CHANNEL_INCOMING_CALLS = "kallie_incoming_calls"
    const val CHANNEL_REMINDERS = "kallie_reminders"
    const val EXTRA_ACTION = "kallie_action"
    const val EXTRA_SESSION_ID = "kallie_session_id"
    const val EXTRA_TITLE = "kallie_title"
    const val EXTRA_DECLINE_URL = "kallie_decline_url"
    const val EXTRA_DECLINE_TOKEN = "kallie_decline_token"
    const val EVENT_INCOMING_INTENT = "kallieIncomingCallIntent"

    @Volatile
    private var activeContextRef: WeakReference<ReactApplicationContext>? = null

    @Volatile
    private var pendingAction: String? = null
    @Volatile
    private var pendingSessionId: String? = null
    @Volatile
    private var pendingTitle: String? = null

    fun notificationIdFor(key: String): Int {
      val hash = key.hashCode()
      return if (hash == Int.MIN_VALUE) 1001 else kotlin.math.abs(hash)
    }

    fun hasActiveReactInstance(): Boolean {
      val ctx = activeContextRef?.get()
      return ctx != null && ctx.hasActiveReactInstance()
    }

    fun clearPendingIfMatches(sessionId: String) {
      if (sessionId.isBlank() || pendingSessionId == sessionId) {
        pendingSessionId = null
        pendingAction = null
        pendingTitle = null
      }
    }

    fun handleIntent(context: Context, intent: Intent?) {
      if (intent == null) return
      val sessionId = intent.getStringExtra(EXTRA_SESSION_ID) ?: return
      val action = intent.getStringExtra(EXTRA_ACTION) ?: "show"
      val title = intent.getStringExtra(EXTRA_TITLE) ?: "Kallie"
      intent.removeExtra(EXTRA_SESSION_ID)
      intent.removeExtra(EXTRA_ACTION)
      intent.removeExtra(EXTRA_TITLE)

      if (action == "answer" || action == "decline" || action == "hangup") {
        NotificationManagerCompat.from(context).cancel(notificationIdFor(sessionId))
      }

      emitOrQueueIntent(action, sessionId, title)
    }

    fun emitIfReactActive(action: String, sessionId: String, title: String) {
      val ctx = activeContextRef?.get() ?: return
      if (!ctx.hasActiveReactInstance()) return
      try {
        val map = Arguments.createMap().apply {
          putString("action", action)
          putString("sessionId", sessionId)
          putString("title", title)
        }
        ctx
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(EVENT_INCOMING_INTENT, map)
      } catch (_: Throwable) {
        // Safe no-op
      }
    }

    fun emitOrQueueIntent(action: String, sessionId: String, title: String) {
      // Always record pending intent so cold-start or headless-booted JS UI picks it up
      // when mounted; JS deduplicates by sessionId if the event was already delivered.
      pendingAction = action
      pendingSessionId = sessionId
      pendingTitle = title

      emitIfReactActive(action, sessionId, title)
    }
  }

  private fun createChannelsInternal() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    if (manager.getNotificationChannel(CHANNEL_REMINDERS) == null) {
      val reminderChannel = NotificationChannel(
        CHANNEL_REMINDERS,
        "Scheduled Call Reminders",
        NotificationManager.IMPORTANCE_HIGH
      ).apply {
        description = "Pre-call reminder notifications from Kallie"
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        enableVibration(true)
      }
      manager.createNotificationChannel(reminderChannel)
    }

    if (manager.getNotificationChannel(CHANNEL_INCOMING_CALLS) == null) {
      val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      val audioAttrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

      val callChannel = NotificationChannel(
        CHANNEL_INCOMING_CALLS,
        "Incoming Kallie Calls",
        NotificationManager.IMPORTANCE_HIGH
      ).apply {
        description = "Full-screen incoming voice calls from Kallie"
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        setSound(ringtoneUri, audioAttrs)
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 600, 900, 600, 900)
        setBypassDnd(true)
      }
      manager.createNotificationChannel(callChannel)
    }

    if (manager.getNotificationChannel(KallieCallForegroundService.CHANNEL_ONGOING_CALLS) == null) {
      val ongoingChannel = NotificationChannel(
        KallieCallForegroundService.CHANNEL_ONGOING_CALLS,
        "Active Kallie Calls",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Ongoing voice call status and hang up control"
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        setShowBadge(false)
        setSound(null, null)
        enableVibration(false)
      }
      manager.createNotificationChannel(ongoingChannel)
    }
  }

  @ReactMethod
  fun ensureChannels() {
    createChannelsInternal()
  }

  @ReactMethod
  fun showIncomingCall(
    sessionId: String,
    title: String,
    declineUrl: String?,
    declineToken: String?
  ) {
    createChannelsInternal()

    val notifId = notificationIdFor(sessionId)
    val safeTitle = if (title.isBlank()) "Kallie" else title
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    // Persist decline endpoint & HMAC token so background Decline works even after JS exits
    if (!declineUrl.isNullOrBlank() && !declineToken.isNullOrBlank()) {
      reactContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString("decline_url_$sessionId", declineUrl)
        .putString("decline_token_$sessionId", declineToken)
        .apply()
    }

    val fullScreenIntent = Intent(reactContext, MainActivity::class.java).apply {
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_CLEAR_TOP
      )
      putExtra(EXTRA_ACTION, "show")
      putExtra(EXTRA_SESSION_ID, sessionId)
      putExtra(EXTRA_TITLE, safeTitle)
    }
    val fullScreenPendingIntent = PendingIntent.getActivity(
      reactContext,
      notifId,
      fullScreenIntent,
      flags
    )

    val answerIntent = Intent(reactContext, MainActivity::class.java).apply {
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_CLEAR_TOP
      )
      putExtra(EXTRA_ACTION, "answer")
      putExtra(EXTRA_SESSION_ID, sessionId)
      putExtra(EXTRA_TITLE, safeTitle)
    }
    val answerPendingIntent = PendingIntent.getActivity(
      reactContext,
      notifId + 1,
      answerIntent,
      flags
    )

    val declineIntent = Intent(reactContext, KallieCallActionReceiver::class.java).apply {
      putExtra(EXTRA_ACTION, "decline")
      putExtra(EXTRA_SESSION_ID, sessionId)
      if (!declineUrl.isNullOrBlank()) putExtra(EXTRA_DECLINE_URL, declineUrl)
      if (!declineToken.isNullOrBlank()) putExtra(EXTRA_DECLINE_TOKEN, declineToken)
    }
    val declinePendingIntent = PendingIntent.getBroadcast(
      reactContext,
      notifId + 2,
      declineIntent,
      flags
    )

    val bgAnswerIntent = Intent(reactContext, KallieCallActionReceiver::class.java).apply {
      putExtra(EXTRA_ACTION, "answer_background")
      putExtra(EXTRA_SESSION_ID, sessionId)
      putExtra(EXTRA_TITLE, safeTitle)
    }
    val bgAnswerPendingIntent = PendingIntent.getBroadcast(
      reactContext,
      notifId + 3,
      bgAnswerIntent,
      flags
    )

    val caller = Person.Builder()
      .setName("Kallie")
      .setImportant(true)
      .build()

    val callStyle = NotificationCompat.CallStyle.forIncomingCall(
      caller,
      declinePendingIntent,
      answerPendingIntent
    )
      .setAnswerButtonColorHint(Color.parseColor("#10B981"))
      .setDeclineButtonColorHint(Color.parseColor("#DC2626"))

    val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
    val builder = NotificationCompat.Builder(reactContext, CHANNEL_INCOMING_CALLS)
      .setSmallIcon(reactContext.applicationInfo.icon)
      .setContentTitle("Kallie")
      .setContentText("Incoming call")
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(true)
      .setTimeoutAfter(35_000L)
      .setSound(ringtoneUri)
      .setVibrate(longArrayOf(0, 600, 900, 600, 900))
      .setContentIntent(fullScreenPendingIntent)
      .setFullScreenIntent(fullScreenPendingIntent, true)
      .setStyle(callStyle)
      .addAction(0, "Answer in background", bgAnswerPendingIntent)

    val notification = builder.build()
    notification.flags = notification.flags or Notification.FLAG_INSISTENT

    try {
      NotificationManagerCompat.from(reactContext).notify(notifId, notification)
    } catch (_: SecurityException) {
      // Missing POST_NOTIFICATIONS runtime permission on Android 13+
    }
  }

  @ReactMethod
  fun dismissIncomingCall(sessionId: String) {
    val manager = NotificationManagerCompat.from(reactContext)
    val prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    if (sessionId.isBlank()) {
      manager.cancelAll()
      clearPendingIfMatches("")
    } else {
      manager.cancel(notificationIdFor(sessionId))
      clearPendingIfMatches(sessionId)
      prefs.edit()
        .remove("decline_url_$sessionId")
        .remove("decline_token_$sessionId")
        .apply()
    }
  }

  @ReactMethod
  fun startCallForegroundService(sessionId: String, title: String) {
    createChannelsInternal()
    if (sessionId.isNotBlank()) {
      NotificationManagerCompat.from(reactContext).cancel(notificationIdFor(sessionId))
    }
    KallieCallForegroundService.start(
      reactContext,
      sessionId,
      if (title.isBlank()) "Kallie" else title
    )
  }

  @ReactMethod
  fun stopCallForegroundService() {
    KallieCallForegroundService.stop(reactContext)
  }

  @ReactMethod
  fun getActiveCallSessionId(promise: Promise) {
    promise.resolve(KallieCallForegroundService.activeSessionId)
  }

  @ReactMethod
  fun showReminderNotification(scheduleId: String, title: String, body: String) {
    createChannelsInternal()
    val notifId = notificationIdFor("reminder_$scheduleId")
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    val openIntent = Intent(reactContext, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val pendingOpen = PendingIntent.getActivity(reactContext, notifId, openIntent, flags)

    val notification = NotificationCompat.Builder(reactContext, CHANNEL_REMINDERS)
      .setSmallIcon(reactContext.applicationInfo.icon)
      .setContentTitle(if (title.isBlank()) "Kallie" else title)
      .setContentText(body)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setAutoCancel(true)
      .setContentIntent(pendingOpen)
      .build()

    try {
      NotificationManagerCompat.from(reactContext).notify(notifId, notification)
    } catch (_: SecurityException) {
      // Missing POST_NOTIFICATIONS runtime permission on Android 13+
    }
  }

  @ReactMethod
  fun consumePendingCallIntent(promise: Promise) {
    val sessionId = pendingSessionId
    val action = pendingAction
    val title = pendingTitle
    pendingSessionId = null
    pendingAction = null
    pendingTitle = null

    if (sessionId == null) {
      promise.resolve(null)
      return
    }
    val map = Arguments.createMap().apply {
      putString("action", action ?: "show")
      putString("sessionId", sessionId)
      putString("title", title ?: "Kallie")
    }
    promise.resolve(map)
  }

  @ReactMethod
  fun canUseFullScreenIntent(promise: Promise) {
    if (Build.VERSION.SDK_INT >= 34) {
      val manager = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      promise.resolve(manager.canUseFullScreenIntent())
    } else {
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun openFullScreenIntentSettings(promise: Promise) {
    try {
      val intent = if (Build.VERSION.SDK_INT >= 34) {
        Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
          data = Uri.parse("package:\${reactContext.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      } else {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
          putExtra(Settings.EXTRA_APP_PACKAGE, reactContext.packageName)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      }
      reactContext.startActivity(intent)
      promise.resolve(true)
    } catch (_: Throwable) {
      promise.resolve(false)
    }
  }
}
`;

const PACKAGE_KT = `package ${PACKAGE_NAME}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class KallieIncomingCallPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(KallieIncomingCallModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;

function withIncomingCallAndroid(config) {
  // 1. Update AndroidManifest.xml: lock-screen flags, permissions, receiver, and microphone FGS
  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;

    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }

    const perms = [
      'android.permission.USE_FULL_SCREEN_INTENT',
      'android.permission.VIBRATE',
      'android.permission.WAKE_LOCK',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.BLUETOOTH_CONNECT',
    ];

    for (const perm of perms) {
      const exists = manifest['uses-permission'].some(
        (item) => item.$?.['android:name'] === perm,
      );
      if (!exists) {
        manifest['uses-permission'].push({ $: { 'android:name': perm } });
      }
    }

    const application = manifest.application?.[0];
    if (!application) return modConfig;

    const mainActivity = application.activity?.find(
      (act) =>
        act.$?.['android:name'] === '.MainActivity' ||
        act.$?.['android:name'] === `${PACKAGE_NAME}.MainActivity`,
    );
    if (mainActivity && mainActivity.$) {
      mainActivity.$['android:showWhenLocked'] = 'true';
      mainActivity.$['android:turnScreenOn'] = 'true';
      mainActivity.$['android:launchMode'] = 'singleTask';
    }

    if (!application.receiver) {
      application.receiver = [];
    }
    const receiverName = '.KallieCallActionReceiver';
    const hasReceiver = application.receiver.some(
      (r) => r.$?.['android:name'] === receiverName,
    );
    if (!hasReceiver) {
      application.receiver.push({
        $: {
          'android:name': receiverName,
          'android:exported': 'false',
        },
      });
    }

    if (!application.service) {
      application.service = [];
    }
    const serviceName = '.KallieCallForegroundService';
    const hasService = application.service.some(
      (s) => s.$?.['android:name'] === serviceName,
    );
    if (!hasService) {
      application.service.push({
        $: {
          'android:name': serviceName,
          'android:exported': 'false',
          'android:foregroundServiceType': 'microphone',
          'android:stopWithTask': 'false',
        },
      });
    }

    return modConfig;
  });

  // 2. Write Kotlin native module, package, BroadcastReceiver, and Foreground Service
  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const dir = path.join(modConfig.modRequest.platformProjectRoot, PACKAGE_DIR);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'KallieCallActionReceiver.kt'), RECEIVER_KT, 'utf8');
      fs.writeFileSync(
        path.join(dir, 'KallieCallForegroundService.kt'),
        FOREGROUND_SERVICE_KT,
        'utf8',
      );
      fs.writeFileSync(path.join(dir, 'KallieIncomingCallModule.kt'), MODULE_KT, 'utf8');
      fs.writeFileSync(path.join(dir, 'KallieIncomingCallPackage.kt'), PACKAGE_KT, 'utf8');
      return modConfig;
    },
  ]);

  // 3. Patch MainActivity.kt to allow lock-screen display & forward incoming call intents
  config = withMainActivity(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    const imports = ['import android.content.Intent', 'import android.os.Build'];
    for (const imp of imports) {
      if (!contents.includes(imp)) {
        contents = contents.replace(/^(package [^\r\n]+\r?\n)/, `$1${imp}\n`);
      }
    }

    if (!contents.includes('KallieIncomingCallModule.handleIntent')) {
      const hookSnippet = `
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    }
    KallieIncomingCallModule.handleIntent(this, intent)`;

      if (contents.includes('super.onCreate(null)')) {
        contents = contents.replace(
          'super.onCreate(null)',
          `super.onCreate(null)${hookSnippet}`,
        );
      } else if (contents.includes('super.onCreate(savedInstanceState)')) {
        contents = contents.replace(
          'super.onCreate(savedInstanceState)',
          `super.onCreate(savedInstanceState)${hookSnippet}`,
        );
      }

      if (!contents.includes('override fun onNewIntent(')) {
        const onNewIntentMethod = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    KallieIncomingCallModule.handleIntent(this, intent)
  }
`;
        const lastBrace = contents.lastIndexOf('}');
        if (lastBrace !== -1) {
          contents =
            contents.slice(0, lastBrace) + onNewIntentMethod + contents.slice(lastBrace);
        }
      }
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });

  // 4. Register KallieIncomingCallPackage in MainApplication.kt
  config = withMainApplication(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    if (!contents.includes('KallieIncomingCallPackage()')) {
      contents = contents.replace(
        /PackageList\(this\)\.packages\.apply\s*\{/,
        'PackageList(this).packages.apply {\n              add(KallieIncomingCallPackage())',
      );
    }
    modConfig.modResults.contents = contents;
    return modConfig;
  });

  return config;
}

module.exports = withIncomingCallAndroid;
