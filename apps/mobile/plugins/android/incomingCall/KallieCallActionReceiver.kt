package com.kallie.app

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
    val aiPrompt = intent.getStringExtra(KallieIncomingCallModule.EXTRA_AI_PROMPT) ?: ""

    when (action) {
      "decline" -> handleDecline(context, intent, sessionId)
      "answer_background" -> handleBackgroundAnswer(context, sessionId, title, aiPrompt)
      "hangup" -> handleHangUp(context, sessionId)
      else -> {
        NotificationManagerCompat.from(context)
          .cancel(KallieIncomingCallModule.notificationIdFor(sessionId))
        KallieIncomingCallModule.emitOrQueueIntent(action, sessionId, title, aiPrompt)
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

  private fun handleBackgroundAnswer(
    context: Context,
    sessionId: String,
    title: String,
    aiPrompt: String
  ) {
    NotificationManagerCompat.from(context)
      .cancel(KallieIncomingCallModule.notificationIdFor(sessionId))
    KallieIncomingCallModule.clearPendingIfMatches(sessionId)

    val hasMicPermission = ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.RECORD_AUDIO
    ) == PackageManager.PERMISSION_GRANTED

    // True background answer (without opening UI) works immediately when React is alive
    // and RECORD_AUDIO is granted. If the app was completely closed (cold-killed),
    // start the foreground service and boot MainActivity with answer_background so JS
    // connects the voice call and then drops cleanly back into the background.
    if (hasMicPermission && KallieIncomingCallModule.hasActiveReactInstance()) {
      KallieCallForegroundService.start(context, sessionId, title)
      KallieIncomingCallModule.emitOrQueueIntent("answer_background", sessionId, title, aiPrompt)
      return
    }

    if (hasMicPermission) {
      KallieCallForegroundService.start(context, sessionId, title)
    }

    val launchIntent = Intent(context, MainActivity::class.java).apply {
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_CLEAR_TOP
      )
      putExtra(
        KallieIncomingCallModule.EXTRA_ACTION,
        if (hasMicPermission) "answer_background" else "answer"
      )
      putExtra(KallieIncomingCallModule.EXTRA_SESSION_ID, sessionId)
      putExtra(KallieIncomingCallModule.EXTRA_TITLE, title)
      if (aiPrompt.isNotBlank()) {
        putExtra(KallieIncomingCallModule.EXTRA_AI_PROMPT, aiPrompt)
      }
    }
    try {
      context.startActivity(launchIntent)
    } catch (_: Throwable) {
      KallieIncomingCallModule.emitOrQueueIntent(
        if (hasMicPermission) "answer_background" else "answer",
        sessionId,
        title,
        aiPrompt
      )
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
