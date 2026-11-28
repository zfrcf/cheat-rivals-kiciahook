#!/usr/bin/env python3
"""Mapping de tempo et time-stretch / pitch (rubberband).

Pour un BPM source b et une cible t, on choisit m ∈ {0,5 ; 1 ; 2} minimisant |t/(b·m) − 1|.
Les beats réels de la source sont envoyés à rubberband sous forme de time-map : chaque
beat source i tombe exactement sur le temps cible i·m. Un morceau au tempo flottant est
donc lui aussi recalé sur la grille (pas seulement un ratio global).

Modes de pitch :
- preserve : tonalité d'origine ;
- follow   : le pitch suit le tempo (effet « sped up ») = 12·log2(t/(b·m)) demi-tons ;
- +N / -N  : transposition manuelle.

CLI : stretch.py <fichier> --bpm 140 [--pitch preserve|follow|+N] -o sortie.wav
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import numpy as np
import pyrubberband as pyrb

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jc_common import SR, decode, log, write_wav  # noqa: E402


def choose_multiplier(b: float, t: float, mults=(0.5, 1, 2)) -> float:
    return float(min(mults, key=lambda m: abs(t / (b * m) - 1)))


def residual(b: float, t: float, m: float) -> float:
    return t / (b * m) - 1


def pitch_semitones(mode, b: float, t: float, m: float) -> float:
    mode = str(mode)
    if mode == "preserve":
        return 0.0
    if mode == "follow":
        return 12 * math.log2(t / (b * m))
    try:
        return float(mode)
    except ValueError:
        raise ValueError(f"Mode de pitch inconnu : {mode} (preserve|follow|+N)")


def build_time_map(beats: list[float], phase: int, m: float, target_bpm: float, n_in: int, sr: int):
    """Time-map (échantillon source → échantillon cible) à partir du premier downbeat."""
    b = np.asarray(beats[phase:], dtype=float)
    s0 = b[0]
    tb = 60.0 / target_bpm
    src = np.round((b - s0) * sr).astype(int)
    dst = np.round(np.arange(len(b)) * m * tb * sr).astype(int)
    n_trim = n_in - int(round(s0 * sr))
    # extrapolation de la fin au ratio local
    ratio = (dst[-1] - dst[-2]) / max(src[-1] - src[-2], 1) if len(b) > 1 else 1.0
    end_dst = int(dst[-1] + (n_trim - src[-1]) * ratio)
    tm = [(int(s), int(d)) for s, d in zip(src, dst) if s < n_trim]
    tm.append((n_trim, max(end_dst, tm[-1][1] + 1)))
    return int(round(s0 * sr)), tm


def stretch_aligned(y: np.ndarray, time_map, start: int, semitones: float, sr: int = SR) -> np.ndarray:
    """Applique le time-map (et le pitch) à un signal (2, n)."""
    x = y[:, start:].T.astype(np.float64)
    rb = {"--pitch": f"{semitones:.4f}"} if abs(semitones) > 1e-3 else {}
    out = pyrb.timemap_stretch(x, sr, time_map, rbargs=rb)
    return np.ascontiguousarray(out.T.astype(np.float32))


def align_stems(stems: dict, tempo: dict, target_bpm: float, pitch_mode="preserve",
                sr: int = SR, cfg_fixes: dict | None = None) -> tuple[dict, dict]:
    """Recalle tous les stems sur la grille cible. Renvoie (stems_alignés, infos)."""
    cfg_fixes = cfg_fixes or {}
    b = tempo["bpm"]
    m = choose_multiplier(b, target_bpm, tuple(cfg_fixes.get("multiplicateurs", (0.5, 1, 2))))
    res = residual(b, target_bpm, m)
    semis = pitch_semitones(pitch_mode, b, target_bpm, m)
    warnings = []
    lim = cfg_fixes.get("stretch_max", 0.20)
    if abs(res) > lim:
        warnings.append(f"Stretch résiduel de {res*100:+.1f} % (> ±{lim*100:.0f} %) : "
                        f"source {b:.1f} BPM × {m} → {target_bpm:.1f} BPM ; artefacts possibles.")
    n_in = next(iter(stems.values())).shape[1]
    start, tm = build_time_map(tempo["beats"], tempo["downbeat_phase"], m, target_bpm, n_in, sr)
    out = {}
    for k, v in stems.items():
        out[k] = stretch_aligned(v, tm, start, semis, sr)
    n = min(v.shape[1] for v in out.values())
    out = {k: v[:, :n] for k, v in out.items()}
    info = {"bpm_source": b, "bpm_cible": target_bpm, "multiplicateur": m, "stretch_residuel": res,
            "demi_tons": semis, "pitch_mode": str(pitch_mode), "avertissements": warnings,
            "debut_source_s": start / sr}
    log(f"Tempo : {b:.2f} BPM × {m} → {target_bpm:.2f} BPM (stretch {res*100:+.1f} %, pitch {semis:+.2f} dt)")
    return out, info


def main():
    from analyze import analyze_tempo
    ap = argparse.ArgumentParser(description="Recale un fichier sur un tempo cible (rubberband).")
    ap.add_argument("fichier")
    ap.add_argument("--bpm", type=float, default=140)
    ap.add_argument("--pitch", default="preserve")
    ap.add_argument("--bpm-source", type=float, default=None)
    ap.add_argument("-o", "--sortie", required=True)
    a = ap.parse_args()
    y = decode(a.fichier)
    t = analyze_tempo(y, SR, a.bpm_source)
    out, info = align_stems({"mix": y}, t, a.bpm, a.pitch)
    write_wav(a.sortie, out["mix"])
    for w in info["avertissements"]:
        log("⚠ " + w)


if __name__ == "__main__":
    main()
