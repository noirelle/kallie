package com.kallie.app

import android.app.Activity
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
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.WindowManager
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
    const val EXTRA_AI_PROMPT = "kallie_ai_prompt"
    const val EXTRA_DELAY_SECONDS = "kallie_delay_seconds"
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
    @Volatile
    private var pendingAiPrompt: String? = null

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
        pendingAiPrompt = null
      }
    }

    fun ensureChannels(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

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

      if (manager.getNotificationChannel(KallieCallForegroundService.LEGACY_CHANNEL_ONGOING_CALLS) != null) {
        manager.deleteNotificationChannel(KallieCallForegroundService.LEGACY_CHANNEL_ONGOING_CALLS)
      }

      if (manager.getNotificationChannel(KallieCallForegroundService.CHANNEL_ONGOING_CALLS) == null) {
        val ongoingChannel = NotificationChannel(
          KallieCallForegroundService.CHANNEL_ONGOING_CALLS,
          "Active Kallie Calls",
          NotificationManager.IMPORTANCE_DEFAULT
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

    private fun wakeDeviceBriefly(context: Context) {
      // Hold CPU wake lock only so the lock screen does NOT flash before MainActivity's
      // fullScreenIntent window is drawn. MainActivity's turnScreenOn + showWhenLocked
      // smoothly illuminates the display directly onto the incoming call screen.
      val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
      if (pm.isInteractive) return
      try {
        val partial = pm.newWakeLock(
          PowerManager.PARTIAL_WAKE_LOCK,
          "kallie:incoming_call_wake_cpu"
        )
        partial.acquire(4_000L)
      } catch (_: Throwable) {
        // Safe fallback if wake lock denied
      }
    }

    fun showIncomingCallNotification(
      context: Context,
      sessionId: String,
      title: String,
      aiPrompt: String? = null,
      declineUrl: String? = null,
      declineToken: String? = null
    ) {
      ensureChannels(context)

      val appCtx = context.applicationContext
      val notifId = notificationIdFor(sessionId)
      val safeTitle = if (title.isBlank()) "Kallie" else title
      val safePrompt = aiPrompt?.trim().orEmpty()
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

      if (!declineUrl.isNullOrBlank() && !declineToken.isNullOrBlank()) {
        appCtx
          .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
          .edit()
          .putString("decline_url_$sessionId", declineUrl)
          .putString("decline_token_$sessionId", declineToken)
          .apply()
      }

      val fullScreenIntent = Intent(appCtx, MainActivity::class.java).apply {
        addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_SINGLE_TOP or
            Intent.FLAG_ACTIVITY_CLEAR_TOP
        )
        putExtra(EXTRA_ACTION, "show")
        putExtra(EXTRA_SESSION_ID, sessionId)
        putExtra(EXTRA_TITLE, safeTitle)
        if (safePrompt.isNotBlank()) putExtra(EXTRA_AI_PROMPT, safePrompt)
      }
      val fullScreenPendingIntent = PendingIntent.getActivity(
        appCtx,
        notifId,
        fullScreenIntent,
        flags
      )

      val answerIntent = Intent(appCtx, MainActivity::class.java).apply {
        addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_SINGLE_TOP or
            Intent.FLAG_ACTIVITY_CLEAR_TOP
        )
        putExtra(EXTRA_ACTION, "answer")
        putExtra(EXTRA_SESSION_ID, sessionId)
        putExtra(EXTRA_TITLE, safeTitle)
        if (safePrompt.isNotBlank()) putExtra(EXTRA_AI_PROMPT, safePrompt)
      }
      val answerPendingIntent = PendingIntent.getActivity(
        appCtx,
        notifId + 1,
        answerIntent,
        flags
      )

      val declineIntent = Intent(appCtx, KallieCallActionReceiver::class.java).apply {
        putExtra(EXTRA_ACTION, "decline")
        putExtra(EXTRA_SESSION_ID, sessionId)
        if (!declineUrl.isNullOrBlank()) putExtra(EXTRA_DECLINE_URL, declineUrl)
        if (!declineToken.isNullOrBlank()) putExtra(EXTRA_DECLINE_TOKEN, declineToken)
      }
      val declinePendingIntent = PendingIntent.getBroadcast(
        appCtx,
        notifId + 2,
        declineIntent,
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
      val subtitle = if (safeTitle == "Kallie") "Incoming call" else safeTitle
      val builder = NotificationCompat.Builder(appCtx, CHANNEL_INCOMING_CALLS)
        .setSmallIcon(appCtx.applicationInfo.icon)
        .setContentTitle("Kallie")
        .setContentText(subtitle)
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

      val notification = builder.build()
      notification.flags = notification.flags or Notification.FLAG_INSISTENT

      try {
        NotificationManagerCompat.from(appCtx).notify(notifId, notification)
      } catch (_: SecurityException) {
        // Missing POST_NOTIFICATIONS runtime permission on Android 13+
      }
      wakeDeviceBriefly(appCtx)
    }

    fun handleIntent(context: Context, intent: Intent?) {
      if (intent == null) return
      val action = intent.getStringExtra(EXTRA_ACTION)
      val sessionId = intent.getStringExtra(EXTRA_SESSION_ID)
      if (sessionId == null && action != "schedule_test") return

      val resolvedSessionId = sessionId ?: "test_${System.currentTimeMillis()}"
      val resolvedAction = action ?: "show"
      val title = intent.getStringExtra(EXTRA_TITLE) ?: "Kallie"
      val aiPrompt = intent.getStringExtra(EXTRA_AI_PROMPT) ?: ""
      val delaySeconds = intent.getIntExtra(EXTRA_DELAY_SECONDS, 10).coerceIn(3, 300)

      intent.removeExtra(EXTRA_SESSION_ID)
      intent.removeExtra(EXTRA_ACTION)
      intent.removeExtra(EXTRA_TITLE)
      intent.removeExtra(EXTRA_AI_PROMPT)
      intent.removeExtra(EXTRA_DELAY_SECONDS)

      if (resolvedAction == "schedule_test") {
        KallieScheduleAlarmReceiver.scheduleOneShotCall(
          context.applicationContext,
          resolvedSessionId,
          title,
          aiPrompt,
          delaySeconds * 1_000L
        )
        if (context is Activity) {
          context.moveTaskToBack(true)
        }
        return
      }

      if (resolvedAction == "show" || resolvedAction == "answer") {
        if (context is Activity) {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            context.setShowWhenLocked(true)
            context.setTurnScreenOn(true)
          }
          context.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
      }

      if (resolvedAction == "answer" || resolvedAction == "answer_background" || resolvedAction == "decline" || resolvedAction == "hangup") {
        NotificationManagerCompat.from(context).cancel(notificationIdFor(resolvedSessionId))
      }

      emitOrQueueIntent(resolvedAction, resolvedSessionId, title, aiPrompt)
    }

    fun emitIfReactActive(
      action: String,
      sessionId: String,
      title: String,
      aiPrompt: String = ""
    ) {
      val ctx = activeContextRef?.get() ?: return
      if (!ctx.hasActiveReactInstance()) return
      try {
        val map = Arguments.createMap().apply {
          putString("action", action)
          putString("sessionId", sessionId)
          putString("title", title)
          if (aiPrompt.isNotBlank()) putString("aiPrompt", aiPrompt)
        }
        ctx
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(EVENT_INCOMING_INTENT, map)
      } catch (_: Throwable) {
        // Safe no-op
      }
    }

    fun emitOrQueueIntent(
      action: String,
      sessionId: String,
      title: String,
      aiPrompt: String = ""
    ) {
      // Always record pending intent so cold-start or headless-booted JS UI picks it up
      // when mounted; JS deduplicates by sessionId if the event was already delivered.
      pendingAction = action
      pendingSessionId = sessionId
      pendingTitle = title
      pendingAiPrompt = aiPrompt

      emitIfReactActive(action, sessionId, title, aiPrompt)
    }
  }

  private fun createChannelsInternal() {
    ensureChannels(reactContext)
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
    showIncomingCallNotification(reactContext, sessionId, title, null, declineUrl, declineToken)
  }

  @ReactMethod
  fun scheduleTestCall(delaySeconds: Int, title: String, aiPrompt: String?) {
    val safeDelay = delaySeconds.coerceIn(3, 300)
    val safeTitle = if (title.isBlank()) "Kallie Call" else title
    KallieScheduleAlarmReceiver.scheduleOneShotCall(
      reactContext.applicationContext,
      "test_${System.currentTimeMillis()}",
      safeTitle,
      aiPrompt ?: "",
      safeDelay * 1_000L
    )
  }

  @ReactMethod
  fun moveToBackground() {
    Handler(Looper.getMainLooper()).post {
      try {
        reactContext.currentActivity?.moveTaskToBack(true)
      } catch (_: Throwable) {
        // Safe no-op
      }
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
  fun startCallForegroundService(sessionId: String, title: String, promise: Promise) {
    if (!KallieCallForegroundService.hasMicrophonePermission(reactContext)) {
      promise.resolve(false)
      return
    }
    createChannelsInternal()
    if (sessionId.isNotBlank()) {
      NotificationManagerCompat.from(reactContext).cancel(notificationIdFor(sessionId))
    }
    val settled = java.util.concurrent.atomic.AtomicBoolean(false)
    val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
    val timeoutRunnable = Runnable {
      if (settled.compareAndSet(false, true)) {
        promise.resolve(KallieCallForegroundService.isForegroundRunning)
      }
    }
    mainHandler.postDelayed(timeoutRunnable, 1500L)

    val initiated = KallieCallForegroundService.start(
      reactContext,
      sessionId,
      if (title.isBlank()) "Kallie" else title
    ) { started ->
      mainHandler.removeCallbacks(timeoutRunnable)
      if (settled.compareAndSet(false, true)) {
        promise.resolve(started)
      }
    }
    if (!initiated) {
      mainHandler.removeCallbacks(timeoutRunnable)
      if (settled.compareAndSet(false, true)) {
        promise.resolve(false)
      }
    }
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
    val prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val dedupePrefKey = "delivered_rem_$scheduleId"
    if (prefs.getLong(dedupePrefKey, 0L) > 0L) {
      return
    }
    prefs.edit().putLong(dedupePrefKey, System.currentTimeMillis()).apply()

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
  fun syncLocalReminderAlarms(alarmsJson: String) {
    createChannelsInternal()
    KallieScheduleAlarmReceiver.syncAlarmsFromJson(reactContext, alarmsJson)
  }

  @ReactMethod
  fun setKeepScreenOn(enabled: Boolean) {
    Handler(Looper.getMainLooper()).post {
      try {
        val window = reactContext.currentActivity?.window ?: return@post
        if (enabled) {
          window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
          window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
      } catch (_: Throwable) {
        // Safe no-op
      }
    }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun consumePendingCallIntentSync(): com.facebook.react.bridge.WritableMap? {
    val sessionId = pendingSessionId ?: return null
    val action = pendingAction
    val title = pendingTitle
    val aiPrompt = pendingAiPrompt
    pendingSessionId = null
    pendingAction = null
    pendingTitle = null
    pendingAiPrompt = null

    return Arguments.createMap().apply {
      putString("action", action ?: "show")
      putString("sessionId", sessionId)
      putString("title", title ?: "Kallie")
      if (!aiPrompt.isNullOrBlank()) {
        putString("aiPrompt", aiPrompt)
      }
    }
  }

  @ReactMethod
  fun consumePendingCallIntent(promise: Promise) {
    val sessionId = pendingSessionId
    val action = pendingAction
    val title = pendingTitle
    val aiPrompt = pendingAiPrompt
    pendingSessionId = null
    pendingAction = null
    pendingTitle = null
    pendingAiPrompt = null

    if (sessionId == null) {
      promise.resolve(null)
      return
    }
    val map = Arguments.createMap().apply {
      putString("action", action ?: "show")
      putString("sessionId", sessionId)
      putString("title", title ?: "Kallie")
      if (!aiPrompt.isNullOrBlank()) {
        putString("aiPrompt", aiPrompt)
      }
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
          data = Uri.parse("package:${reactContext.packageName}")
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

  @ReactMethod
  fun openNotificationSettings(promise: Promise) {
    try {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
          putExtra(Settings.EXTRA_APP_PACKAGE, reactContext.packageName)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
          data = Uri.parse("package:${reactContext.packageName}")
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
