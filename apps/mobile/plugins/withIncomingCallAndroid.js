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

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat

class KallieCallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val sessionId = intent.getStringExtra(KallieIncomingCallModule.EXTRA_SESSION_ID) ?: return
    val action = intent.getStringExtra(KallieIncomingCallModule.EXTRA_ACTION) ?: "decline"

    NotificationManagerCompat.from(context).cancel(KallieIncomingCallModule.notificationIdFor(sessionId))
    KallieIncomingCallModule.emitOrQueueIntent(action, sessionId, "")
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
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
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
    const val CHANNEL_INCOMING_CALLS = "kallie_incoming_calls"
    const val CHANNEL_REMINDERS = "kallie_reminders"
    const val EXTRA_ACTION = "kallie_action"
    const val EXTRA_SESSION_ID = "kallie_session_id"
    const val EXTRA_TITLE = "kallie_title"
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

    fun handleIntent(context: Context, intent: Intent?) {
      if (intent == null) return
      val sessionId = intent.getStringExtra(EXTRA_SESSION_ID) ?: return
      val action = intent.getStringExtra(EXTRA_ACTION) ?: "show"
      val title = intent.getStringExtra(EXTRA_TITLE) ?: "Kallie"
      intent.removeExtra(EXTRA_SESSION_ID)
      intent.removeExtra(EXTRA_ACTION)
      intent.removeExtra(EXTRA_TITLE)

      if (action == "answer" || action == "decline") {
        NotificationManagerCompat.from(context).cancel(notificationIdFor(sessionId))
      }

      emitOrQueueIntent(action, sessionId, title)
    }

    fun emitOrQueueIntent(action: String, sessionId: String, title: String) {
      // Always record pending intent so cold-start or headless-booted JS UI picks it up
      // when mounted; JS deduplicates by sessionId if the event was already delivered.
      pendingAction = action
      pendingSessionId = sessionId
      pendingTitle = title

      val ctx = activeContextRef?.get()
      if (ctx != null && ctx.hasActiveReactInstance()) {
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
          // Pending fields remain queued for consumePendingCallIntent()
        }
      }
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
  }

  @ReactMethod
  fun ensureChannels() {
    createChannelsInternal()
  }

  @ReactMethod
  fun showIncomingCall(sessionId: String, title: String) {
    createChannelsInternal()

    val notifId = notificationIdFor(sessionId)
    val safeTitle = if (title.isBlank()) "Kallie" else title
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    val fullScreenIntent = Intent(reactContext, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
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
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
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
    }
    val declinePendingIntent = PendingIntent.getBroadcast(
      reactContext,
      notifId + 2,
      declineIntent,
      flags
    )

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
      .addAction(0, "End", declinePendingIntent)
      .addAction(0, "Answer", answerPendingIntent)

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
    if (sessionId.isBlank()) {
      manager.cancelAll()
      pendingSessionId = null
      pendingAction = null
      pendingTitle = null
    } else {
      manager.cancel(notificationIdFor(sessionId))
      if (pendingSessionId == sessionId) {
        pendingSessionId = null
        pendingAction = null
        pendingTitle = null
      }
    }
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
  // 1. Update AndroidManifest.xml: lock-screen flags on MainActivity + permissions + action receiver
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

    return modConfig;
  });

  // 2. Write Kotlin native module, package, and BroadcastReceiver
  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const dir = path.join(modConfig.modRequest.platformProjectRoot, PACKAGE_DIR);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'KallieCallActionReceiver.kt'), RECEIVER_KT, 'utf8');
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
