#!/usr/bin/env bash
set +e

APK_PATH="${1:-app-test.apk}"
PKG="com.kallie.app"

echo "=== Device ABI & Android Version ==="
adb shell getprop ro.product.cpu.abilist
adb shell getprop ro.build.version.release
adb shell getprop ro.build.version.sdk

echo "=== Installing APK: ${APK_PATH} ==="
adb install -r -g "${APK_PATH}"
INSTALL_CODE=$?
echo "INSTALL_EXIT_CODE=${INSTALL_CODE}"
if [ "${INSTALL_CODE}" -ne 0 ]; then
  echo "RESULT: FAILED_TO_INSTALL"
  exit 1
fi

echo "=== Clearing logcat and launching ${PKG} ==="
adb logcat -c
adb shell monkey -p "${PKG}" -c android.intent.category.LAUNCHER 1
sleep 12

echo "=== Process & Focused Window Check ==="
PID=$(adb shell pidof "${PKG}" | tr -d '\r')
echo "PID_AFTER_12S='${PID}'"
adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp" || true

echo "=== Full Crash / Runtime / JS Logcat ==="
adb logcat -d -v time > full-logcat.txt
grep -E "(FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|ReactNative|com\.kallie\.app|SoLoader|UnsatisfiedLinkError|Firebase|CallKeep|LiveKit|WebRTC|ExpoUpdates|ErrorRecovery|libc|DEBUG|System\.err|chromium|Process ${PKG}|WIN DEATH|ANR in ${PKG}|Force finishing activity)" full-logcat.txt | tail -n 300

echo "=== Capturing UI Hierarchy & Screenshot ==="
adb shell uiautomator dump /sdcard/window_dump.xml || true
adb shell cat /sdcard/window_dump.xml 2>/dev/null | head -c 4000 || true
echo ""
adb exec-out screencap -p > emulator-screen.png || true

if [ -z "${PID}" ]; then
  echo "RESULT: CRASHED (process ${PKG} died)"
  exit 1
fi

if grep -q "FATAL EXCEPTION" full-logcat.txt; then
  echo "RESULT: FATAL_EXCEPTION_IN_LOGCAT"
  exit 1
fi

echo "RESULT: APP_RUNNING_OK (PID=${PID})"
exit 0
