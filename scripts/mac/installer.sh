#!/usr/bin/env bash
# Installation complète côté Mac : outils, bridge, démon Shizuku, enregistrement MCP dans Claude Code.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
echo "==> PhonePilot : installation sur le Mac ($ROOT)"

command -v brew >/dev/null || { echo "Homebrew requis : https://brew.sh"; exit 1; }
command -v adb >/dev/null || brew install --cask android-platform-tools
command -v node >/dev/null || brew install node
command -v pdftotext >/dev/null || brew install poppler
command -v tailscale >/dev/null || echo "⚠️ Tailscale non trouvé : installe l'app Tailscale (Mac App Store) pour l'accès distant."

cd "$ROOT/bridge" && npm ci && npm run build && npm test
mkdir -p "$HOME/PhonePilot/Recus" "$HOME/PhonePilot/Sauvegardes" "$HOME/.phonepilot"
node dist/index.js pair >/dev/null 2>&1 || true   # crée ~/.phonepilot/config.json (jetons aléatoires, 0600)

# IP Tailscale du Mac → adresse d'écoute du WebSocket téléphone
if command -v tailscale >/dev/null && TSIP=$(tailscale ip -4 2>/dev/null | head -1) && [ -n "$TSIP" ]; then
  node -e "const f=process.env.HOME+'/.phonepilot/config.json';const c=require(f);c.wsHost='$TSIP';require('fs').writeFileSync(f,JSON.stringify(c,null,2),{mode:0o600})"
  echo "==> WebSocket téléphone sur l'IP Tailscale $TSIP"
fi

# Démon launchd : relance Shizuku dès que le téléphone est branché
PLIST="$HOME/Library/LaunchAgents/com.phonepilot.shizuku.plist"
sed "s#__SCRIPT__#$ROOT/scripts/mac/surveiller-shizuku.sh#; s#__HOME__#$HOME#g" "$ROOT/scripts/mac/com.phonepilot.shizuku.plist" > "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "==> Démon de relance Shizuku installé"

# Enregistrement dans Claude Code (stdio, local)
if command -v claude >/dev/null; then
  claude mcp remove phonepilot -s user >/dev/null 2>&1 || true
  claude mcp add phonepilot -s user -- node "$ROOT/bridge/dist/index.js" stdio
  echo "==> Serveur MCP « phonepilot » ajouté à Claude Code"
fi
echo
echo "Étape suivante : affiche le QR d'appairage avec"
echo "  node $ROOT/bridge/dist/index.js pair"
