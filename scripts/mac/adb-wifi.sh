#!/usr/bin/env bash
# Phase 1 : passe ADB en Wi-Fi (téléphone branché en USB au départ, même réseau Wi-Fi que le Mac).
set -euo pipefail
IP=$(adb shell ip -f inet addr show wlan0 | awk '/inet /{print $2}' | cut -d/ -f1)
[ -n "$IP" ] || { echo "IP Wi-Fi introuvable (Wi-Fi activé ?)"; exit 1; }
adb tcpip 5555
sleep 2
echo "Tu peux débrancher le câble."
adb connect "$IP:5555"
