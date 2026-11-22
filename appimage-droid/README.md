# AppImage Droid

Application Android (10+) pour installer et lancer des fichiers **.AppImage** Linux.

## Principe

Android ne peut pas exécuter un AppImage directement (binaires Linux glibc + image squashfs).
L'app fait le pont :

1. **Installation** : l'AppImage est copié dans `/sdcard/AppImages`. L'app lit son en-tête ELF
   (architecture, offset squashfs) et son contenu (fichier `.desktop`, icône) grâce à un lecteur
   squashfs écrit en Kotlin (gzip, xz, lzma, lz4, zstd).
2. **Lancement** : via l'intent `RUN_COMMAND` de Termux, l'AppImage est extrait une fois
   (`unsquashfs -o <offset>`) dans une Debian `proot-distro`, puis `AppRun` est lancé avec
   l'affichage **Termux:X11**. Les AppImage x86_64 passent par **box64** sur ARM64.
3. **Raccourcis** sur l'écran d'accueil, arguments de lancement (`--no-sandbox` auto pour Electron),
   désinstallation propre.

## Prérequis (écran « Configuration Termux » dans l'app)

- Termux (F-Droid) + Termux:X11
- `pkg install proot-distro squashfs-tools termux-x11-nightly`
- `allow-external-apps=true` dans `~/.termux/termux.properties`
- `proot-distro install debian` + bibliothèques GTK/NSS (+ `box64` pour le x86_64)

## Compiler

```bash
./gradlew testReleaseUnitTest assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

## Limites

- Pas d'accélération GPU ; émulation x86_64 lente ; compatibilité variable selon l'app.
- AppImage de type 1 (ISO 9660, très ancien) non pris en charge.
