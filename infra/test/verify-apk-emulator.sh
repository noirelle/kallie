#!/usr/bin/env bash
set +e

APK_PATH="${1:-app-test.apk}"
PKG="com.kallie.app"
TEST_EMAIL="${TEST_EMAIL:-}"
TEST_PASSWORD="${TEST_PASSWORD:-}"

dismiss_system_dialogs() {
  for i in 1 2 3; do
    adb shell uiautomator dump /sdcard/sys_dump.xml >/dev/null 2>&1 || true
    adb pull /sdcard/sys_dump.xml sys_dump.xml >/dev/null 2>&1 || true
    python3 - <<'PYEOF'
import re, subprocess, xml.etree.ElementTree as ET
try:
    root = ET.parse('sys_dump.xml').getroot()
    for node in root.iter('node'):
        txt = node.attrib.get('text', '').strip().lower()
        rid = node.attrib.get('resource-id', '')
        if txt in ('close app', 'wait', 'allow', 'while using the app', 'only this time') or 'permission_allow' in rid or 'aerr_close' in rid:
            m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.attrib.get('bounds', ''))
            if m:
                x1, y1, x2, y2 = map(int, m.groups())
                print(f"Dismissing/allowing dialog button '{txt}' ({rid}) at {(x1+x2)//2},{(y1+y2)//2}")
                subprocess.run(['adb', 'shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2)])
                raise SystemExit(0)
    raise SystemExit(1)
except SystemExit as e:
    raise e
except Exception:
    raise SystemExit(1)
PYEOF
    if [ $? -ne 0 ]; then
      break
    fi
    sleep 2
  done
}

echo "=== Device ABI & Android Version ==="
adb shell getprop ro.product.cpu.abilist
adb shell getprop ro.build.version.release
adb shell getprop ro.build.version.sdk

echo "=== Installing APK: ${APK_PATH} ==="
adb install -r "${APK_PATH}"
INSTALL_CODE=$?
echo "INSTALL_EXIT_CODE=${INSTALL_CODE}"
if [ "${INSTALL_CODE}" -ne 0 ]; then
  echo "RESULT: FAILED_TO_INSTALL"
  exit 1
fi

echo "=== Clearing logcat and launching ${PKG} ==="
adb logcat -c
adb shell monkey -p "${PKG}" -c android.intent.category.LAUNCHER 1
sleep 10
dismiss_system_dialogs

PID=$(adb shell pidof "${PKG}" | tr -d '\r')
echo "PID_AFTER_LAUNCH='${PID}'"
adb exec-out screencap -p > emulator-screen-launch.png || true

if [ -n "${PID}" ] && [ -n "${TEST_EMAIL}" ] && [ -n "${TEST_PASSWORD}" ]; then
  echo "=== Dumping UI hierarchy to find Login inputs ==="
  adb shell uiautomator dump /sdcard/login_dump.xml >/dev/null 2>&1 || true
  adb pull /sdcard/login_dump.xml login_dump.xml >/dev/null 2>&1 || true

  python3 - <<'PYEOF'
import os, re, subprocess, time, xml.etree.ElementTree as ET

def parse_center(bounds):
    m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
    if not m:
        return None
    x1, y1, x2, y2 = map(int, m.groups())
    return ((x1 + x2) // 2, (y1 + y2) // 2)

try:
    tree = ET.parse('login_dump.xml')
    root = tree.getroot()
    edits = []
    signin_btn = None
    for node in root.iter('node'):
        cls = node.attrib.get('class', '')
        text = node.attrib.get('text', '')
        bounds = node.attrib.get('bounds', '')
        if cls == 'android.widget.EditText':
            edits.append(parse_center(bounds))
        if text.strip().upper() == 'SIGN IN':
            signin_btn = parse_center(bounds)
    print(f"Found edits={edits}, signin_btn={signin_btn}")
    if len(edits) >= 2 and signin_btn:
        email = os.environ['TEST_EMAIL']
        pwd = os.environ['TEST_PASSWORD']
        subprocess.run(['adb', 'shell', 'input', 'tap', str(edits[0][0]), str(edits[0][1])])
        time.sleep(0.5)
        subprocess.run(['adb', 'shell', 'input', 'text', email])
        time.sleep(0.5)
        subprocess.run(['adb', 'shell', 'input', 'tap', str(edits[1][0]), str(edits[1][1])])
        time.sleep(0.5)
        subprocess.run(['adb', 'shell', 'input', 'text', pwd])
        time.sleep(0.5)
        subprocess.run(['adb', 'shell', 'input', 'keyevent', '4'])
        time.sleep(0.6)
        subprocess.run(['adb', 'shell', 'input', 'tap', str(signin_btn[0]), str(signin_btn[1])])
        print("Submitted login form.")
except Exception as e:
    print("Login automation error:", e)
PYEOF

  sleep 6
  echo "=== Allowing runtime permission dialogs after login ==="
  dismiss_system_dialogs
  sleep 6
  dismiss_system_dialogs
  sleep 4

  PID_POST_LOGIN=$(adb shell pidof "${PKG}" | tr -d '\r')
  echo "PID_AFTER_LOGIN_AND_PERMS='${PID_POST_LOGIN}'"
  adb exec-out screencap -p > emulator-screen-postlogin.png || true

  if [ -n "${PID_POST_LOGIN}" ]; then
    echo "=== Testing cold relaunch while logged in ==="
    adb shell am force-stop "${PKG}"
    sleep 2
    adb shell monkey -p "${PKG}" -c android.intent.category.LAUNCHER 1
    sleep 8
    dismiss_system_dialogs
    sleep 4
    PID_RELAUNCH=$(adb shell pidof "${PKG}" | tr -d '\r')
    echo "PID_AFTER_RELAUNCH='${PID_RELAUNCH}'"
    adb exec-out screencap -p > emulator-screen-relaunch.png || true

    # Also test tapping START CALL to verify call screen / LiveKit initialization does not crash
    if [ -n "${PID_RELAUNCH}" ]; then
      echo "=== Testing START CALL button on Home screen ==="
      adb shell uiautomator dump /sdcard/home_dump.xml >/dev/null 2>&1 || true
      adb pull /sdcard/home_dump.xml home_dump.xml >/dev/null 2>&1 || true
      python3 - <<'PYEOF'
import re, subprocess, xml.etree.ElementTree as ET
try:
    root = ET.parse('home_dump.xml').getroot()
    for node in root.iter('node'):
        if node.attrib.get('text', '').strip().upper() == 'START CALL':
            m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.attrib.get('bounds', ''))
            if m:
                x1, y1, x2, y2 = map(int, m.groups())
                print(f"Tapping START CALL at {(x1+x2)//2},{(y1+y2)//2}")
                subprocess.run(['adb', 'shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2)])
                break
except Exception as e:
    print("Home dump parse note:", e)
PYEOF
      sleep 5
      dismiss_system_dialogs
      sleep 5
      PID_CALL=$(adb shell pidof "${PKG}" | tr -d '\r')
      echo "PID_AFTER_START_CALL='${PID_CALL}'"
      adb exec-out screencap -p > emulator-screen-call.png || true
    fi
  fi
fi

echo "=== Process & Focused Window Check ==="
FINAL_PID=$(adb shell pidof "${PKG}" | tr -d '\r')
echo "FINAL_PID='${FINAL_PID}'"
adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp" || true

echo "=== Full Crash / Fatal / Runtime / JS Logcat ==="
adb logcat -d -v time > full-logcat.txt
grep -E "(FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|com\.kallie\.app|SoLoader|UnsatisfiedLinkError|Firebase|RNCallKeep|LiveKit|WebRTC|ExpoUpdates|ErrorRecovery|libc|SecurityException|IllegalArgumentException|ActivityNotFoundException|MissingForegroundServiceTypeException|Process ${PKG}|WIN DEATH|Force finishing activity|Caused by:|^\s+at (io\.wazo|com\.kallie|android\.telecom))" full-logcat.txt | grep -vE "(AiAiAutofill|AppOps|RuntimeInit|uiautomator|monkey|Access denied finding property)" | tail -n 250

if [ -z "${FINAL_PID}" ]; then
  echo "RESULT: CRASHED (process ${PKG} died)"
  exit 1
fi

if grep -q "FATAL EXCEPTION" full-logcat.txt; then
  echo "RESULT: FATAL_EXCEPTION_IN_LOGCAT"
  exit 1
fi

echo "RESULT: APP_RUNNING_OK (PID=${FINAL_PID})"
exit 0
