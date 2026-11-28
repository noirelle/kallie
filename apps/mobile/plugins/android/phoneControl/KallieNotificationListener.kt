package com.kallie.app

import android.app.Notification
import android.app.PendingIntent
import android.app.Person
import android.app.RemoteInput
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

class KallieNotificationListener : NotificationListenerService() {
  data class StoredNotification(
    val key: String,
    val packageName: String,
    val appLabel: String,
    val title: String,
    val text: String,
    val timestamp: Long,
    val replyAction: Notification.Action?,
    val remoteInput: RemoteInput?
  )

  companion object {
    @Volatile
    var instance: KallieNotificationListener? = null
      private set

    private val recentNotifications = ConcurrentHashMap<String, StoredNotification>()
    private val CAMEL_SPLIT_REGEX = Regex("(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")
    private val NON_ALNUM_REGEX = Regex("[^a-z0-9]+")

    private fun labelAcronym(label: String): String {
      val split = CAMEL_SPLIT_REGEX.replace(label, " ")
      return NON_ALNUM_REGEX.split(split.lowercase())
        .filter { it.isNotEmpty() }
        .mapNotNull { it.firstOrNull() }
        .joinToString("")
    }

    fun isConnected(): Boolean = instance != null

    fun hasReplyableNotification(key: String): Boolean {
      val svc = instance ?: return false
      // Quick reconciliation against live system notifications
      val activeKeys = try {
        svc.activeNotifications?.map { it.key }?.toHashSet()
      } catch (_: Throwable) {
        null
      }
      if (activeKeys != null && !activeKeys.contains(key)) {
        recentNotifications.remove(key)
        return false
      }
      val stored = recentNotifications[key] ?: return false
      return stored.replyAction != null && stored.remoteInput != null
    }

    fun listRecentEnvelopeJson(appFilter: String? = null): String {
      val svc = instance
      val connected = svc != null
      if (svc != null) {
        try {
          val active = svc.activeNotifications
          if (active != null) {
            val activeKeys = HashSet<String>(active.size)
            for (sbn in active) {
              activeKeys.add(sbn.key)
              if (!recentNotifications.containsKey(sbn.key)) {
                svc.captureNotification(sbn)
              }
            }
            // Prune dismissed/expired keys
            val keysToRemove = recentNotifications.keys.filter { !activeKeys.contains(it) }
            for (k in keysToRemove) {
              recentNotifications.remove(k)
            }
          }
        } catch (_: Throwable) {
          // Keep in-memory cache if activeNotifications query fails
        }
      }

      val filter = appFilter?.trim()?.lowercase() ?: ""

      val items = recentNotifications.values
        .filter { item ->
          filter.isEmpty() ||
            item.appLabel.lowercase().contains(filter) ||
            item.packageName.lowercase().contains(filter) ||
            item.title.lowercase().contains(filter) ||
            (filter.length in 2..4 && labelAcronym(item.appLabel) == filter)
        }
        .sortedByDescending { it.timestamp }
        .take(20)

      val arr = JSONArray()
      for (item in items) {
        arr.put(
          JSONObject().apply {
            put("key", item.key)
            put("packageName", item.packageName)
            put("appName", item.appLabel)
            put("title", item.title)
            put("text", item.text)
            put("timestamp", item.timestamp)
            put("canReply", item.replyAction != null && item.remoteInput != null)
          }
        )
      }

      return JSONObject().apply {
        put("notificationAccessConnected", connected)
        put("notifications", arr)
      }.toString()
    }

    fun replyToKey(key: String, replyText: String): Pair<Boolean, String> {
      val svc = instance ?: return Pair(false, "Notification Access is not enabled.")
      val stored = recentNotifications[key]
        ?: return Pair(false, "Notification not found or already dismissed.")
      val action = stored.replyAction
      val remoteInput = stored.remoteInput
      if (action == null || remoteInput == null) {
        return Pair(false, "This notification does not support direct inline reply.")
      }
      return try {
        val fillInIntent = Intent()
        val bundle = Bundle().apply {
          putCharSequence(remoteInput.resultKey, replyText)
        }
        RemoteInput.addResultsToIntent(arrayOf(remoteInput), fillInIntent, bundle)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          RemoteInput.setResultsSource(fillInIntent, RemoteInput.SOURCE_FREE_FORM_INPUT)
        }
        action.actionIntent.send(svc, 0, fillInIntent)
        Pair(true, "Replied to " + stored.title + " via " + stored.appLabel)
      } catch (_: PendingIntent.CanceledException) {
        recentNotifications.remove(key)
        Pair(false, "Notification expired or was dismissed. Open the app to reply instead.")
      } catch (err: Throwable) {
        Pair(false, err.message ?: "Failed to send inline reply")
      }
    }
  }

  override fun onListenerConnected() {
    super.onListenerConnected()
    instance = this
    try {
      activeNotifications?.forEach { captureNotification(it) }
    } catch (_: Throwable) {
      // Ignore startup query error
    }
  }

  override fun onListenerDisconnected() {
    super.onListenerDisconnected()
    instance = null
    recentNotifications.clear()
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null) return
    captureNotification(sbn)
  }

  override fun onNotificationRemoved(sbn: StatusBarNotification?) {
    if (sbn == null) return
    recentNotifications.remove(sbn.key)
  }

  private fun extractMessagingText(extras: Bundle): String? {
    return try {
      @Suppress("DEPRECATION")
      val msgArray = extras.getParcelableArray(Notification.EXTRA_MESSAGES) ?: return null
      if (msgArray.isEmpty()) return null
      val tail = msgArray.takeLast(2)
      val lines = ArrayList<String>(tail.size)
      for (entry in tail) {
        val b = entry as? Bundle ?: continue
        val body = b.getCharSequence("text")?.toString()?.trim() ?: ""
        if (body.isEmpty()) continue
        val sender = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          @Suppress("DEPRECATION")
          (b.getParcelable("sender_person") as? Person)?.name?.toString()?.trim()
            ?: b.getCharSequence("sender")?.toString()?.trim()
        } else {
          b.getCharSequence("sender")?.toString()?.trim()
        }
        if (!sender.isNullOrBlank()) {
          lines.add("$sender: $body")
        } else {
          lines.add(body)
        }
      }
      lines.takeIf { it.isNotEmpty() }?.joinToString(" | ")
    } catch (_: Throwable) {
      null
    }
  }

  private fun captureNotification(sbn: StatusBarNotification) {
    if (sbn.packageName == packageName) return
    val notif = sbn.notification ?: return

    // Always skip non-replyable group summaries ("5 messages from 2 chats")
    if ((notif.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return

    var replyAction: Notification.Action? = null
    var remoteInput: RemoteInput? = null
    val actions = notif.actions
    if (actions != null) {
      for (act in actions) {
        val inputs = act.remoteInputs
        if (!inputs.isNullOrEmpty() && act.actionIntent != null) {
          val freeForm = inputs.firstOrNull { it.allowFreeFormInput } ?: inputs[0]
          replyAction = act
          remoteInput = freeForm
          break
        }
      }
    }

    // Skip ongoing background banners (Spotify, VPN, active calls) unless they support inline reply
    if ((notif.flags and Notification.FLAG_ONGOING_EVENT) != 0 && replyAction == null) return

    val extras = notif.extras ?: return
    val convTitle = extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString()?.trim()
    val rawTitle = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: ""
    val title = if (!convTitle.isNullOrBlank() && rawTitle.isNotBlank() && !convTitle.equals(rawTitle, ignoreCase = true)) {
      "$convTitle ($rawTitle)"
    } else {
      convTitle?.ifBlank { rawTitle } ?: rawTitle
    }

    val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim()
    val messagingText = extractMessagingText(extras)
    val text = messagingText
      ?: bigText
      ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim()
      ?: ""
    if (title.isEmpty() && text.isEmpty()) return

    val appLabel = try {
      val info = packageManager.getApplicationInfo(sbn.packageName, 0)
      packageManager.getApplicationLabel(info)?.toString() ?: sbn.packageName
    } catch (_: Throwable) {
      sbn.packageName
    }

    val stored = StoredNotification(
      key = sbn.key,
      packageName = sbn.packageName,
      appLabel = appLabel,
      title = title.take(100),
      text = text.take(280),
      timestamp = sbn.postTime,
      replyAction = replyAction,
      remoteInput = remoteInput
    )
    recentNotifications[sbn.key] = stored

    if (recentNotifications.size > 40) {
      val oldestKey = recentNotifications.values.minByOrNull { it.timestamp }?.key
      if (oldestKey != null) recentNotifications.remove(oldestKey)
    }
  }
}
