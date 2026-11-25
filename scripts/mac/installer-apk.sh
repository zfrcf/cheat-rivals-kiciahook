#!/usr/bin/env bash
# Compile (si besoin) et installe l'app PhonePilot sur le téléphone branché.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK" ]; then (cd "$ROOT/android" && ./gradlew assembleDebug); fi
adb install -r "$APK"
adb shell am start -n com.phonepilot/.MainActivity
echo "✅ PhonePilot installé et ouvert sur le téléphone."
