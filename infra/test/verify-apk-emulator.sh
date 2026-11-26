#!/usr/bin/env bash
set +e

APK_PATH="${1:-app-test.apk}"
PKG="com.kallie.app"
TEST_EMAIL="${TEST_EMAIL:-}"
TEST_PASSWORD="${TEST_PASSWORD:-}"

echo "=== Device ABI & Android Version ==="
adb shell getprop ro.product.cpu.abilist
adb shell getprop ro.build.version.release
adb shell getprop ro.build.version.sdk

echo "=== Installing APK (standard user install without -g): ${APK_PATH} ==="
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

PID=$(adb shell pidof "${PKG}" | tr -d '\r')
echo "PID_AFTER_LAUNCH='${PID}'"
adb exec-out screencap -p > emulator-screen-launch.png || true

if [ -n "${PID}" ] && [ -n "${TEST_EMAIL}" ] && [ -n "${TEST_PASSWORD}" ]; then
  echo "=== Dumping UI hierarchy to find Login inputs ==="
  adb shell uiautomator dump /sdcard/login_dump.xml >/dev/null 2>&1 || true
  adb pull /sdcard/login_dump.xml login_dump.xml >/dev/null 2>&1 || true

  # Use python3 to find EditText and SIGN IN coordinates reliably
  python3 - <<'PYEOF'
import re, subprocess, time, xml.etree.ElementTree as ET

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
        import os
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
        subprocess.run(['adb', 'shell', 'input', 'keyevent', '4']) # hide keyboard
        time.sleep(0.5)
        subprocess.run(['adb', 'shell', 'input', 'tap', str(signin_btn[0]), str(signin_btn[1])])
        print("Submitted login form.")
except Exception as e:
    print("Login automation error:", e)
PYEOF

  sleep 8
  echo "=== Dismissing / Allowing any Android runtime permission dialogs ==="
  for attempt in 1 2 3; do
    adb shell uiautomator dump /sdcard/perm_dump.xml >/dev/null 2>&1 || true
    adb pull /sdcard/perm_dump.xml perm_dump.xml >/dev/null 2>&1 || true
    python3 - <<'PYEOF'
import re, subprocess, xml.etree.ElementTree as ET
try:
    root = ET.parse('perm_dump.xml').getroot()
    for node in root.iter('node'):
        txt = node.attrib.get('text', '').strip().lower()
        rid = node.attrib.get('resource-id', '')
        if txt in ('allow', 'while using the app', 'only this time') or 'permission_allow' in rid:
            m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.attrib.get('bounds', ''))
            if m:
                x1, y1, x2, y2 = map(int, m.groups())
                print(f"Tapping permission button '{txt}' ({rid}) at {(x1+x2)//2},{(y1+y2)//2}")
                subprocess.run(['adb', 'shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2)])
                break
except Exception as e:
    print("Perm dump parse note:", e)
PYEOF
    sleep 3
  done

  PID_POST_LOGIN=$(adb shell pidof "${PKG}" | tr -d '\r')
  echo "PID_AFTER_LOGIN_AND_PERMS='${PID_POST_LOGIN}'"
  adb exec-out screencap -p > emulator-screen-postlogin.png || true

  # Also test closing and cold-relaunching while logged in
  if [ -n "${PID_POST_LOGIN}" ]; then
    echo "=== Testing cold relaunch while logged in ==="
    adb shell am force-stop "${PKG}"
    sleep 2
    adb shell monkey -p "${PKG}" -c android.intent.category.LAUNCHER 1
    sleep 10
    PID_RELAUNCH=$(adb shell pidof "${PKG}" | tr -d '\r')
    echo "PID_AFTER_RELAUNCH='${PID_RELAUNCH}'"
    adb exec-out screencap -p > emulator-screen-relaunch.png || true
  fi
fi

echo "=== Process & Focused Window Check ==="
FINAL_PID=$(adb shell pidof "${PKG}" | tr -d '\r')
echo "FINAL_PID='${FINAL_PID}'"
adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp" || true

echo "=== Full Crash / Fatal / Runtime / JS Logcat ==="
adb logcat -d -v time > full-logcat.txt
grep -E "(FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|com\.kallie\.app|SoLoader|UnsatisfiedLinkError|Firebase|CallKeep|LiveKit|WebRTC|ExpoUpdates|ErrorRecovery|libc|SecurityException|ActivityNotFoundException|Process ${PKG}|WIN DEATH|Force finishing activity)" full-logcat.txt | tail -n 300

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
