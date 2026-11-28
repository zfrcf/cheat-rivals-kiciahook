#!/usr/bin/env python3
"""Auto-évaluation d'un rendu (Claude n'entend pas : il mesure et regarde des images).

Métriques : BPM mesuré, écart de timing des kicks, LUFS intégré, true peak, clipping,
corrélation de phase, cohérence tonale (basse / chops), distance spectrale aux
références, clics aux points de coupe des chops. Produit aussi un PNG
(spectrogramme + forme d'onde avec les sections).

Métriques BLOQUANTES : bpm, clipping/true peak, clics, timing des kicks.

CLI : evaluate.py <rendu.wav> --bpm 140  → JSON + PNG à côté du fichier.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import librosa
import numpy as np
import pyloudnorm as pyln
from scipy.signal import resample_poly, butter, sosfiltfilt

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jc_common import SR, decode, mono  # noqa: E402

BANDES = {"sub": (20, 60), "bas": (60, 250), "bas_medium": (250, 1000), "medium": (1000, 4000), "aigu": (4000, 16000)}


def lufs(y: np.ndarray, sr=SR) -> float:
    return float(pyln.Meter(sr).integrated_loudness(y.T.astype(np.float64)))


def true_peak_db(y: np.ndarray) -> float:
    os = resample_poly(y.astype(np.float64), 4, 1, axis=-1)
    return float(20 * np.log10(np.abs(os).max() + 1e-12))


def band_profile(y: np.ndarray, sr=SR) -> dict:
    ym = mono(y)
    S = np.abs(librosa.stft(ym, n_fft=4096, hop_length=2048)) ** 2
    f = librosa.fft_frequencies(sr=sr, n_fft=4096)
    tot = S.sum() + 1e-12
    return {k: round(float(10 * np.log10(S[(f >= a) & (f < b)].sum() / tot + 1e-12)), 2) for k, (a, b) in BANDES.items()}


def detect_kicks(y: np.ndarray, sr=SR) -> np.ndarray:
    """Attaques de kick dans la bande 30-150 Hz.

    1) pics de flux spectral (candidats) ; 2) raffinement : instant de montée la plus
    raide de l'enveloppe grave (RMS 1 ms) dans les 30 ms qui précèdent le pic. Le
    raffinement évite le retard induit par une 808 déclenchée au même instant.
    """
    x = sosfiltfilt(butter(4, [30 / (sr / 2), 150 / (sr / 2)], "band", output="sos"), mono(y))
    env = librosa.onset.onset_strength(y=x, sr=sr, hop_length=64, n_mels=8, fmax=200, lag=1, max_size=1)
    pk = librosa.util.peak_pick(env, pre_max=20, post_max=20, pre_avg=40, post_avg=10, delta=env.max() * 0.08, wait=30)
    cand = librosa.frames_to_samples(pk, hop_length=64)
    from scipy.signal import hilbert
    nfft = 1 << int(np.ceil(np.log2(len(x))))
    amp = np.abs(hilbert(x, N=nfft)[: len(x)])
    w = max(1, int(0.002 * sr))
    amp = np.convolve(amp, np.ones(w) / w, mode="same")
    d = np.diff(amp, prepend=amp[0])
    out = []
    for c in cand:
        a, b = max(0, c - int(0.03 * sr)), min(len(d), c + int(0.005 * sr))
        if b > a:
            out.append(a + int(np.argmax(d[a:b])))
    return np.array(out) / sr


def kick_timing(y: np.ndarray, expected: np.ndarray, sr=SR) -> dict:
    det = detect_kicks(y, sr)
    if len(expected) == 0 or len(det) == 0:
        return {"mediane_ms": None, "taux_trouves": 0.0}
    errs = []
    for t in expected:
        j = np.argmin(np.abs(det - t))
        if abs(det[j] - t) < 0.04:
            errs.append(det[j] - t)
    errs = np.array(errs)
    if len(errs) == 0:
        return {"mediane_ms": None, "taux_trouves": 0.0}
    bias = float(np.median(errs))  # latence constante du détecteur
    return {"mediane_ms": round(float(np.median(np.abs(errs))) * 1000, 2),
            "mediane_ms_hors_latence": round(float(np.median(np.abs(errs - bias))) * 1000, 2),
            "taux_trouves": round(len(errs) / len(expected), 3)}


def click_score(chops: np.ndarray, cuts, sr=SR) -> dict:
    """Détecte les discontinuités aux points de coupe (saut d'échantillon vs voisinage)."""
    x = mono(chops)
    d = np.abs(np.diff(x))
    bad = 0
    worst = 0.0
    for c in cuts:
        c = int(c)
        if c < 200 or c > len(d) - 200:
            continue
        jump = d[c - 4:c + 4].max()
        base = np.median(d[c - 180:c + 180]) + 1e-5
        ratio = jump / base
        worst = max(worst, float(ratio))
        if ratio > 25 and jump > 0.02:
            bad += 1
    return {"clics": bad, "points_testes": len(cuts), "pire_ratio": round(worst, 1)}


def tonal_coherence(bass: np.ndarray | None, bass_notes, chops: np.ndarray | None, key: dict, sr=SR) -> dict:
    from analyze import KK_MAJ, KK_MIN, scale_pcs
    out = {}
    sc = scale_pcs(key)
    if bass_notes:
        pcs = [n % 12 for n in bass_notes]
        out["basse_dans_gamme"] = round(sum(p in sc for p in pcs) / len(pcs), 3)
    if bass is not None and bass_notes and np.abs(bass).max() > 1e-4:
        c = librosa.feature.chroma_cqt(y=mono(bass), sr=sr, fmin=librosa.note_to_hz("C1"), n_octaves=4, hop_length=4096)
        top = c.mean(axis=1).argsort()[::-1][:3]
        out["basse_pcs_dominantes"] = [int(p) for p in top]
    if chops is not None and np.abs(chops).max() > 1e-4:
        c = librosa.feature.chroma_stft(y=mono(chops), sr=sr, hop_length=4096).mean(axis=1)
        prof = np.roll(KK_MAJ if key["mode"] == "maj" else KK_MIN, key["tonique"])
        out["chops_corr_tonalite"] = round(float(np.corrcoef(c, prof)[0, 1]), 3)
    return out


def evaluate(master: np.ndarray, ctx: dict, buses: dict | None = None, ref_profile: dict | None = None,
             png: str | None = None, sr=SR) -> dict:
    """ctx : bpm, kick_times, cuts, key, bass_notes, sections, fixes (seuils)."""
    from analyze import measure_bpm
    fx = ctx.get("fixes", {})
    buses = buses or {}
    m = {}
    m["bpm_mesure"] = round(measure_bpm(master, sr, ctx["bpm"]), 2)
    m["lufs"] = round(lufs(master, sr), 2)
    m["true_peak_dbtp"] = round(true_peak_db(master), 2)
    m["clipping_echantillons"] = int((np.abs(master) >= 0.999).sum())
    L, R = master
    m["correlation_phase"] = round(float(np.corrcoef(L, R)[0, 1]) if np.std(R) > 0 else 1.0, 3)
    m["kicks"] = kick_timing(master, np.asarray(ctx.get("kick_times", [])), sr)
    m["clics_chops"] = click_score(buses["chops"], ctx.get("cuts", []), sr) if "chops" in buses else {"clics": 0, "points_testes": 0}
    m["tonal"] = tonal_coherence(buses.get("basse"), ctx.get("bass_notes"), buses.get("chops"), ctx["key"], sr)
    m["bandes_db"] = band_profile(master, sr)
    if ref_profile:
        d = [abs(m["bandes_db"][k] - ref_profile[k]) for k in BANDES if k in ref_profile]
        m["distance_spectrale_refs_db"] = round(float(np.mean(d)), 2) if d else None
    tol = fx.get("bpm_tolerance", 0.5)
    km = m["kicks"].get("mediane_ms")
    m["bloquantes"] = {
        "bpm": abs(m["bpm_mesure"] - ctx["bpm"]) <= tol,
        "true_peak": m["true_peak_dbtp"] <= fx.get("true_peak_max", -1.0) + 0.05 and m["clipping_echantillons"] == 0,
        "clics": m["clics_chops"]["clics"] == 0,
        "timing_kicks": km is not None and km < fx.get("kick_timing_max_ms", 10),
    }
    m["ok"] = all(m["bloquantes"].values())
    m["indicatives"] = {
        "loudness": abs(m["lufs"] - ctx.get("lufs_target", -8)) <= 1.0,
        "phase": m["correlation_phase"] > 0,
        "basse_tonale": m["tonal"].get("basse_dans_gamme", 1) >= 0.75,
    }
    if png:
        plot(master, ctx.get("sections", []), png, ctx.get("titre", ""), sr)
        m["png"] = str(png)
    return m


def plot(master, sections, path, title="", sr=SR):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    ym = mono(master)
    fig, ax = plt.subplots(2, 1, figsize=(14, 6.5), sharex=True, gridspec_kw={"height_ratios": [2.2, 1]})
    S = librosa.amplitude_to_db(np.abs(librosa.stft(ym, n_fft=2048, hop_length=1024)), ref=np.max)
    librosa.display.specshow(S, sr=sr, hop_length=1024, x_axis="time", y_axis="log", ax=ax[0], cmap="magma", vmin=-80)
    ax[0].set_title(f"Spectrogramme — {title}")
    t = np.arange(len(ym)) / sr
    step = max(1, len(ym) // 20000)
    ax[1].plot(t[::step], ym[::step], lw=0.4, color="#335")
    ax[1].axhline(10 ** (-1 / 20), color="r", lw=0.6, ls="--")
    ax[1].axhline(-10 ** (-1 / 20), color="r", lw=0.6, ls="--")
    for s in sections:
        for a in ax:
            a.axvline(s["debut_s"], color="c", lw=0.8)
        ax[1].text(s["debut_s"], 0.92, s["nom"], fontsize=8, color="c")
    ax[1].set_ylim(-1.05, 1.05)
    ax[1].set_xlabel("temps (s)")
    fig.tight_layout()
    fig.savefig(path, dpi=80)
    plt.close(fig)


def main():
    import librosa.display  # noqa: F401
    ap = argparse.ArgumentParser(description="Mesures d'un rendu Jersey club.")
    ap.add_argument("fichier")
    ap.add_argument("--bpm", type=float, required=True)
    a = ap.parse_args()
    y = decode(a.fichier)
    from analyze import estimate_key
    key = estimate_key(librosa.feature.chroma_stft(y=mono(y), sr=SR).mean(axis=1))
    png = str(Path(a.fichier).with_suffix(".png"))
    kt = detect_kicks(y)
    m = evaluate(y, {"bpm": a.bpm, "kick_times": kt, "key": key}, png=png)
    print(json.dumps(m, ensure_ascii=False, indent=1))


import librosa.display  # noqa: E402,F401  (specshow)

if __name__ == "__main__":
    main()
