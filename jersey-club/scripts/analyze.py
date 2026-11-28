#!/usr/bin/env python3
"""Analyse musicale : BPM, beats, downbeats, tonalité, accords, structure, hook, profil.

Deux niveaux :
- `analyze_tempo` travaille sur l'audio d'origine (beats exacts pour le time-map) ;
- `analyze_bars` travaille sur l'audio déjà recalé sur la grille cible (une mesure =
  48 ticks), ce qui rend accords, segments et hook directement exploitables.

CLI : analyze.py <fichier> [--bpm-source N]  → JSON sur stdout.
"""
from __future__ import annotations

import argparse
import json
import sys

import librosa
import numpy as np

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from jc_common import SR, Grid, decode, log, mono  # noqa: E402

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# Profils de Krumhansl-Kessler
KK_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
HOP = 256


# ------------------------------------------------------------------------- tempo
def analyze_tempo(y: np.ndarray, sr: int = SR, bpm_hint: float | None = None) -> dict:
    """Estime BPM, positions de beats et premier downbeat.

    Le BPM est affiné par régression linéaire sur les beats indexés (robuste aux beats
    sautés), puis la phase est recalée sur les onsets réels. Si la piste est stable
    (résidu < 15 ms), la grille régressée remplace les beats du tracker.
    """
    ym = mono(y)
    dur = len(ym) / sr
    oenv = librosa.onset.onset_strength(y=ym, sr=sr, hop_length=HOP, aggregate=np.median)
    kw = dict(onset_envelope=oenv, sr=sr, hop_length=HOP, units="time")
    if bpm_hint:
        tempo, beats = librosa.beat.beat_track(bpm=float(bpm_hint), tightness=400, **kw)
    else:
        tempo, beats = librosa.beat.beat_track(start_bpm=120, tightness=100, **kw)
    beats = np.asarray(beats, dtype=float)
    if len(beats) < 8:
        raise RuntimeError("BPM introuvable (trop peu de beats détectés) : utilisez --bpm-source N")

    med = np.median(np.diff(beats))
    idx = np.round((beats - beats[0]) / med).astype(int)
    _, keep = np.unique(idx, return_index=True)
    idx, beats = idx[keep], beats[keep]
    slope, icpt = np.polyfit(idx, beats, 1)
    resid = beats - (slope * idx + icpt)
    # rejet des aberrants puis seconde passe
    ok = np.abs(resid) < max(0.03, 3 * np.std(resid))
    if ok.sum() >= 8:
        slope, icpt = np.polyfit(idx[ok], beats[ok], 1)
        resid = beats - (slope * idx + icpt)
    steady = float(np.std(resid[ok] if ok.sum() >= 8 else resid)) < 0.015

    # Recalage de phase sur les onsets (précision < hop)
    onsets = librosa.onset.onset_detect(y=ym, sr=sr, hop_length=64, units="time", backtrack=False)
    grid = slope * np.arange(idx.min(), idx.max() + 1) + icpt
    if len(onsets):
        near = np.array([onsets[np.argmin(np.abs(onsets - g))] - g for g in grid])
        near = near[np.abs(near) < 0.03]
        if len(near) > len(grid) * 0.3:
            icpt += float(np.median(near))

    if steady:
        k0 = int(np.ceil(-icpt / slope))
        k1 = int(np.floor((dur - icpt) / slope))
        beat_times = slope * np.arange(k0, k1 + 1) + icpt
    else:
        full = np.arange(idx.min(), idx.max() + 1)
        beat_times = np.interp(full, idx, beats)
    beat_times = beat_times[(beat_times >= 0) & (beat_times < dur)]
    bpm = 60.0 / slope

    phase = _downbeat_phase(ym, sr, beat_times)
    return {
        "bpm": float(bpm),
        "bpm_librosa": float(np.atleast_1d(tempo)[0]),
        "stable": bool(steady),
        "residu_ms": float(np.std(resid) * 1000),
        "beats": beat_times.tolist(),
        "downbeat_phase": int(phase),
        "premier_downbeat": float(beat_times[phase]) if len(beat_times) > phase else 0.0,
        "duree": float(dur),
    }


def _downbeat_phase(ym, sr, beats) -> int:
    """Choisit la phase (0-3) du premier temps : énergie de grave + changement d'harmonie."""
    if len(beats) < 8:
        return 0
    low = librosa.onset.onset_strength(y=ym, sr=sr, hop_length=HOP, fmax=200, n_mels=16)
    full = librosa.onset.onset_strength(y=ym, sr=sr, hop_length=HOP)
    fr = librosa.time_to_frames(beats, sr=sr, hop_length=HOP)
    fr = np.clip(fr, 0, len(low) - 1)
    lowv = np.array([low[max(f - 2, 0):f + 3].max() for f in fr])
    fullv = np.array([full[max(f - 2, 0):f + 3].max() for f in fr])
    fullv = fullv / (fullv.max() + 1e-9)
    chroma = librosa.feature.chroma_stft(y=ym, sr=sr, hop_length=2048)
    cb = librosa.util.sync(chroma, np.clip(librosa.time_to_frames(beats, sr=sr, hop_length=2048), 0, chroma.shape[1] - 1))
    nov = np.r_[0, np.linalg.norm(np.diff(cb, axis=1), axis=0)][: len(beats)]
    nov = np.pad(nov, (0, len(beats) - len(nov)))
    lowv = lowv / (lowv.max() + 1e-9)
    nov = nov / (nov.max() + 1e-9)
    scores = [lowv[p::4].mean() + 0.7 * nov[p::4].mean() + 0.3 * fullv[p::4].mean() for p in range(4)]
    return int(np.argmax(scores))


# ----------------------------------------------------------- analyse par mesure
def estimate_key(chroma_mean: np.ndarray) -> dict:
    best = (-2, 0, "maj")
    c = chroma_mean - chroma_mean.mean()
    for r in range(12):
        for mode, prof in (("maj", KK_MAJ), ("min", KK_MIN)):
            p = np.roll(prof, r)
            p = p - p.mean()
            corr = float(np.dot(c, p) / (np.linalg.norm(c) * np.linalg.norm(p) + 1e-9))
            if corr > best[0]:
                best = (corr, r, mode)
    return {"tonique": best[1], "mode": best[2], "nom": f"{NOTES[best[1]]} {'majeur' if best[2] == 'maj' else 'mineur'}",
            "confiance": round(best[0], 3)}


def scale_pcs(key: dict) -> set:
    steps = [0, 2, 4, 5, 7, 9, 11] if key["mode"] == "maj" else [0, 2, 3, 5, 7, 8, 10]
    return {(key["tonique"] + s) % 12 for s in steps}


def _chord_templates():
    T, names = [], []
    for r in range(12):
        for q, iv in (("maj", (0, 4, 7)), ("min", (0, 3, 7))):
            v = np.zeros(12)
            v[[(r + i) % 12 for i in iv]] = [1.0, 0.8, 0.9]
            T.append(v / np.linalg.norm(v))
            names.append((r, q))
    return np.array(T), names


def bar_features(y: np.ndarray, grid: Grid, n_bars: int):
    """Chroma et MFCC moyens par mesure (audio déjà sur la grille)."""
    ym = mono(y)
    hop = 1024
    chroma = librosa.feature.chroma_stft(y=ym, sr=grid.sr, hop_length=hop)
    mfcc = librosa.feature.mfcc(y=ym, sr=grid.sr, hop_length=hop, n_mfcc=13)
    rms = librosa.feature.rms(y=ym, hop_length=hop)[0]
    S = np.abs(librosa.stft(ym, n_fft=8192, hop_length=hop)) ** 2
    fq = librosa.fft_frequencies(sr=grid.sr, n_fft=8192)
    sel = (fq > 35) & (fq < 260)
    pcs = (np.round(librosa.hz_to_midi(fq[sel])) % 12).astype(int)
    bchroma = np.zeros((12, S.shape[1]))
    for pc in range(12):
        bchroma[pc] = S[sel][pcs == pc].sum(axis=0)
    bchroma /= bchroma.max(axis=0, keepdims=True) + 1e-9
    bounds = [librosa.samples_to_frames(grid.bar_start(b), hop_length=hop) for b in range(n_bars + 1)]
    C, M, R, B = [], [], [], []
    for b in range(n_bars):
        a, z = bounds[b], max(bounds[b + 1], bounds[b] + 1)
        B.append(bchroma[:, a:z].mean(axis=1) if z <= bchroma.shape[1] else np.zeros(12))
        C.append(chroma[:, a:z].mean(axis=1) if z <= chroma.shape[1] else np.zeros(12))
        M.append(mfcc[:, a:z].mean(axis=1) if z <= mfcc.shape[1] else np.zeros(13))
        R.append(rms[a:z].mean() if z <= len(rms) else 0.0)
    bar_features.last_bass = np.nan_to_num(np.array(B))
    return np.nan_to_num(np.array(C)), np.nan_to_num(np.array(M)), np.nan_to_num(np.array(R))


def chords_per_bar(chroma_bars: np.ndarray, rms_bars: np.ndarray, key: dict, bass_bars=None) -> list[dict]:
    T, names = _chord_templates()
    out, prev = [], (key["tonique"], key["mode"])
    thr = 0.1 * (rms_bars.max() + 1e-9)
    if bass_bars is None:
        bass_bars = np.zeros_like(chroma_bars)
    for c, r, bc in zip(chroma_bars, rms_bars, bass_bars):
        if r < thr or c.sum() < 1e-6:
            out.append({"racine": prev[0], "qualite": prev[1], "nom": NOTES[prev[0]] + ("m" if prev[1] == "min" else ""), "silence": True})
            continue
        s = T @ (c / (np.linalg.norm(c) + 1e-9))
        # léger biais vers les accords diatoniques
        sc = scale_pcs(key)
        s = s + np.array([0.05 if n[0] in sc else 0 for n in names])
        s = s + 0.35 * np.array([bc[n[0]] for n in names])  # la basse désigne la racine
        r0, q = names[int(np.argmax(s))]
        prev = (r0, q)
        out.append({"racine": r0, "qualite": q, "nom": NOTES[r0] + ("m" if q == "min" else ""), "silence": False})
    return out


def segment_bars(chroma_bars, mfcc_bars, n_bars: int) -> list[dict]:
    """Segmentation par matrice d'auto-similarité (clustering agglomératif contraint)."""
    if n_bars < 4:
        return [{"debut": 0, "fin": n_bars, "label": "A"}]
    f = np.hstack([chroma_bars / (np.linalg.norm(chroma_bars, axis=1, keepdims=True) + 1e-9),
                   (mfcc_bars - mfcc_bars.mean(0)) / (mfcc_bars.std(0) + 1e-9) * 0.3])
    k = int(np.clip(round(n_bars / 8), 2, 12))
    bnd = librosa.segment.agglomerative(f.T, k)
    bnd = sorted(set([0] + [int(b) for b in bnd] + [n_bars]))
    segs = [{"debut": a, "fin": b} for a, b in zip(bnd[:-1], bnd[1:]) if b > a]
    # étiquetage : segments similaires → même lettre
    means = [f[s["debut"]:s["fin"]].mean(0) for s in segs]
    labels, protos = [], []
    for m in means:
        best, bi = 0.0, -1
        for i, p in enumerate(protos):
            sim = float(np.dot(m, p) / (np.linalg.norm(m) * np.linalg.norm(p) + 1e-9))
            if sim > best:
                best, bi = sim, i
        if best > 0.93:
            labels.append(bi)
        else:
            protos.append(m)
            labels.append(len(protos) - 1)
    for s, l in zip(segs, labels):
        s["label"] = chr(ord("A") + l % 26)
    return segs


def choose_hook(segs, vocal_rms_bars: np.ndarray, n_bars: int, hook_len: int = 8) -> dict:
    """Le hook = la section la plus répétée ET la plus riche en voix."""
    v = vocal_rms_bars / (vocal_rms_bars.mean() + 1e-9)
    best = None
    by_label: dict = {}
    for s in segs:
        by_label.setdefault(s["label"], []).append(s)
    for lab, occ in by_label.items():
        voc = np.mean([v[o["debut"]:o["fin"]].mean() for o in occ])
        score = len(occ) * voc * min(1.0, np.mean([o["fin"] - o["debut"] for o in occ]) / 4)
        if best is None or score > best[0]:
            best = (score, lab, occ)
    _, lab, occ = best
    o = max(occ, key=lambda s: v[s["debut"]:s["fin"]].mean())
    start = o["debut"]
    if start + hook_len > n_bars:
        start = max(0, n_bars - hook_len)
    return {"label": lab, "debut": int(start), "fin": int(min(n_bars, start + hook_len)),
            "repetitions": len(occ), "score_voix": round(float(v[o["debut"]:o["fin"]].mean()), 3)}


def classify_profile(feat: dict) -> tuple[str, dict]:
    """Classe la source dans un profil (heuristique transparente, corrigeable par --profil).

    La variété FR n'est pas détectable sans identification de langue : elle n'est
    attribuée que manuellement.
    """
    perc, cent, bpm = feat["ratio_percussif"], feat["centroide_hz"], feat["bpm_source"]
    voc, sub, onr = feat["ratio_voix"], feat["ratio_sub"], feat["onsets_par_s"]
    s = {
        "acoustique": 2.0 * (perc < 0.18) + 1.0 * (sub < 0.08) + 0.5 * (onr < 2.5),
        "electro": 1.5 * (voc < 0.18) + 1.0 * (sub > 0.15) + 1.0 * (perc > 0.3) + 0.5 * (cent > 2500),
        "rap": 1.5 * (voc > 0.25) + 1.0 * (perc > 0.3) + 1.0 * (sub > 0.12) + 0.5 * (bpm < 100 or bpm > 130),
        "rnb": 1.2 * (voc > 0.25) + 1.0 * (bpm < 105) + 1.0 * (cent < 2000) + 0.5 * (0.15 < perc < 0.35),
        "pop": 1.0 + 0.8 * (100 <= bpm <= 130) + 0.5 * (voc > 0.2),
    }
    best = max(s, key=s.get)
    return best, {k: round(float(v), 2) for k, v in s.items()}


def source_features(y: np.ndarray, sr: int, bpm: float, vocals: np.ndarray | None) -> dict:
    ym = mono(y)[: sr * 120]  # 2 min suffisent
    S = np.abs(librosa.stft(ym, n_fft=2048, hop_length=1024))
    H, P = librosa.decompose.hpss(S)
    perc = float((P ** 2).sum() / ((H ** 2).sum() + (P ** 2).sum() + 1e-9))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    pw = (S ** 2).sum(axis=1)
    sub = float(pw[freqs < 100].sum() / (pw.sum() + 1e-9))
    cent = float(librosa.feature.spectral_centroid(S=S, sr=sr).mean())
    onr = len(librosa.onset.onset_detect(y=ym, sr=sr)) / (len(ym) / sr)
    voc = 0.0
    if vocals is not None:
        vm = mono(vocals)[: len(ym)]
        voc = float(np.sqrt((vm ** 2).mean()) / (np.sqrt((ym ** 2).mean()) + 1e-9))
    return {"ratio_percussif": round(perc, 3), "ratio_sub": round(sub, 3), "centroide_hz": round(cent, 1),
            "onsets_par_s": round(onr, 2), "ratio_voix": round(voc, 3), "bpm_source": round(bpm, 2)}


def analyze_bars(mix_aligned: np.ndarray, harmonic_aligned: np.ndarray, vocals_aligned: np.ndarray,
                 grid: Grid, hook_len: int = 8) -> dict:
    n_bars = int(mix_aligned.shape[1] // round(grid.bar_sec * grid.sr))
    Ch, Mf, R = bar_features(harmonic_aligned, grid, n_bars)
    Bc = bar_features.last_bass
    _, Mm, Rm = bar_features(mix_aligned, grid, n_bars)
    _, _, Rv = bar_features(vocals_aligned, grid, n_bars)
    key = estimate_key(Ch.mean(axis=0))
    chords = chords_per_bar(Ch, R, key, Bc)
    segs = segment_bars(Ch, Mm, n_bars)
    hook = choose_hook(segs, Rv, n_bars, hook_len)
    return {"n_mesures": n_bars, "tonalite": key, "accords": chords, "segments": segs, "hook": hook,
            "rms_voix_mesures": Rv.round(5).tolist(), "rms_mesures": Rm.round(5).tolist()}


def measure_bpm(y: np.ndarray, sr: int = SR, target: float | None = None) -> float:
    """BPM mesuré d'un rendu (pour l'évaluation) ; replie les erreurs d'octave vers la cible."""
    t = analyze_tempo(y, sr, None)["bpm"]
    if target:
        cands = [t, t * 2, t / 2, t * 1.5, t / 1.5]
        t = min(cands, key=lambda c: abs(c - target))
    return float(t)


def main():
    ap = argparse.ArgumentParser(description="Analyse musicale d'un fichier audio (JSON sur stdout).")
    ap.add_argument("fichier")
    ap.add_argument("--bpm-source", type=float, default=None, help="BPM source imposé si la détection hésite")
    a = ap.parse_args()
    y = decode(a.fichier)
    t = analyze_tempo(y, SR, a.bpm_source)
    g = Grid(t["bpm"])
    start = int(t["premier_downbeat"] * SR)
    ya = y[:, start:]
    bars = analyze_bars(ya, ya, ya, g)
    feat = source_features(y, SR, t["bpm"], None)
    prof, scores = classify_profile(feat)
    t.pop("beats")
    print(json.dumps({"tempo": t, "mesures": {k: v for k, v in bars.items() if not k.startswith("rms")},
                      "features": feat, "profil": prof, "scores_profil": scores}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
