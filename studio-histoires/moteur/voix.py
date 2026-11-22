"""Studio Histoires — génération des voix (edge-tts, repli Piper) et construction du timeline."""
import asyncio, hashlib, json, os, re, subprocess, shutil, sys, wave
from pathlib import Path
import numpy as np

SR = 44100
FPS_DEFAUT = 30

# Voix françaises Microsoft (edge-tts) conseillées par type de personnage
VOIX_FR = {
    "homme_jeune": "fr-FR-RemyMultilingualNeural", "homme": "fr-FR-HenriNeural", "homme_grave": "fr-CA-ThierryNeural",
    "femme": "fr-FR-DeniseNeural", "femme_jeune": "fr-FR-EloiseNeural", "femme_douce": "fr-FR-VivienneMultilingualNeural",
    "enfant": "fr-FR-EloiseNeural", "papy": "fr-FR-HenriNeural", "narrateur": "fr-FR-RemyMultilingualNeural",
    "belge": "fr-BE-GerardNeural", "suisse": "fr-CH-FabriceNeural", "quebec": "fr-CA-AntoineNeural",
}
VOIX_EN = {"homme_jeune": "en-US-AndrewNeural", "homme": "en-US-GuyNeural", "femme": "en-US-AvaNeural", "narrateur": "en-US-AndrewNeural", "enfant": "en-US-AnaNeural"}


def _ffmpeg_decode(src, dst):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ac", "1", "-ar", str(SR), str(dst)], check=True)


def lire_wav(p):
    with wave.open(str(p)) as w:
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        if w.getnchannels() == 2:
            a = a.reshape(-1, 2).mean(1)
    return a


def ecrire_wav(p, a, sr=SR, stereo=False):
    a = np.clip(a, -1, 1)
    with wave.open(str(p), "wb") as w:
        w.setnchannels(2 if stereo else 1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((a * 32767).astype(np.int16).tobytes())


async def _edge(texte, voix, debit, hauteur, mp3):
    import edge_tts
    com = edge_tts.Communicate(texte, voix, rate=debit, pitch=hauteur, boundary="WordBoundary")
    mots, audio = [], bytearray()
    async for c in com.stream():
        if c["type"] == "audio":
            audio += c["data"]
        elif c["type"] == "WordBoundary":
            mots.append({"m": c["text"], "d": c["offset"] / 1e7, "f": (c["offset"] + c["duration"]) / 1e7})
    if not audio:
        raise RuntimeError("audio vide")
    Path(mp3).write_bytes(bytes(audio))
    return mots


def _piper(texte, mp3_wav, voix):
    modele = os.environ.get("STUDIO_PIPER_MODELE") or str(Path.home() / ".cache/studio-histoires/piper/fr_FR-siwis-medium.onnx")
    if not Path(modele).exists():
        Path(modele).parent.mkdir(parents=True, exist_ok=True)
        base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx"
        for ext in ("", ".json"):
            subprocess.run(["curl", "-sL", "-o", modele + ext, base + ext], check=True)
    subprocess.run([sys.executable, "-m", "piper", "-m", modele, "-f", str(mp3_wav)], input=texte.encode(), check=True, capture_output=True)
    return None


def _aligner_mots(texte_affiche, mots_tts, duree):
    """Associe les mots affichés (avec ponctuation) aux temps du TTS ; sinon répartit proportionnellement."""
    affiches = texte_affiche.split()
    if mots_tts and len(mots_tts) >= 1:
        res, j = [], 0
        norm = lambda s: re.sub(r"[^\w%]", "", s.lower())
        for m in affiches:
            if j < len(mots_tts):
                cible = norm(m); d, f = mots_tts[j]["d"], mots_tts[j]["f"]
                # un mot affiché peut couvrir plusieurs mots TTS (ex: "aujourd'hui")
                acc = norm(mots_tts[j]["m"]); j += 1
                while j < len(mots_tts) and len(acc) < len(cible) and cible.startswith(acc):
                    acc += norm(mots_tts[j]["m"]); f = mots_tts[j]["f"]; j += 1
                res.append({"m": m, "d": d, "f": f})
            else:
                last = res[-1]["f"] if res else 0
                res.append({"m": m, "d": last, "f": min(duree, last + 0.2)})
        return res
    poids = [max(2, len(m)) for m in affiches]; tot = sum(poids); t = 0.05; res = []
    for m, p in zip(affiches, poids):
        d = (duree - 0.1) * p / tot; res.append({"m": m, "d": t, "f": t + d}); t += d
    return res


def synthetiser(texte, perso, cache_dir, langue="fr"):
    """Renvoie (audio mono float32 44.1k, mots[{m,d,f}]) pour une réplique."""
    voix = perso.get("voix") or (VOIX_FR if langue == "fr" else VOIX_EN)["narrateur"]
    voix = (VOIX_FR if langue == "fr" else VOIX_EN).get(voix, voix)
    debit, hauteur = perso.get("debit", "+0%"), perso.get("hauteur", "+0Hz")
    texte_tts = texte.replace("*", "").replace("…", "...")
    if not re.search(r"\w", texte_tts):  # silence expressif ("…")
        d = float(perso.get("silence", 0.8))
        return np.zeros(int(d * SR), dtype=np.float32), [{"m": texte, "d": 0.0, "f": d}]
    cle = hashlib.sha1(f"{texte_tts}|{voix}|{debit}|{hauteur}".encode()).hexdigest()[:16]
    cache_dir.mkdir(parents=True, exist_ok=True)
    wav, js = cache_dir / f"{cle}.wav", cache_dir / f"{cle}.json"
    if not (wav.exists() and js.exists()):
        mots = None
        try:
            mp3 = cache_dir / f"{cle}.mp3"
            mots = asyncio.run(_edge(texte_tts, voix, debit, hauteur, mp3))
            _ffmpeg_decode(mp3, wav); mp3.unlink()
        except Exception as e:  # repli hors-ligne
            print(f"   ⚠️  edge-tts indisponible ({e.__class__.__name__}) → voix Piper hors-ligne")
            brut = cache_dir / f"{cle}_brut.wav"; _piper(texte_tts, brut, voix); _ffmpeg_decode(brut, wav); brut.unlink()
        a = lire_wav(wav)
        # coupe les silences de début / fin
        seuil = 0.012; idx = np.where(np.abs(a) > seuil)[0]
        d0 = max(0, idx[0] - int(0.03 * SR)) if len(idx) else 0
        d1 = min(len(a), idx[-1] + int(0.08 * SR)) if len(idx) else len(a)
        a = a[d0:d1]; ecrire_wav(wav, a)
        dec = d0 / SR
        if mots:
            for m in mots:
                m["d"] = max(0, m["d"] - dec); m["f"] = max(m["d"] + 0.05, m["f"] - dec)
        js.write_text(json.dumps({"mots_tts": mots}, ensure_ascii=False))
    a = lire_wav(wav)
    mots_tts = json.loads(js.read_text())["mots_tts"]
    return a, _aligner_mots(texte, mots_tts, len(a) / SR)


def enveloppe(a, fps):
    n = int(np.ceil(len(a) / SR * fps)); hop = SR / fps; env = []
    for i in range(n):
        s = a[int(i * hop):int((i + 1) * hop)]
        env.append(float(np.sqrt(np.mean(s ** 2))) if len(s) else 0.0)
    env = np.array(env); ref = np.percentile(env, 90) if len(env) else 1
    env = np.clip(env / (ref + 1e-6), 0, 1)
    env = np.convolve(env, [0.25, 0.5, 0.25], mode="same")
    return [round(float(x), 3) for x in env]


def construire_timeline(projet, build):
    """Génère toutes les voix puis place chaque réplique dans le temps."""
    fps = projet.get("fps", FPS_DEFAUT)
    W, H = (1080, 1920) if projet.get("format") == "9:16" else (1920, 1080)
    persos = projet.get("personnages", {})
    langue = projet.get("langue", "fr")
    cache = build / "voix"; clips = build / "clips"; clips.mkdir(parents=True, exist_ok=True)
    t = 0.0; scenes, lignes, sfx = [], [], []
    rythme = projet.get("rythme", 1.0)
    nb = sum(len(s.get("lignes", [])) for s in projet["scenes"]); k = 0
    for si, sc in enumerate(projet["scenes"]):
        debut = t
        t += sc.get("intro", 0.35 if si == 0 else 0.12)
        for L in sc.get("lignes", []):
            k += 1
            qui = L.get("qui", "narrateur")
            perso = persos.get(qui) or persos.get("narrateur") or {}
            print(f"   🎙️  [{k}/{nb}] {perso.get('nom', qui)} : {L['texte'][:60]}")
            a, mots = synthetiser(L["texte"], perso, cache, langue)
            duree = len(a) / SR
            clip = clips / f"l{len(lignes):03d}.wav"; ecrire_wav(clip, a)
            t += L.get("avant", 0)
            entree = dict(L); entree.update({
                "scene": si, "debut": round(t, 3), "fin": round(t + duree, 3), "qui": qui,
                "mots": [{"m": m["m"], "d": round(t + m["d"], 3), "f": round(t + m["f"], 3)} for m in mots],
                "env": enveloppe(a, fps), "clip": str(clip.name)})
            lignes.append(entree)
            if L.get("sfx"):
                for s in (L["sfx"] if isinstance(L["sfx"], list) else [L["sfx"]]):
                    nom, dt = (s, 0) if isinstance(s, str) else (s["nom"], s.get("t", 0))
                    sfx.append({"t": round(t + dt, 3), "nom": nom})
            if L.get("insert") and L.get("insert", {}).get("son", True):
                auto = {"notif": "sonnerie", "badge": "pop", "panneau": "whoosh", "ecran": "swipe", "compteur": "pop", "titre": "whoosh", "bulle": "bulle", "icones": "pop"}.get(L["insert"].get("type"))
                if auto and not L.get("sfx"):
                    sfx.append({"t": round(t, 3), "nom": auto})
            pause = L.get("pause")
            if pause is None:
                pause = 0.32 if L["texte"].rstrip().endswith(("?", "!", "…", "...")) else 0.2
            t += duree + pause * rythme
        if not sc.get("lignes"):
            t += sc.get("duree", 3.0)
        t += sc.get("tenue", 0.25)
        if sc.get("duree_min"):
            t = max(t, debut + sc["duree_min"])
        if sc.get("transition") in ("glisse", "fondu", "flash") and si > 0:
            sfx.append({"t": round(debut, 3), "nom": "whoosh"})
        scenes.append({"i": si, "debut": round(debut, 3), "fin": round(t, 3), "transition": sc.get("transition", "coupe"), "musique": sc.get("musique")})
    t += projet.get("fin_noir", 0.6)
    scenes[-1]["fin"] = round(t, 3)
    TL = {"fps": fps, "W": W, "H": H, "duree": round(t, 3), "scenes": scenes, "lignes": lignes, "sfx": sfx, "projet": projet}
    (build / "timeline.json").write_text(json.dumps(TL, ensure_ascii=False))
    return TL
