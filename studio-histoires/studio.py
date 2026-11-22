#!/usr/bin/env python3
"""
Studio Histoires — de l'idée à la vidéo finie.

  python studio.py nouveau "idée de l'histoire" [--format 9:16] [--style cube3d] [--duree 60]
  python studio.py verifier  projets/mon_histoire
  python studio.py voix      projets/mon_histoire
  python studio.py rendu     projets/mon_histoire [--apercu]
  python studio.py montage   projets/mon_histoire
  python studio.py tout      projets/mon_histoire [--apercu]
  python studio.py planche   projets/mon_histoire      (planche contact pour relecture)
  python studio.py voix-liste
  python studio.py interface                          (interface web locale)
"""
import argparse, json, re, subprocess, sys, time, unicodedata
from pathlib import Path

RACINE = Path(__file__).resolve().parent
sys.path.insert(0, str(RACINE))

DECORS_2D = ["bus", "rue", "cuisine", "chambre", "buanderie", "salon", "parc", "cimetiere", "salle_sport", "bureau", "ville_nuit", "porte", "immeuble", "couleur"]
DECORS_3D = ["ville", "chambre", "place_nuit", "pelouse", "salle", "salle_sport", "couleur"]
EMOTIONS = ["neutre", "content", "heureux", "rire", "joie", "triste", "pleure", "surpris", "choque", "gene", "blase", "fatigue", "fache"]
GESTES = ["pointe", "explique", "salue", "leve_bras", "joie", "bras_croises", "mains_hanches", "tete", "haussement", "saute"]
INSERTS = ["notif", "badge", "panneau", "ecran", "compteur", "titre", "bulle", "icones"]
CAMERAS_2D = ["auto", "large", "moyen", "gros", "deux"]
CAMERAS_3D = ["auto", "large", "moyen", "gros", "trois_quart", "plongee", "bas", "dos", "orbite", "drone"]
SFX = ["pop", "bulle", "whoosh", "swipe", "ding", "notif", "sonnerie", "vibreur", "boing", "clic", "tada", "triste", "applaudissements", "coupure", "electricite", "bebe", "porte", "pas", "bus"]


def slug(s):
    s = unicodedata.normalize("NFD", s.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")[:40] or "histoire"


def charger(dossier):
    d = Path(dossier)
    p = d / "projet.json" if d.is_dir() else d
    if not p.exists():
        sys.exit(f"❌ Projet introuvable : {p}")
    return p.parent, json.loads(p.read_text(encoding="utf-8"))


# ------------------------------------------------------------------ vérification
def verifier(projet, silencieux=False):
    err, avert = [], []
    style = projet.get("style", "plat2d")
    decors = DECORS_3D if style == "cube3d" else DECORS_2D
    cams = CAMERAS_3D if style == "cube3d" else CAMERAS_2D
    persos = projet.get("personnages", {})
    if projet.get("format") not in ("16:9", "9:16"):
        err.append("format doit être \"16:9\" ou \"9:16\"")
    if not projet.get("scenes"):
        err.append("aucune scène")
    total_mots = 0
    for i, sc in enumerate(projet.get("scenes", [])):
        lieu = f"scène {i + 1}"
        dn = sc.get("decor") if isinstance(sc.get("decor"), str) else (sc.get("decor") or {}).get("nom")
        if dn not in decors:
            err.append(f"{lieu} : décor « {dn} » inconnu pour le style {style} (choix : {', '.join(decors)})")
        ids = [a.get("id") for a in sc.get("acteurs", [])]
        for a in ids:
            if a not in persos:
                err.append(f"{lieu} : acteur « {a} » absent de \"personnages\"")
        for j, L in enumerate(sc.get("lignes", [])):
            ll = f"{lieu}, réplique {j + 1}"
            if not L.get("texte"):
                err.append(f"{ll} : texte vide")
            total_mots += len(L.get("texte", "").split())
            q = L.get("qui", "narrateur")
            if q not in persos:
                err.append(f"{ll} : « {q} » n'est pas dans \"personnages\" (ajoute-le avec sa voix)")
            elif q not in ids and q != "narrateur" and style == "plat2d":
                avert.append(f"{ll} : « {q} » parle mais n'est pas à l'écran (sous-titre centré)")
            if L.get("emotion") and L["emotion"] not in EMOTIONS:
                avert.append(f"{ll} : émotion « {L['emotion']} » inconnue ({', '.join(EMOTIONS)})")
            if L.get("geste") and L["geste"] not in GESTES:
                avert.append(f"{ll} : geste « {L['geste']} » inconnu ({', '.join(GESTES)})")
            if L.get("insert") and L["insert"].get("type") not in INSERTS:
                err.append(f"{ll} : insert « {L['insert'].get('type')} » inconnu ({', '.join(INSERTS)})")
            if L.get("camera") and L["camera"] not in cams:
                avert.append(f"{ll} : caméra « {L['camera']} » inconnue ({', '.join(cams)})")
            for s in (L.get("sfx") if isinstance(L.get("sfx"), list) else [L.get("sfx")] if L.get("sfx") else []):
                n = s if isinstance(s, str) else s.get("nom")
                if n not in SFX:
                    avert.append(f"{ll} : bruitage « {n} » inconnu ({', '.join(SFX)})")
            if len(L.get("texte", "").split()) > 18:
                avert.append(f"{ll} : réplique longue ({len(L['texte'].split())} mots) — vise ≤ 12 pour garder le rythme")
    duree_estimee = total_mots / 2.6
    if not silencieux:
        for a in avert:
            print("   ⚠️ ", a)
        for e in err:
            print("   ❌", e)
        print(f"   ℹ️  ~{total_mots} mots → durée estimée ≈ {duree_estimee:.0f} s")
        print("✅ Projet valide" if not err else f"❌ {len(err)} erreur(s) à corriger")
    return err


# ------------------------------------------------------------------ écriture (API Claude, optionnelle)
def ecrire_avec_claude(idee, fmt, style, duree):
    try:
        import anthropic
    except ImportError:
        return None
    guide = (RACINE / "skill/video-histoire-animee/references/ecriture.md").read_text(encoding="utf-8")
    schema = (RACINE / "skill/video-histoire-animee/references/format_projet.md").read_text(encoding="utf-8")
    systeme = ("Tu es scénariste et réalisateur de courtes vidéos animées virales. Tu écris en français naturel, oral, drôle "
               "ou émouvant, avec une chute. Tu réponds UNIQUEMENT par le JSON du projet, sans texte autour.\n\n" + guide + "\n\n" + schema)
    demande = f"Idée : {idee}\nFormat : {fmt}\nStyle : {style}\nDurée visée : {duree} secondes.\nÉcris le projet.json complet."
    try:
        client = anthropic.Anthropic()
        with client.beta.messages.stream(
            model="claude-opus-5-5", max_tokens=32000, thinking={"type": "adaptive"}, output_config={"effort": "medium"},
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            system=systeme, messages=[{"role": "user", "content": demande}],
        ) as flux:
            msg = flux.get_final_message()
    except Exception as e:
        print(f"   ⚠️  API Claude indisponible ({e.__class__.__name__}: {str(e)[:120]})")
        return None
    if msg.stop_reason == "refusal":
        print("   ⚠️  Demande refusée par le modèle.")
        return None
    texte = "".join(b.text for b in msg.content if b.type == "text")
    m = re.search(r"\{.*\}", texte, re.S)
    return json.loads(m.group(0)) if m else None


def cmd_nouveau(a):
    dossier = RACINE / "projets" / slug(a.idee)
    dossier.mkdir(parents=True, exist_ok=True)
    print(f"✍️  Écriture du scénario pour : {a.idee}")
    projet = ecrire_avec_claude(a.idee, a.format, a.style, a.duree)
    if projet is None:
        modele = "exemples/papy_salle.json" if a.style == "plat2d" else "exemples/baillement.json"
        projet = json.loads((RACINE / modele).read_text(encoding="utf-8"))
        projet["titre"] = a.idee[:60]; projet["format"] = a.format
        (dossier / "IDEE.txt").write_text(a.idee + "\n", encoding="utf-8")
        print("   ℹ️  Pas d'accès à l'API Claude : un projet modèle a été copié.\n"
              "      → Dans Claude Code, utilise le skill « video-histoire-animee » pour l'écrire à partir de l'idée,\n"
              "        ou exporte ANTHROPIC_API_KEY puis relance cette commande.")
    (dossier / "projet.json").write_text(json.dumps(projet, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"📁 {dossier / 'projet.json'}")
    verifier(projet)


# ------------------------------------------------------------------ pipeline
def etape_voix(dossier, projet):
    from moteur.voix import construire_timeline
    build = dossier / "build"; build.mkdir(exist_ok=True)
    print("🎙️  Voix…")
    TL = construire_timeline(projet, build)
    print(f"   ⏱️  Durée totale : {TL['duree']:.1f} s, {len(TL['lignes'])} répliques")
    return TL


def etape_rendu(dossier, apercu=False, workers=None, de=None, a=None):
    cmd = ["node", str(RACINE / "moteur/rendu.js"), str(dossier / "build")]
    if apercu: cmd.append("--apercu")
    if workers: cmd += ["--workers", str(workers)]
    if de is not None: cmd += ["--de", str(de)]
    if a is not None: cmd += ["--a", str(a)]
    subprocess.run(cmd, check=True)


def etape_montage(dossier, apercu=False):
    from moteur.audio import mixer, assembler
    build = dossier / "build"; TL = json.loads((build / "timeline.json").read_text(encoding="utf-8"))
    print("🎵 Musique, bruitages et mixage…")
    mixer(TL, build, TL["projet"].get("musique_fichier") and (dossier / TL["projet"]["musique_fichier"]))
    if apercu:
        src = build / "video_apercu.mp4"; (build / "video.mp4").exists() or None
        sortie = dossier / f"{slug(TL['projet'].get('titre', 'video'))}_apercu.mp4"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-i", str(build / "mix.wav"), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", str(sortie)], check=True)
    else:
        sortie = assembler(build, dossier / f"{slug(TL['projet'].get('titre', 'video'))}.mp4")
    print(f"🎉 Vidéo finale : {sortie}")
    return sortie


def cmd_planche(dossier, video=None):
    video = video or sorted(dossier.glob("*.mp4"), key=lambda p: p.stat().st_mtime)[-1]
    out = dossier / "build" / "planche.jpg"
    d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)], capture_output=True, text=True).stdout)
    fps = 24 / d
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-vf", f"fps={fps:.4f},scale=480:-1,tile=6x4", "-frames:v", "1", str(out)], check=True)
    print(f"🖼️  Planche contact : {out}")


def main():
    ap = argparse.ArgumentParser(description="Studio Histoires — vidéos animées de l'idée au montage final")
    sp = ap.add_subparsers(dest="cmd", required=True)
    n = sp.add_parser("nouveau", help="nouveau projet à partir d'une idée"); n.add_argument("idee"); n.add_argument("--format", default="16:9", choices=["16:9", "9:16"]); n.add_argument("--style", default="plat2d", choices=["plat2d", "cube3d"]); n.add_argument("--duree", type=int, default=60)
    for c in ("verifier", "voix", "rendu", "montage", "tout", "planche"):
        p = sp.add_parser(c); p.add_argument("dossier"); p.add_argument("--apercu", action="store_true"); p.add_argument("--workers", type=int); p.add_argument("--de", type=float); p.add_argument("--a", type=float)
    sp.add_parser("voix-liste", help="voix françaises conseillées")
    i = sp.add_parser("interface", help="interface web locale"); i.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()

    if a.cmd == "nouveau":
        return cmd_nouveau(a)
    if a.cmd == "voix-liste":
        from moteur.voix import VOIX_FR
        for k, v in VOIX_FR.items():
            print(f"  {k:14s} → {v}")
        print("\n  Toute voix edge-tts est utilisable (liste complète : edge-tts --list-voices | grep fr-)")
        return
    if a.cmd == "interface":
        from moteur.interface import lancer
        return lancer(a.port)
    dossier, projet = charger(a.dossier)
    if a.cmd == "verifier":
        return verifier(projet)
    if a.cmd == "planche":
        return cmd_planche(dossier)
    t0 = time.time()
    if a.cmd in ("voix", "tout"):
        if verifier(projet, silencieux=True):
            verifier(projet); sys.exit(1)
        etape_voix(dossier, projet)
    if a.cmd in ("rendu", "tout"):
        etape_rendu(dossier, a.apercu, a.workers, a.de, a.a)
    if a.cmd in ("montage", "tout"):
        sortie = etape_montage(dossier, a.apercu)
        if a.cmd == "tout":
            cmd_planche(dossier, sortie)
    print(f"⏱️  Terminé en {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
