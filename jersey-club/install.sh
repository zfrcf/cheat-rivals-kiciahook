#!/usr/bin/env bash
# Installation du skill jersey-club : dépendances système + venv dédié.
# Usage : bash install.sh   (idempotent)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "[jersey] Dépendances système (ffmpeg, rubberband-cli)…"
if ! command -v ffmpeg >/dev/null || ! command -v rubberband >/dev/null; then
  if command -v apt-get >/dev/null; then
    SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
    $SUDO apt-get update -qq && $SUDO apt-get install -y -qq ffmpeg rubberband-cli
  elif command -v brew >/dev/null; then
    brew install ffmpeg rubberband
  else
    echo "Installez ffmpeg et rubberband manuellement." >&2; exit 1
  fi
fi

echo "[jersey] venv Python…"
[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
# torch CPU d'abord (index dédié, bien plus léger que la version CUDA)
.venv/bin/pip install -q torch torchaudio --index-url https://download.pytorch.org/whl/cpu
grep -vE '^(torch|torchaudio)==' requirements.txt > /tmp/jersey_req.txt
.venv/bin/pip install -q -r /tmp/jersey_req.txt

echo "[jersey] Modèle Demucs htdemucs (téléchargé une fois)…"
.venv/bin/python -c "from demucs.pretrained import get_model; get_model('htdemucs')" 2>/dev/null \
  || echo "⚠ Modèle Demucs non téléchargé (réseau ?) : utilisez --fast en attendant."

echo "[jersey] One-shots synthétiques…"
.venv/bin/python scripts/drums.py --oneshots

mkdir -p "$HOME/.claude/skills"
if [ ! -e "$HOME/.claude/skills/jersey-club" ]; then
  ln -s "$DIR" "$HOME/.claude/skills/jersey-club"
fi
echo "[jersey] Prêt. Test rapide : .venv/bin/python -m pytest -q -m 'not lent'"
