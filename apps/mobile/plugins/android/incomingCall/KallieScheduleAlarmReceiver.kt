package com.kallie.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Handles local pre-call reminder alarms scheduled via AlarmManager and
 * automatically restores upcoming alarms after device reboot or timezone/time changes
 * without booting the React Native JS runtime.
 */
class KallieScheduleAlarmReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_FIRE_REMINDER = "com.kallie.app.action.FIRE_LOCAL_REMINDER"
    const val PREF_ALARMS_MANIFEST = "kallie_local_alarms_v1"
    const val EXTRA_DEDUPE_KEY = "kallie_alarm_dedupe_key"
    const val EXTRA_REMINDER_TITLE = "kallie_alarm_title"
    const val EXTRA_AI_PROMPT = "kallie_alarm_ai_prompt"
    const val EXTRA_MINUTES_BEFORE = "kallie_alarm_minutes_before"
    const val EXTRA_TRIGGER_AT_MS = "kallie_alarm_trigger_at_ms"
    private const val STALE_THRESHOLD_MS = 5 * 60 * 1000L

    fun syncAlarmsFromJson(context: Context, alarmsJson: String) {
      val prefs = context.getSharedPreferences(
        KallieIncomingCallModule.PREFS_NAME,
        Context.MODE_PRIVATE
      )
      val prevJson = prefs.getString(PREF_ALARMS_MANIFEST, "[]") ?: "[]"
      cancelManifestAlarms(context, prevJson)

      prefs.edit().putString(PREF_ALARMS_MANIFEST, alarmsJson).apply()
      scheduleManifestAlarms(context, alarmsJson)
    }

    fun reschedulePersistedAlarms(context: Context) {
      val prefs = context.getSharedPreferences(
        KallieIncomingCallModule.PREFS_NAME,
        Context.MODE_PRIVATE
      )
      val manifest = prefs.getString(PREF_ALARMS_MANIFEST, "[]") ?: "[]"
      scheduleManifestAlarms(context, manifest)
    }

    fun scheduleOneShotCall(
      context: Context,
      sessionId: String,
      title: String,
      aiPrompt: String,
      delayMs: Long
    ) {
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      val fireAt = System.currentTimeMillis() + maxOf(2_000L, delayMs)
      val pi = buildAlarmPendingIntent(context, sessionId, title, aiPrompt, 0, fireAt)
      setExactWakeupAlarm(alarmManager, context, fireAt, pi)
    }

    private fun setExactWakeupAlarm(
      alarmManager: AlarmManager,
      context: Context,
      fireAt: Long,
      pi: PendingIntent
    ) {
      val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
        alarmManager.canScheduleExactAlarms()

      if (canExact) {
        try {
          val showIntent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
          }
          val showPi = PendingIntent.getActivity(
            context,
            0,
            showIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
          )
          val info = AlarmManager.AlarmClockInfo(fireAt, showPi)
          alarmManager.setAlarmClock(info, pi)
          return
        } catch (_: SecurityException) {
          // Fall through to exact/idle fallback
        }
      }

      try {
        if (canExact && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pi)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pi)
        } else {
          alarmManager.set(AlarmManager.RTC_WAKEUP, fireAt, pi)
        }
      } catch (_: SecurityException) {
        try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pi)
          } else {
            alarmManager.set(AlarmManager.RTC_WAKEUP, fireAt, pi)
          }
        } catch (_: Throwable) {
          // Safe fallback if OEM blocks wakeup alarms
        }
      }
    }

    private fun cancelManifestAlarms(context: Context, manifestJson: String) {
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      try {
        val arr = JSONArray(manifestJson)
        for (i in 0 until arr.length()) {
          val obj = arr.optJSONObject(i) ?: continue
          val dedupeKey = obj.optString("dedupeKey", "")
          if (dedupeKey.isBlank()) continue
          val pi = buildAlarmPendingIntent(context, dedupeKey, "", "", 0, 0L)
          alarmManager.cancel(pi)
          pi.cancel()
        }
      } catch (_: Throwable) {
        // Ignore malformed legacy manifest
      }
    }

    private fun scheduleManifestAlarms(context: Context, manifestJson: String) {
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      val now = System.currentTimeMillis()
      try {
        val arr = JSONArray(manifestJson)
        for (i in 0 until arr.length()) {
          val obj = arr.optJSONObject(i) ?: continue
          val dedupeKey = obj.optString("dedupeKey", "")
          val title = obj.optString("title", "Kallie")
          val aiPrompt = obj.optString("aiPrompt", "")
          val minutesBefore = obj.optInt("minutesBefore", 0)
          val triggerAtMs = obj.optLong("triggerAtMs", 0L)
          if (dedupeKey.isBlank() || triggerAtMs <= now - STALE_THRESHOLD_MS) continue

          val fireAt = maxOf(now + 1_500L, triggerAtMs)
          val pi = buildAlarmPendingIntent(
            context,
            dedupeKey,
            title,
            aiPrompt,
            minutesBefore,
            triggerAtMs
          )
          setExactWakeupAlarm(alarmManager, context, fireAt, pi)
        }
      } catch (_: Throwable) {
        // Ignore malformed manifest
      }
    }

    private fun buildAlarmPendingIntent(
      context: Context,
      dedupeKey: String,
      title: String,
      aiPrompt: String,
      minutesBefore: Int,
      triggerAtMs: Long
    ): PendingIntent {
      val reqCode = KallieIncomingCallModule.notificationIdFor("alarm_$dedupeKey")
      val intent = Intent(context, KallieScheduleAlarmReceiver::class.java).apply {
        action = ACTION_FIRE_REMINDER
        putExtra(EXTRA_DEDUPE_KEY, dedupeKey)
        putExtra(EXTRA_REMINDER_TITLE, title)
        putExtra(EXTRA_AI_PROMPT, aiPrompt)
        putExtra(EXTRA_MINUTES_BEFORE, minutesBefore)
        putExtra(EXTRA_TRIGGER_AT_MS, triggerAtMs)
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      return PendingIntent.getBroadcast(context, reqCode, intent, flags)
    }
  }

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_TIMEZONE_CHANGED,
      Intent.ACTION_TIME_CHANGED,
      Intent.ACTION_MY_PACKAGE_REPLACED -> {
        reschedulePersistedAlarms(context)
      }
      ACTION_FIRE_REMINDER -> {
        handleFireReminder(context, intent)
      }
    }
  }

  private fun handleFireReminder(context: Context, intent: Intent) {
    val dedupeKey = intent.getStringExtra(EXTRA_DEDUPE_KEY) ?: return
    val title = intent.getStringExtra(EXTRA_REMINDER_TITLE) ?: "Kallie"
    val aiPrompt = intent.getStringExtra(EXTRA_AI_PROMPT) ?: ""
    val minutesBefore = intent.getIntExtra(EXTRA_MINUTES_BEFORE, 0)
    val triggerAtMs = intent.getLongExtra(EXTRA_TRIGGER_AT_MS, 0L)

    // Skip stale missed alarms instead of firing outdated calls after long offline periods
    if (triggerAtMs > 0L && System.currentTimeMillis() - triggerAtMs > STALE_THRESHOLD_MS) {
      return
    }

    val prefs = context.getSharedPreferences(
      KallieIncomingCallModule.PREFS_NAME,
      Context.MODE_PRIVATE
    )
    val dedupePrefix = if (minutesBefore <= 0) "delivered_call_" else "delivered_rem_"
    val dedupePrefKey = "$dedupePrefix$dedupeKey"
    if (prefs.getLong(dedupePrefKey, 0L) > 0L) {
      return
    }
    prefs.edit().putLong(dedupePrefKey, System.currentTimeMillis()).apply()

    // Scheduled call time (minutesBefore <= 0): trigger a real native ringing incoming call
    // with CallStyle, ringtone, vibration, Answer / Decline / Answer in background, and
    // full-screen intent — works even when the app is completely closed or screen is locked.
    if (minutesBefore <= 0) {
      KallieIncomingCallModule.showIncomingCallNotification(
        context = context,
        sessionId = "alarm_$dedupeKey",
        title = title,
        aiPrompt = aiPrompt.ifBlank { null },
        declineUrl = null,
        declineToken = null
      )
      return
    }

    KallieIncomingCallModule.ensureChannels(context)
    val notifId = KallieIncomingCallModule.notificationIdFor("reminder_$dedupeKey")
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val openIntent = Intent(context, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val pendingOpen = PendingIntent.getActivity(context, notifId, openIntent, flags)

    val body = "Kallie will call you in $minutesBefore minutes ($title)."
    val notification = NotificationCompat.Builder(
      context,
      KallieIncomingCallModule.CHANNEL_REMINDERS
    )
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle("Kallie")
      .setContentText(body)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setAutoCancel(true)
      .setContentIntent(pendingOpen)
      .build()

    try {
      NotificationManagerCompat.from(context).notify(notifId, notification)
    } catch (_: SecurityException) {
      // Missing POST_NOTIFICATIONS permission
    }
  }
}
