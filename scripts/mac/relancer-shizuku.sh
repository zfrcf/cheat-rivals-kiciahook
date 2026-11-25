#!/usr/bin/env bash
# Relance Shizuku sur le téléphone branché en USB (nécessaire après chaque redémarrage sous Android 10).
set -euo pipefail
ADB="${ADB:-adb}"
state=$("$ADB" get-state 2>/dev/null || true)
if [ "$state" != "device" ]; then
  echo "Téléphone non détecté (ou débogage non autorisé). Branche-le et accepte l'empreinte RSA."
  exit 1
fi
# Chemin du script de démarrage selon la version de Shizuku
for s in /storage/emulated/0/Android/data/moe.shizuku.privileged.api/start.sh /sdcard/Android/data/moe.shizuku.privileged.api/start.sh; do
  if "$ADB" shell "[ -f $s ]" 2>/dev/null; then
    "$ADB" shell sh "$s" && echo "✅ Shizuku démarré" && exit 0
  fi
done
# Méthode moderne : bibliothèque native de l'appli
LIB=$("$ADB" shell pm path moe.shizuku.privileged.api | sed 's/package://; s/base.apk//' | tr -d '\r')
if [ -n "$LIB" ]; then
  "$ADB" shell "$(echo "$LIB")lib/arm64/libshizuku.so" && echo "✅ Shizuku démarré" && exit 0
fi
echo "❌ Shizuku introuvable : ouvre l'app Shizuku une fois sur le téléphone."
exit 1
