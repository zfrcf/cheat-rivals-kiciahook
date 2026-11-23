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
import numpy as np
from pathlib import Path

RACINE = Path(__file__).resolve().parent
sys.path.insert(0, str(RACINE))

DECORS_2D = ["bus", "rue", "cuisine", "chambre", "buanderie", "salon", "parc", "cimetiere", "salle_sport", "bureau", "ville_nuit", "porte", "immeuble", "couleur", "ecole", "hopital", "supermarche", "plage", "restaurant"]
DECORS_3D = ["ville", "chambre", "place_nuit", "pelouse", "salle", "salle_sport", "plage", "classe", "couleur"]
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
        modele = "exemples/blagues_papa.json" if a.style == "plat2d" else "exemples/baillement.json"
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


def _node(dossier, *extra):
    subprocess.run(["node", str(RACINE / "moteur/rendu.js"), str(dossier / "build"), *[str(x) for x in extra]], check=True)


def etape_rendu(dossier, apercu=False, workers=None, de=None, a=None, fmt=None, rapide=False):
    extra = []
    if apercu: extra.append("--apercu")
    if rapide: extra.append("--rapide")
    if workers: extra += ["--workers", workers]
    if de is not None: extra += ["--de", de]
    if a is not None: extra += ["--a", a]
    if fmt: extra += ["--format", fmt]
    _node(dossier, *extra)


def suffixe(fmt):
    return "_" + fmt.replace(":", "x") if fmt else ""


def ecrire_srt(TL, chemin):
    """Sous-titres SRT (blocs de 6 mots max, coupés à la ponctuation)."""
    def ts(x):
        h, m = int(x // 3600), int(x % 3600 // 60); s_ = x % 60
        return f"{h:02d}:{m:02d}:{int(s_):02d},{int((s_ % 1) * 1000):03d}"
    blocs, i = [], 1
    for L in TL["lignes"]:
        phrases, cur = [], []
        for m in L["mots"]:
            cur.append(m)
            if re.search(r"[.!?…:;,]$", m["m"]): phrases.append(cur); cur = []
        if cur: phrases.append(cur)
        morceaux = []
        for ph in phrases:  # découpe équilibrée des phrases longues
            k = max(1, -(-len(ph) // 7)); taille = -(-len(ph) // k)
            morceaux += [ph[j:j + taille] for j in range(0, len(ph), taille)]
        fusion = []
        for mc in morceaux:  # évite les blocs d'un seul mot
            if fusion and (len(mc) <= 1 or len(fusion[-1]) <= 1) and len(fusion[-1]) + len(mc) <= 8: fusion[-1] = fusion[-1] + mc
            else: fusion.append(mc)
        for cur in fusion:
            if re.search(r"\w", " ".join(x["m"] for x in cur)):
                blocs.append(f"{i}\n{ts(cur[0]['d'])} --> {ts(max(cur[-1]['f'], cur[0]['d'] + 0.4))}\n{' '.join(x['m'].replace('*', '') for x in cur)}\n"); i += 1
    chemin.write_text("\n".join(blocs), encoding="utf-8")


def moment_fort(TL):
    """Choisit l'image de la miniature : réplique la plus expressive dans le premier tiers."""
    meilleur, score_max = TL["lignes"][0], -1
    for L in TL["lignes"]:
        sc = 0
        sc += 3 if L.get("emotion") in ("choque", "surpris", "rire", "joie", "fache") else 0
        sc += 2 if L.get("insert", {}).get("type") in ("badge", "ecran", "compteur", "panneau", "notif") else 0
        sc += 1 if L.get("symbole") else 0
        sc -= 2 * (L["debut"] / max(1, TL["duree"]))
        if sc > score_max: meilleur, score_max = L, sc
    return (meilleur["debut"] + meilleur["fin"]) / 2


def etape_montage(dossier, apercu=False, formats=(None,)):
    from moteur.audio import mixer, assembler
    build = dossier / "build"; TL = json.loads((build / "timeline.json").read_text(encoding="utf-8"))
    print("🎵 Musique, bruitages et mixage…")
    mixer(TL, build, TL["projet"].get("musique_fichier") and (dossier / TL["projet"]["musique_fichier"]))
    nom = slug(TL["projet"].get("titre", "video")); sorties = []
    for fmt in formats:
        sf = suffixe(fmt) if fmt and fmt != TL["projet"].get("format") else ""
        if apercu:
            sortie = dossier / f"{nom}{sf}_apercu.mp4"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(build / f"video_apercu{suffixe(fmt)}.mp4"), "-i", str(build / "mix.wav"), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", str(sortie)], check=True)
        else:
            sortie = assembler(build, dossier / f"{nom}{sf}.mp4", f"video{suffixe(fmt)}.mp4")
        sorties.append(sortie); print(f"🎉 Vidéo : {sortie}")
    ecrire_srt(TL, dossier / f"{nom}.srt"); print(f"💬 Sous-titres : {dossier / (nom + '.srt')}")
    return sorties


def etape_miniature(dossier, formats=(None,)):
    TL = json.loads((dossier / "build/timeline.json").read_text(encoding="utf-8")); t = moment_fort(TL)
    for fmt in formats:
        extra = ["--miniature", round(t, 2)] + (["--format", fmt] if fmt else [])
        _node(dossier, *extra)
        src = dossier / "build" / f"miniature{suffixe(fmt)}.jpg"
        if src.exists():
            dst = dossier / f"miniature{suffixe(fmt) if fmt and fmt != TL['projet'].get('format') else ''}.jpg"; src.replace(dst); print(f"🖼️  Miniature : {dst}")


def cmd_planche(dossier, video=None):
    video = video or sorted(dossier.glob("*.mp4"), key=lambda p: p.stat().st_mtime)[-1]
    out = dossier / "build" / "planche.jpg"
    d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)], capture_output=True, text=True).stdout)
    fps = 24 / d
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-vf", f"fps={fps:.4f},scale=480:-1,tile=6x4", "-frames:v", "1", str(out)], check=True)
    print(f"🖼️  Planche contact : {out}")


def cmd_controle(dossier, projet):
    """Contrôle qualité : note sur 100 + recommandations + instantanés (avant le rendu complet)."""
    build = dossier / "build"
    if not (build / "timeline.json").exists():
        etape_voix(dossier, projet)
    TL = json.loads((build / "timeline.json").read_text(encoding="utf-8")); P = TL["projet"]; Ls = TL["lignes"]
    pts, notes = 100, []
    def malus(n, msg):
        nonlocal pts; pts -= n; notes.append(f"- (−{n}) {msg}")
    d = TL["duree"]
    if d > 75: malus(10, f"Durée {d:.0f} s : au-delà de 75 s la rétention chute. Coupe les répliques les moins utiles.")
    if d < 20: malus(5, f"Durée {d:.0f} s : trop court pour installer une histoire et une chute.")
    if Ls and Ls[0]["debut"] > 0.8: malus(5, f"La première parole arrive à {Ls[0]['debut']:.1f} s : l'accroche doit tomber avant 0,8 s.")
    if Ls and len(Ls[0]["texte"].split()) > 11: malus(6, "Accroche trop longue (> 11 mots) : vise une phrase choc courte.")
    longues = [L for L in Ls if L["fin"] - L["debut"] > 4.5]
    if longues: malus(min(12, 3 * len(longues)), f"{len(longues)} réplique(s) de plus de 4,5 s (ex. « {longues[0]['texte'][:50]} ») : découpe-les.")
    trous = [(a["fin"], b["debut"]) for a, b in zip(Ls, Ls[1:]) if b["debut"] - a["fin"] > 1.2 and a["scene"] == b["scene"]]
    if trous: malus(4, f"{len(trous)} silence(s) de plus de 1,2 s dans une même scène (à {trous[0][0]:.1f} s).")
    sans_visuel = [L for L in Ls if not any(L.get(k) for k in ("insert", "symbole", "geste", "camera", "reactions", "bouge", "anim"))]
    ratio = len(sans_visuel) / max(1, len(Ls))
    if ratio > 0.5: malus(10, f"{ratio:.0%} des répliques n'ont aucun événement visuel (insert, symbole, geste, caméra, réaction).")
    sans_emo = [L for L in Ls if not L.get("emotion")]
    if len(sans_emo) / max(1, len(Ls)) > 0.5: malus(6, "Plus de la moitié des répliques n'ont pas d'émotion : les visages restent neutres.")
    sans_cle = [L for L in Ls if not L.get("cles") and len(L["texte"].split()) > 3]
    if len(sans_cle) / max(1, len(Ls)) > 0.6: malus(5, "Peu de mots-clés surlignés (`cles`) : les sous-titres manquent de relief.")
    fenetre, monotone = 8.0, 0
    for t0 in np.arange(0, max(0, d - fenetre), 2.0):
        ev = [L for L in Ls if t0 <= L["debut"] < t0 + fenetre and (L.get("insert") or L.get("symbole") or L.get("camera") or L.get("sfx"))]
        sc = {L["scene"] for L in Ls if t0 <= L["debut"] < t0 + fenetre}
        if not ev and len(sc) <= 1: monotone += 1
    if monotone: malus(min(10, 2 * monotone), f"{monotone} fenêtre(s) de 8 s sans aucun changement fort (insert, symbole, coupe, bruitage).")
    if len(TL["scenes"]) < 2: malus(6, "Une seule scène : ajoute un flashback ou un changement de lieu.")
    if len({sc.get("musique") for sc in TL["scenes"]}) < 2 and len(TL["scenes"]) > 2: malus(3, "Une seule ambiance musicale : fais évoluer la musique avec l'émotion (ex. comique → tendre).")
    if P.get("style") == "plat2d":
        for L in Ls:
            ids = [x["id"] for x in P["scenes"][L["scene"]].get("acteurs", [])]
            if L["qui"] not in ids and L["qui"] != "narrateur" and (P.get("sous_titres") or "bulle") == "bulle":
                malus(2, f"« {L['texte'][:40]} » : {L['qui']} parle hors champ (voix off) — volontaire ?"); break
    dernier = Ls[-1]["texte"] if Ls else ""
    if Ls and not any(L.get("emotion") in ("rire", "triste", "choque", "surpris", "joie", "content") for L in Ls[-4:]): malus(5, "Fin sans pic émotionnel : la chute doit se voir sur les visages.")
    pts = max(0, pts)
    verdict = "🟢 prêt à rendre" if pts >= 85 else "🟡 améliorable" if pts >= 70 else "🔴 à retravailler"
    rapport = [f"# Contrôle qualité — {P.get('titre', '')}", "", f"**Note : {pts}/100 — {verdict}**", "",
               f"Durée {d:.1f} s · {len(Ls)} répliques · {len(TL['scenes'])} scènes · rythme {sum(len(L['texte'].split()) for L in Ls) / max(1, d) * 60:.0f} mots/min", "",
               "## Points à corriger" if notes else "## Rien à signaler", *notes, "",
               "Instantanés : `build/planche_instantanes.jpg` (1 image par réplique) — vérifier cadrage, chevauchements, émotions."]
    (build / "rapport.md").write_text("\n".join(rapport), encoding="utf-8")
    print("\n".join(rapport))
    _node(dossier, "--instantanes", "auto")
    subprocess.run(["bash", "-c", f"cd '{build}/instantanes' && ffmpeg -v error -y -pattern_type glob -i '*.jpg' -vf 'scale=420:-1,tile=5x6' -frames:v 1 ../planche_instantanes.jpg"], check=False)
    return pts


def main():
    ap = argparse.ArgumentParser(description="Studio Histoires — vidéos animées de l'idée au montage final")
    sp = ap.add_subparsers(dest="cmd", required=True)
    n = sp.add_parser("nouveau", help="nouveau projet à partir d'une idée"); n.add_argument("idee"); n.add_argument("--format", default="16:9", choices=["16:9", "9:16"]); n.add_argument("--style", default="plat2d", choices=["plat2d", "cube3d"]); n.add_argument("--duree", type=int, default=60)
    for c in ("verifier", "voix", "rendu", "montage", "tout", "planche", "controle", "miniature"):
        p = sp.add_parser(c); p.add_argument("dossier"); p.add_argument("--apercu", action="store_true"); p.add_argument("--rapide", action="store_true", help="3D sans ombres (2 à 3x plus rapide)")
        p.add_argument("--workers", type=int); p.add_argument("--de", type=float); p.add_argument("--a", type=float)
        p.add_argument("--formats", default="", help="ex. 16:9,9:16 pour décliner la vidéo dans plusieurs formats")
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
    formats = [f.strip() for f in a.formats.split(",") if f.strip()] or [None]
    formats = [None if f == projet.get("format") else f for f in formats]
    if a.cmd == "verifier":
        return verifier(projet)
    if a.cmd == "planche":
        return cmd_planche(dossier)
    if a.cmd == "controle":
        if verifier(projet, silencieux=True): verifier(projet); sys.exit(1)
        return cmd_controle(dossier, projet)
    if a.cmd == "miniature":
        return etape_miniature(dossier, formats)
    t0 = time.time()
    if a.cmd in ("voix", "tout"):
        if verifier(projet, silencieux=True):
            verifier(projet); sys.exit(1)
        etape_voix(dossier, projet)
    if a.cmd in ("rendu", "tout"):
        for f in formats:
            etape_rendu(dossier, a.apercu, a.workers, a.de, a.a, f, a.rapide)
    if a.cmd in ("montage", "tout"):
        sorties = etape_montage(dossier, a.apercu, formats)
        if a.cmd == "tout":
            cmd_planche(dossier, sorties[0])
            if not a.apercu: etape_miniature(dossier, formats)
    print(f"⏱️  Terminé en {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
