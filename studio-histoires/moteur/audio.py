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


def reverb(x, duree=1.6, graine=1):
    """Réverbération par convolution (réponse impulsionnelle de bruit à décroissance exponentielle)."""
    r = np.random.default_rng(graine); n = int(duree * SR)
    ir = r.normal(0, 1, n) * np.exp(-np.arange(n) / SR * (6.9 / duree)); ir[: int(0.012 * SR)] *= 0.2
    ir = np.convolve(ir, np.ones(6) / 6, "same"); ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    L = len(x) + n - 1; N = 1 << (L - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[: len(x)]


def basse(f, dur, vol=0.25, carre=False):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.sign(np.sin(2 * np.pi * f * t)) * 0.5 if carre else np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
    if carre:
        s = np.convolve(s, np.ones(40) / 40, "same")
    return vol * s * env_adsr(n, 0.01, dur * 0.8, 0.3, 0.05)


def lead(f, dur, vol=0.12):
    n = int(dur * SR); t = np.arange(n) / SR
    s = 2 * ((f * t + 0.003 * np.sin(2 * np.pi * 5 * t)) % 1) - 1
    s = np.convolve(s, np.ones(18) / 18, "same")
    return vol * s * env_adsr(n, 0.01, dur * 0.6, 0.4, 0.06)


def musique(ambiance, duree):
    """Renvoie une piste stéréo (n, 2) : accords, basse, mélodie, percussions, réverbération."""
    n0 = int(duree * SR)
    if ambiance in (None, "aucune", "silence"):
        return np.zeros((n0, 2))
    tempo, base, prog, style = AMBIANCES.get(ambiance, AMBIANCES["tendre"])
    beat = 60 / tempo; mesure = 4 * beat
    n = int((duree + 3) * SR); sec = np.zeros(n); mel = np.zeros(n); perc = np.zeros(n)
    def add(buf, sig, t0):
        o = int(t0 * SR)
        if o >= n: return
        buf[o:o + len(sig)] += sig[: n - o]
    import zlib; rmel = np.random.default_rng(zlib.crc32(str(ambiance).encode()))
    gamme = [0, 2, 4, 5, 7, 9, 11] if style != "tension" else [0, 2, 3, 5, 7, 8, 10]
    motifs = [[int(rmel.integers(0, 7)) for _ in range(8)] for _ in range(2)]
    rythme_mel = [1, 0, 1, 1, 0, 1, 0, 1] if style in ("pizz", "fete") else [1, 0, 0, 1, 0, 0, 1, 0]
    t, i = 0.0, 0
    while t < duree + 1:
        acc = [base + d for d in prog[i % len(prog)]]
        motif = motifs[(i // 2) % 2]
        if i % 8 >= 2:  # la mélodie entre après 2 mesures
            for k in range(8):
                if not rythme_mel[k]: continue
                deg = motif[k]; note = base + 12 + gamme[deg % 7] + 12 * (deg // 7)
                if k in (0, 4): note = acc[(k // 4) % len(acc)] + 12
                d = beat * (0.45 if style in ("pizz", "fete") else 0.9)
                sig = pluck(NOTE(note + 12), d, 0.12, 0.7) if style == "pizz" else lead(NOTE(note), d, 0.07) if style == "fete" else piano(NOTE(note + 12), d * 2, 0.07)
                if style != "tension": add(mel, sig, t + k * beat / 2)
        if style in ("piano", "tension"):
            add(sec, nappe([NOTE(x - 12) for x in acc], mesure + 0.4, 0.06 if style == "piano" else 0.09), t)
            if style == "tension":
                for k in range(8): add(sec, pluck(NOTE(acc[0] - 12), beat * 0.45, 0.16, 0.3), t + k * beat / 2)
                add(perc, kick(0.25), t); add(perc, kick(0.18), t + 2 * beat)
                add(sec, nappe([NOTE(acc[2] + 12 + (i % 4))], mesure, 0.03), t)
            else:
                for k, idx in enumerate([0, 1, 2, 1, 0, 2, 1, 2]): add(sec, piano(NOTE(acc[idx % len(acc)] + 12), beat * 1.8, 0.11), t + k * beat / 2)
                add(sec, basse(NOTE(acc[0] - 24), mesure * 0.95, 0.16), t)
        elif style == "pizz":
            for k in (0, 3, 4, 6): add(sec, pluck(NOTE(acc[[0, 2, 1, 2, 0, 1, 2, 1][k] % len(acc)] + 12), beat * 0.6, 0.15, 0.6), t + k * beat / 2)
            for k in range(4):
                add(sec, basse(NOTE(acc[0] - 24 + (7 if k % 2 else 0)), beat * 0.45, 0.22, carre=True), t + k * beat)
                add(perc, hat(0.05), t + k * beat + beat / 2)
                if k in (1, 3): add(perc, clap(0.06), t + k * beat)
        elif style == "fete":
            for k in range(4):
                add(perc, kick(0.45), t + k * beat); add(perc, hat(0.07), t + k * beat + beat / 2)
                if k % 2: add(perc, clap(0.12), t + k * beat)
                for sub in range(2): add(sec, basse(NOTE(acc[0] - 24), beat * 0.4, 0.2, carre=True), t + k * beat + sub * beat / 2)
            add(sec, nappe([NOTE(x) for x in acc], mesure, 0.07), t)
        t += mesure; i += 1
    wet = {"piano": 0.35, "tension": 0.45, "pizz": 0.16, "fete": 0.18}[style]
    sec, mel, perc = sec[:n0], mel[:n0], perc[:n0]
    sec, mel, perc = [b * np.minimum(1, np.arange(n0) / (0.02 * SR + 1)) for b in (sec, mel, perc)]
    dry = sec + mel + perc
    gauche = dry + wet * reverb(sec + mel, 1.8, 1); droite = dry + wet * reverb(sec + mel, 1.8, 2)
    # légère largeur stéréo : mélodie un peu à gauche, accords un peu à droite
    gauche += 0.15 * mel - 0.1 * sec; droite += 0.15 * sec - 0.1 * mel
    st = np.stack([gauche, droite], 1)
    return st / (np.max(np.abs(st)) + 1e-6) * 0.5


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


def _ffmpeg_filtre(a, filtre, build, nom):
    src, dst = build / f"{nom}_in.wav", build / f"{nom}_out.wav"
    ecrire_wav(src, a)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-af", filtre, "-ar", str(SR), "-ac", "1", str(dst)], check=True)
    r = lire_wav(dst); src.unlink(); dst.unlink()
    out = np.zeros(len(a)); out[: min(len(a), len(r))] = r[: len(a)]
    return out


def mixer(TL, build, musique_perso=None):
    duree = TL["duree"]; n = int(duree * SR) + SR
    voix = np.zeros(n)
    for L in TL["lignes"]:
        a = lire_wav(build / "clips" / L["clip"]) * float(L.get("volume", 1.0)); o = int(L["debut"] * SR)
        voix[o:o + len(a)] += a[: n - o]
    # traitement voix : coupe-bas, compression douce, présence
    voix = _ffmpeg_filtre(voix, "highpass=f=85,acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=2,equalizer=f=3200:t=q:w=1.2:g=2.5,equalizer=f=250:t=q:w=1:g=-2", build, "voix")
    voix += 0.06 * reverb(voix, 0.5, 3)
    projet = TL["projet"]; mus_cfg = projet.get("musique") if isinstance(projet.get("musique"), dict) else {"ambiance": projet.get("musique", "tendre")}
    amb_def, vol_mus = mus_cfg.get("ambiance", "tendre"), mus_cfg.get("volume", 0.22)
    mus = np.zeros((n, 2))
    if musique_perso and Path(musique_perso).exists():
        tmp = build / "musique_perso.wav"; subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-stream_loop", "-1", "-i", str(musique_perso), "-t", str(duree + 1), "-ac", "2", "-ar", str(SR), str(tmp)], check=True)
        import wave as _w
        with _w.open(str(tmp)) as w: m = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32).reshape(-1, 2) / 32768
        mus[: len(m)] = m[:n] * 0.6
    else:
        plages = []
        for sc in TL["scenes"]:
            amb = sc.get("musique") or amb_def
            if plages and plages[-1][0] == amb: plages[-1][2] = sc["fin"]
            else: plages.append([amb, sc["debut"], sc["fin"]])
        for amb, d, f in plages:
            m = musique(amb, f - d + 0.5); o = int(d * SR)
            fondu = int(0.35 * SR); m[:fondu] *= np.linspace(0, 1, fondu)[:, None]; m[-fondu:] *= np.linspace(1, 0, fondu)[:, None]
            mus[o:o + len(m)] += m[: n - o]
    # ducking : la musique baisse quand quelqu'un parle (attaque rapide, relâche lente)
    env = np.abs(voix); k = int(0.2 * SR); env = np.convolve(env, np.ones(k) / k, "same")
    ref = np.percentile(env[env > 1e-4], 60) if np.any(env > 1e-4) else 1
    duck = 1 - 0.65 * np.clip(env / (ref + 1e-6), 0, 1)
    duck = np.convolve(duck, np.ones(int(0.15 * SR)) / int(0.15 * SR), "same")
    mus *= (duck * vol_mus / 0.22 * 0.6)[:, None]
    fx = np.zeros((n, 2)); rfx = np.random.default_rng(5)
    for s_ in TL["sfx"]:
        a = sfx(s_["nom"]) * 0.75; o = int(s_["t"] * SR); pan = rfx.uniform(-0.35, 0.35)
        if o < n:
            seg = a[: n - o]; fx[o:o + len(seg), 0] += seg * (1 - pan); fx[o:o + len(seg), 1] += seg * (1 + pan)
    mix = voix[:, None] + mus + fx * 0.7
    fin = int(0.6 * SR); mix[-fin:] *= np.linspace(1, 0, fin)[:, None]
    mix = np.tanh(mix / (np.max(np.abs(mix)) + 1e-6) * 1.1) * 0.89  # limiteur doux
    ecrire_wav(build / "mix.wav", mix[: int(duree * SR)].reshape(-1), stereo=True)
    return build / "mix.wav"


def assembler(build, sortie, video="video.mp4"):
    """Vidéo + mix → MP4 final, normalisation EBU R128 en deux passes (−14 LUFS, −1,5 dBTP)."""
    import json as _j, re as _re
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(build / "mix.wav"), "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], capture_output=True, text=True)
    m = _j.loads(_re.search(r"\{[^{}]*\}", r.stderr[r.stderr.rfind("[Parsed_loudnorm"):], _re.S).group(0))
    filtre = (f"loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
              f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(build / video), "-i", str(build / "mix.wav"),
                    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", filtre, "-ar", "48000",
                    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(sortie)], check=True)
    return sortie
