"""Studio Histoires — musique générée, bruitages synthétisés et mixage (ducking + normalisation)."""
import subprocess
from pathlib import Path
import numpy as np
from .voix import SR, lire_wav, ecrire_wav

rng = np.random.default_rng(7)
NOTE = lambda n: 440.0 * 2 ** ((n - 69) / 12)


def env_adsr(n, a=0.005, d=0.1, s=0.0, r=0.05):
    t = np.arange(n) / SR; e = np.ones(n)
    e[t < a] = t[t < a] / a
    m = t >= a; e[m] = s + (1 - s) * np.exp(-(t[m] - a) / max(d, 1e-3))
    rel = int(r * SR)
    if rel and n > rel:
        e[-rel:] *= np.linspace(1, 0, rel)
    return e


def piano(f, dur, vol=0.3):
    n = int(dur * SR); t = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * f * k * t) / k ** 1.6 for k in range(1, 6))
    return vol * s * env_adsr(n, 0.004, 0.55, 0.0, 0.1)


def pluck(f, dur, vol=0.3, brillance=0.5):
    """Karplus-Strong (pizzicato / ukulélé)."""
    n = int(dur * SR); p = max(2, int(SR / f)); buf = rng.uniform(-1, 1, p); out = np.zeros(n)
    for i in range(n):
        out[i] = buf[i % p]
        buf[i % p] = 0.996 * (brillance * buf[i % p] + (1 - brillance) * buf[(i + 1) % p])
    return vol * out * env_adsr(n, 0.001, 0.4, 0, 0.05)


def nappe(freqs, dur, vol=0.08):
    n = int(dur * SR); t = np.arange(n) / SR; s = np.zeros(n)
    for f in freqs:
        for det in (-0.6, 0.6):
            s += np.sin(2 * np.pi * (f + det) * t) + 0.3 * np.sin(4 * np.pi * (f + det) * t)
    e = np.minimum(1, t / 0.6) * np.minimum(1, (dur - t) / 0.6)
    return vol * s / (2 * len(freqs)) * e


def kick(vol=0.5):
    n = int(0.25 * SR); t = np.arange(n) / SR; f = 50 + 90 * np.exp(-t * 30)
    return vol * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 12)


def hat(vol=0.08):
    n = int(0.05 * SR); x = rng.uniform(-1, 1, n); x = np.diff(np.concatenate([[0], x]))
    return vol * x * np.exp(-np.arange(n) / SR * 80)


def clap(vol=0.2):
    n = int(0.15 * SR); x = rng.uniform(-1, 1, n); e = np.exp(-np.arange(n) / SR * 30)
    return vol * x * e


AMBIANCES = {
    # (tempo, gamme_base, progression en degrés, style)
    "tendre": (78, 60, [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], "piano"),
    "comique": (118, 62, [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]], "pizz"),
    "tension": (92, 57, [[0, 3, 7], [0, 3, 7], [8, 12, 15], [7, 10, 14]], "tension"),
    "fete": (124, 57, [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], "fete"),
    "triste": (66, 57, [[0, 3, 7], [8, 12, 15], [5, 8, 12], [7, 10, 14]], "piano"),
    "aventure": (104, 60, [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]], "pizz"),
    "lofi": (84, 58, [[0, 4, 7, 11], [9, 12, 16, 19], [2, 5, 9, 12], [7, 11, 14, 17]], "piano"),
}


def musique(ambiance, duree):
    if ambiance in (None, "aucune", "silence"):
        return np.zeros(int(duree * SR))
    tempo, base, prog, style = AMBIANCES.get(ambiance, AMBIANCES["tendre"])
    beat = 60 / tempo; mesure = 4 * beat
    n = int((duree + 2) * SR); out = np.zeros(n)
    add = lambda sig, t0: out.__setitem__(slice(int(t0 * SR), int(t0 * SR) + len(sig)), out[int(t0 * SR):int(t0 * SR) + len(sig)] + sig[: max(0, n - int(t0 * SR))])
    t, i = 0.0, 0
    while t < duree + 1:
        acc = [base + d for d in prog[i % len(prog)]]
        if style in ("piano", "tension"):
            add(nappe([NOTE(x - 12) for x in acc], mesure + 0.4, 0.06 if style == "piano" else 0.09), t)
            motif = [0, 1, 2, 1, 0, 2, 1, 2] if style == "piano" else [0, 0, 0, 0]
            for k, idx in enumerate(motif):
                if style == "tension":
                    add(pluck(NOTE(acc[0] - 12), beat, 0.18, 0.3), t + k * beat)
                else:
                    add(piano(NOTE(acc[idx % len(acc)] + 12), beat * 1.8, 0.13), t + k * beat / 2)
            add(piano(NOTE(acc[0] - 24), mesure, 0.12), t)
        elif style == "pizz":
            for k in range(8):
                note = acc[[0, 2, 1, 2, 0, 1, 2, 1][k] % len(acc)] + 12
                if k in (0, 3, 4, 6):
                    add(pluck(NOTE(note), beat * 0.6, 0.2, 0.6), t + k * beat / 2)
            for k in range(4):
                add(pluck(NOTE(acc[0] - 12 + (7 if k % 2 else 0)), beat * 0.5, 0.22, 0.4), t + k * beat)
                add(hat(0.05), t + k * beat + beat / 2)
        elif style == "fete":
            for k in range(4):
                add(kick(0.45), t + k * beat); add(hat(0.07), t + k * beat + beat / 2)
                if k % 2:
                    add(clap(0.12), t + k * beat)
                for sub in range(2):
                    add(pluck(NOTE(acc[0] - 12), beat * 0.4, 0.2, 0.3), t + k * beat + sub * beat / 2)
            add(nappe([NOTE(x) for x in acc], mesure, 0.07), t)
        t += mesure; i += 1
    out = out[: int(duree * SR)]
    pk = np.max(np.abs(out)) + 1e-6
    return out / pk * 0.5


# ----------------- Bruitages -----------------
def _t(d):
    return np.arange(int(d * SR)) / SR


def sfx(nom):
    if nom == "pop":
        t = _t(0.12); return 0.5 * np.sin(2 * np.pi * np.cumsum(900 * np.exp(-t * 25) + 200) / SR) * np.exp(-t * 30)
    if nom == "bulle":
        t = _t(0.1); return 0.35 * np.sin(2 * np.pi * np.cumsum(300 + 1500 * t / 0.1) / SR) * np.exp(-t * 25)
    if nom == "whoosh":
        t = _t(0.45); x = rng.normal(0, 1, len(t)); y = np.convolve(x, np.ones(30) / 30, "same")
        return 0.6 * y * np.sin(np.pi * t / 0.45) ** 2
    if nom == "swipe":
        t = _t(0.18); x = rng.normal(0, 1, len(t)); y = x - np.convolve(x, np.ones(8) / 8, "same")
        return 0.25 * y * np.sin(np.pi * t / 0.18)
    if nom in ("ding", "notif"):
        t = _t(0.7); s = np.sin(2 * np.pi * 1320 * t) + 0.5 * np.sin(2 * np.pi * 2640 * t)
        s2 = np.zeros_like(s); o = int(0.12 * SR); s2[o:] = (np.sin(2 * np.pi * 1760 * t) + 0.4 * np.sin(2 * np.pi * 3520 * t))[: len(t) - o]
        return 0.22 * (s * np.exp(-t * 6) + (s2 * np.exp(-t * 6) if nom == "notif" else 0))
    if nom == "sonnerie":
        t = _t(1.2); g = ((t % 0.3) < 0.15).astype(float)
        return 0.18 * g * (np.sin(2 * np.pi * 880 * t) + np.sin(2 * np.pi * 1100 * t)) * np.exp(-t * 0.5)
    if nom == "vibreur":
        t = _t(0.9); return 0.3 * np.sign(np.sin(2 * np.pi * 150 * t)) * ((t % 0.3) < 0.2) * 0.5
    if nom == "boing":
        t = _t(0.5); f = 220 + 120 * np.sin(2 * np.pi * 12 * t) * np.exp(-t * 4)
        return 0.4 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5)
    if nom == "clic":
        t = _t(0.03); return 0.4 * rng.uniform(-1, 1, len(t)) * np.exp(-t * 200)
    if nom == "tada":
        out = np.zeros(int(1.0 * SR))
        for k, n in enumerate([72, 76, 79, 84]):
            p = piano(NOTE(n), 0.9 - k * 0.08, 0.25); o = int(k * 0.08 * SR); out[o:o + len(p)] += p[: len(out) - o]
        return out
    if nom == "triste":
        out = np.zeros(int(1.4 * SR))
        for k, n in enumerate([67, 66, 65, 64]):
            p = piano(NOTE(n - 12), 0.6, 0.25); o = int(k * 0.3 * SR); out[o:o + len(p)] += p[: len(out) - o]
        return out
    if nom == "applaudissements":
        out = np.zeros(int(2.5 * SR))
        for _ in range(260):
            c = clap(0.06); o = int(rng.uniform(0, 2.3) * SR); out[o:o + len(c)] += c[: len(out) - o]
        return out * np.minimum(1, np.linspace(3, 0, len(out)))
    if nom == "coupure":  # électricité qui saute
        t = _t(0.8); return 0.4 * np.sin(2 * np.pi * np.cumsum(120 * np.exp(-t * 3) + 30) / SR) * np.exp(-t * 3)
    if nom == "electricite":
        t = _t(0.6); return 0.25 * rng.uniform(-1, 1, len(t)) * (rng.uniform(0, 1, len(t)) > 0.7) * np.exp(-t * 3)
    if nom == "bebe":
        t = _t(1.0); f = 500 + 150 * np.sin(2 * np.pi * 3 * t)
        return 0.15 * np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * np.sin(np.pi * t) * 0.5
    if nom == "porte":
        t = _t(0.4); return 0.4 * np.sin(2 * np.pi * 70 * t) * np.exp(-t * 15) + 0.1 * rng.normal(0, 1, len(t)) * np.exp(-t * 30)
    if nom == "pas":
        out = np.zeros(int(1.2 * SR))
        for k in range(4):
            c = 0.3 * rng.normal(0, 1, 1200) * np.exp(-np.arange(1200) / 150); o = int(k * 0.3 * SR); out[o:o + 1200] += c
        return np.convolve(out, np.ones(20) / 20, "same")
    if nom == "bus":
        t = _t(2.0); return 0.15 * np.convolve(rng.normal(0, 1, len(t)), np.ones(200) / 200, "same") * 8 * np.sin(np.pi * t / 2)
    return np.zeros(10)


def mixer(TL, build, musique_perso=None):
    duree = TL["duree"]; n = int(duree * SR) + SR
    voix = np.zeros(n)
    for L in TL["lignes"]:
        a = lire_wav(build / "clips" / L["clip"]) * float(L.get("volume", 1.0)); o = int(L["debut"] * SR)
        voix[o:o + len(a)] += a[: n - o]
    # musique par plages d'ambiance identique
    projet = TL["projet"]; amb_def = (projet.get("musique") or {}).get("ambiance", "tendre") if isinstance(projet.get("musique"), dict) else projet.get("musique", "tendre")
    vol_mus = (projet.get("musique") or {}).get("volume", 0.22) if isinstance(projet.get("musique"), dict) else 0.22
    mus = np.zeros(n)
    if musique_perso and Path(musique_perso).exists():
        tmp = build / "musique_perso.wav"; subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-stream_loop", "-1", "-i", str(musique_perso), "-t", str(duree + 1), "-ac", "1", "-ar", str(SR), str(tmp)], check=True)
        m = lire_wav(tmp); mus[: len(m)] = m[:n] * 0.6
    else:
        plages = []
        for sc in TL["scenes"]:
            amb = sc.get("musique") or amb_def
            if plages and plages[-1][0] == amb:
                plages[-1][2] = sc["fin"]
            else:
                plages.append([amb, sc["debut"], sc["fin"]])
        for amb, d, f in plages:
            m = musique(amb, f - d + 0.5); o = int(d * SR)
            fondu = int(0.3 * SR); m[:fondu] *= np.linspace(0, 1, fondu); m[-fondu:] *= np.linspace(1, 0, fondu)
            mus[o:o + len(m)] += m[: n - o]
    # ducking : la musique baisse quand quelqu'un parle
    env = np.abs(voix); k = int(0.25 * SR); env = np.convolve(env, np.ones(k) / k, "same")
    duck = 1 - 0.6 * np.clip(env / (np.percentile(env[env > 0], 60) + 1e-6 if np.any(env > 0) else 1), 0, 1)
    mus *= duck * vol_mus / 0.22 * 0.55
    fx = np.zeros(n)
    for s in TL["sfx"]:
        a = sfx(s["nom"]) * 0.8; o = int(s["t"] * SR)
        if o < n:
            fx[o:o + len(a)] += a[: n - o]
    mix = voix + mus + fx * 0.7
    fin = int(0.6 * SR); mix[-fin:] *= np.linspace(1, 0, fin)
    mix = mix / (np.max(np.abs(mix)) + 1e-6) * 0.89
    ecrire_wav(build / "mix.wav", mix[: int(duree * SR)])
    return build / "mix.wav"


def assembler(build, sortie):
    """Vidéo + mix → MP4 final normalisé à -14 LUFS (standard réseaux sociaux)."""
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(build / "video.mp4"), "-i", str(build / "mix.wav"),
                    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000",
                    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(sortie)], check=True)
    return sortie
