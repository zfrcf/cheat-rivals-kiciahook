#!/data/data/com.termux/files/usr/bin/bash
# AppImage Droid — script exécuté dans Termux.
#   appimage-droid.sh run <fichier.AppImage> <offset> <id> <arch> [arguments…]
#   appimage-droid.sh remove <id>
DISTRO="${APPIMAGE_DROID_DISTRO:-debian}"
ROOTFS="$PREFIX/var/lib/proot-distro/installed-rootfs/$DISTRO"

say()  { printf '\033[1;36m[AppImage Droid]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[AppImage Droid] %s\033[0m\n' "$*"; read -rp "Entrée pour fermer… " _; exit 1; }

cmd="$1"; shift
case "$cmd" in
  remove)
    [ -n "$1" ] && rm -rf "$ROOTFS/opt/appimages/$1"
    say "Fichiers extraits supprimés : $1"; exit 0 ;;
  run) ;;
  *) fail "Commande inconnue : $cmd" ;;
esac

SRC="$1"; OFF="$2"; ID="$3"; ARCH="$4"; shift 4

[ -d "$ROOTFS" ] || fail "Distribution « $DISTRO » absente. Suivez « Configuration Termux » dans l'app."
command -v unsquashfs >/dev/null || fail "unsquashfs manquant : pkg install squashfs-tools"
[ -r "$SRC" ] || fail "Fichier illisible : $SRC — lancez termux-setup-storage"

DEST="$ROOTFS/opt/appimages/$ID"
if [ ! -e "$DEST/AppRun" ] || [ "$SRC" -nt "$DEST/.appimage-droid" ]; then
  say "Extraction (première exécution ou mise à jour)…"
  rm -rf "$DEST"; mkdir -p "$ROOTFS/opt/appimages"
  unsquashfs -q -n -o "$OFF" -d "$DEST" "$SRC" >/dev/null || fail "Échec de l'extraction"
  touch "$DEST/.appimage-droid"
fi

RUNNER=""
HOST="$(uname -m)"
if [ "$ARCH" != "$HOST" ]; then
  case "$ARCH-$HOST" in
    x86_64-aarch64)
      proot-distro login "$DISTRO" -- sh -c 'command -v box64' >/dev/null 2>&1 \
        || fail "AppImage x86_64 : installez box64 dans $DISTRO (voir Configuration Termux)."
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
exec proot-distro login "$DISTRO" --shared-tmp -- \
  env DISPLAY=:0 APPDIR="/opt/appimages/$ID" ARGV0="$ID" \
  $RUNNER "/opt/appimages/$ID/AppRun" "$@"
