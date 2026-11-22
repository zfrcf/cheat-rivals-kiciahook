#!/data/data/com.termux/files/usr/bin/bash
# AppImage Droid — script exécuté dans Termux.
#   appimage-droid.sh run <fichier.AppImage> <offset> <id> <arch> [arguments…]
#   appimage-droid.sh remove <id>
# Tout passe par « proot-distro login » : aucun chemin interne de proot-distro
# n'est supposé (il a changé entre les versions).
DISTRO="${APPIMAGE_DROID_DISTRO:-debian}"

say()  { printf '\033[1;36m[AppImage Droid]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[AppImage Droid] %s\033[0m\n' "$*"; read -rp "Entrée pour fermer… " _; exit 1; }

command -v proot-distro >/dev/null || fail "proot-distro manquant : pkg install proot-distro"
proot-distro login "$DISTRO" -- true >/dev/null 2>&1 \
  || fail "Distribution « $DISTRO » introuvable. Suivez « Configuration Termux » dans l'app."

cmd="$1"; shift
case "$cmd" in
  remove)
    [ -n "$1" ] && proot-distro login "$DISTRO" -- rm -rf "/opt/appimages/$1"
    say "Fichiers extraits supprimés : $1"; exit 0 ;;
  run) ;;
  *) fail "Commande inconnue : $cmd" ;;
esac

SRC="$1"; OFF="$2"; ID="$3"; ARCH="$4"; shift 4
[ -r "$SRC" ] || fail "Fichier illisible : $SRC — lancez termux-setup-storage"

# Le dossier de l'AppImage est monté dans Debian sous /mnt/appimage-src.
IN="/mnt/appimage-src/$(basename "$SRC")"
APPDIR="/opt/appimages/$ID"
pd() { proot-distro login "$DISTRO" --shared-tmp --bind "$(dirname "$SRC"):/mnt/appimage-src" -- "$@"; }

if ! pd bash -c '[ -e "$1/AppRun" ] && [ ! "$2" -nt "$1/.appimage-droid" ]' _ "$APPDIR" "$IN"; then
  say "Extraction (première exécution ou mise à jour)…"
  pd bash -c 'command -v unsquashfs' >/dev/null \
    || fail "unsquashfs manquant : proot-distro login $DISTRO -- apt install -y squashfs-tools"
  pd bash -c 'rm -rf "$1" && mkdir -p /opt/appimages && unsquashfs -q -n -o "$3" -d "$1" "$2" >/dev/null && touch "$1/.appimage-droid"' \
    _ "$APPDIR" "$IN" "$OFF" || fail "Échec de l'extraction"
fi

RUNNER=""
HOST="$(uname -m)"
if [ "$ARCH" != "$HOST" ]; then
  case "$ARCH-$HOST" in
    x86_64-aarch64)
      pd bash -c 'command -v box64' >/dev/null \
        || fail "AppImage x86_64 : installez box64 (proot-distro login $DISTRO -- apt install -y box64)."
      RUNNER="box64" ;;
    *) fail "Architecture $ARCH non exécutable sur cet appareil ($HOST)." ;;
  esac
fi

if command -v termux-x11 >/dev/null; then
  if ! pgrep -f "com.termux.x11" >/dev/null; then
    say "Démarrage de Termux:X11…"
    termux-x11 :0 >/dev/null 2>&1 &
    sleep 3
  fi
  am start --user 0 -n com.termux.x11/com.termux.x11.MainActivity >/dev/null 2>&1
else
  say "Termux:X11 absent : l'interface graphique ne s'affichera pas."
fi

say "Lancement de $ID ($ARCH${RUNNER:+ via $RUNNER})…"
pd env DISPLAY=:0 APPDIR="$APPDIR" ARGV0="$ID" $RUNNER "$APPDIR/AppRun" "$@"
rc=$?
[ $rc -eq 0 ] || fail "L'application s'est arrêtée (code $rc). Les messages ci-dessus indiquent la cause."
