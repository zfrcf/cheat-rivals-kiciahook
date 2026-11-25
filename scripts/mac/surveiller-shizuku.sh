#!/usr/bin/env bash
# Démon (launchd) : toutes les 30 s, si le téléphone est branché et que Shizuku ne tourne pas, le relance.
ADB="$(command -v adb || echo /opt/homebrew/bin/adb)"
DIR="$(cd "$(dirname "$0")" && pwd)"
while true; do
  if [ "$("$ADB" get-state 2>/dev/null)" = "device" ]; then
    if ! "$ADB" shell "ps -A | grep -q shizuku_server" 2>/dev/null; then
      echo "$(date '+%F %T') téléphone détecté, Shizuku arrêté → relance"
      ADB="$ADB" "$DIR/relancer-shizuku.sh" || true
    fi
  fi
  sleep 30
done
