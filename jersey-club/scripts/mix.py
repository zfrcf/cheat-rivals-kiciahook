#!/usr/bin/env python3
"""Mix : bus (drums / fx / chops / voix / instru / basse), EQ, compression, sidechain,
saturation légère, limiteur true-peak et loudness cible.

Chaîne :
1. chaque bus est ramené à un niveau RMS « actif » de référence (indépendant du niveau
   du morceau source), puis traité (pedalboard : filtres, compresseurs, réverbe) ;
2. sidechain : enveloppe calculée à partir des temps de kick (profondeur apprise) sur
   basse et instru ;
3. somme → compression de bus → saturation douce → gain vers la cible LUFS → limiteur
   true-peak (sur-échantillonné ×4, lookahead) ; itéré 3 fois car la limitation fait
   baisser la loudness.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
from pedalboard import (Compressor, HighpassFilter, HighShelfFilter, LowpassFilter, LowShelfFilter,
                        Pedalboard, PeakFilter, Reverb)
from scipy.ndimage import maximum_filter1d, uniform_filter1d
from scipy.signal import resample_poly

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jc_common import SR, db, undb  # noqa: E402

# niveau RMS actif visé par bus (dBFS, avant master)
NIVEAUX = {"drums": -15.0, "fx": -25.0, "chops": -18.5, "voix": -19.5, "voix_filtre": -23.0,
           "instru": -21.0, "instru_filtre": -24.0, "basse": -17.0}


def active_rms_db(x: np.ndarray) -> float:
    m = np.abs(x).max(axis=0)
    if m.max() < 1e-6:
        return -120.0
    env = uniform_filter1d(m, 2048)
    act = env > env.max() * 0.03
    return db(np.sqrt((x[:, act] ** 2).mean())) if act.any() else -120.0


def level(x: np.ndarray, target_db: float) -> np.ndarray:
    cur = active_rms_db(x)
    return x if cur < -100 else x * undb(target_db - cur)


def chains(params: dict) -> dict:
    return {
        "drums": Pedalboard([HighpassFilter(28), Compressor(threshold_db=-14, ratio=3, attack_ms=6, release_ms=80)]),
        "fx": Pedalboard([HighpassFilter(220), Reverb(room_size=0.35, wet_level=0.18, dry_level=0.85)]),
        "chops": Pedalboard([HighpassFilter(170), PeakFilter(3200, 2.5, 0.8), HighShelfFilter(9000, 1.5),
                             Compressor(threshold_db=-20, ratio=4, attack_ms=2, release_ms=60),
                             Reverb(room_size=0.25, wet_level=0.08, dry_level=0.95)]),
        "voix": Pedalboard([HighpassFilter(120), Compressor(threshold_db=-20, ratio=3, attack_ms=5, release_ms=90)]),
        "voix_filtre": Pedalboard([HighpassFilter(500), LowpassFilter(2600),
                                   Reverb(room_size=0.6, wet_level=0.25, dry_level=0.8)]),
        "instru": Pedalboard([HighpassFilter(140), LowShelfFilter(250, -3)]),
        "instru_filtre": Pedalboard([HighpassFilter(200), LowpassFilter(900)]),
        "basse": Pedalboard([LowpassFilter(260), Compressor(threshold_db=-12, ratio=2.5, attack_ms=10, release_ms=120)]),
    }


def sidechain_env(kick_times, n: int, depth: float, release_s: float, sr=SR) -> np.ndarray:
    g = np.zeros(n, np.float32)
    L = int(release_s * 5 * sr)
    t = np.arange(L) / sr
    shape = (np.minimum(1, t / 0.003) * np.exp(-t / release_s)).astype(np.float32)
    for k in kick_times:
        s = int(k * sr)
        if s >= n:
            continue
        m = min(L, n - s)
        g[s:s + m] = np.maximum(g[s:s + m], shape[:m])
    return 1 - depth * g


def tp_limit(y: np.ndarray, ceiling_db: float, sr=SR) -> np.ndarray:
    """Limiteur true-peak non causal (rendu hors-ligne) : réduction tenue + lissage."""
    c = undb(ceiling_db)
    os = resample_poly(y.astype(np.float64), 4, 1, axis=-1)
    pk = np.abs(os).max(axis=0)[: y.shape[1] * 4].reshape(-1, 4).max(axis=1)
    pk = np.pad(pk, (0, y.shape[1] - len(pk)), mode="edge")
    red = 1 - np.minimum(1.0, c / (pk + 1e-12))
    hold = maximum_filter1d(red, size=int(0.05 * sr))
    sm = uniform_filter1d(hold, size=int(0.004 * sr))
    red = np.maximum(sm, red)
    return (y * (1 - red)).astype(np.float32)


def master_chain(x: np.ndarray, lufs_target: float, ceiling_db: float, sr=SR) -> tuple[np.ndarray, list]:
    x = Pedalboard([Compressor(threshold_db=-12, ratio=2, attack_ms=15, release_ms=120)])(x, sr)
    meter = pyln.Meter(sr)
    log = []
    for _ in range(3):
        L = meter.integrated_loudness(x.T.astype(np.float64))
        x = x * undb(lufs_target - L)
        x = np.tanh(x * 1.1) / np.tanh(1.1) if np.abs(x).max() > 1 else x  # saturation douce
        x = tp_limit(x, ceiling_db, sr)
        log.append(round(float(meter.integrated_loudness(x.T.astype(np.float64))), 2))
    os = resample_poly(x.astype(np.float64), 4, 1, axis=-1)
    tp = db(np.abs(os).max())
    if tp > ceiling_db:
        x = x * undb(ceiling_db - tp - 0.02)
    return x.astype(np.float32), log


def mix(buses: dict, params: dict, kick_times, ctx: dict, sr=SR) -> tuple[np.ndarray, dict, dict]:
    """Renvoie (master, stems_export, infos)."""
    ch = chains(params)
    proc = {}
    lvl_instru = float(params.get("keep_original_instru", 0.45))
    for name, x in buses.items():
        if name not in NIVEAUX or np.abs(x).max() < 1e-6:
            continue
        tgt = NIVEAUX[name]
        if name.startswith("instru"):
            if lvl_instru < 0.05:
                continue
            tgt += db(lvl_instru / 0.45) if lvl_instru > 0 else -60
        y = ch[name](level(x, tgt), sr)
        proc[name] = y.astype(np.float32)
    n = next(iter(buses.values())).shape[1]
    depth = float(params.get("sidechain_depth", 0.6))
    if "basse" in proc:
        proc["basse"] = proc["basse"] * sidechain_env(kick_times, n, depth * 0.7, 0.05)
    for k in ("instru", "instru_filtre", "voix"):
        if k in proc:
            proc[k] = proc[k] * sidechain_env(kick_times, n, depth * (1.0 if k.startswith("instru") else 0.3), 0.12)
    # le kick reste en tête : bus drums = kick + reste
    total = sum(proc.values()) if proc else np.zeros((2, n), np.float32)
    if ctx.get("fondu"):
        a, z = ctx["fondu"]
        env = np.ones(n, np.float32)
        env[a:z] = np.linspace(1, 0, z - a) ** 1.5
        env[z:] = 0
        total = total * env
        proc = {k: v * env for k, v in proc.items()}
    ceiling = float(ctx.get("plafond_tp", -1.3))
    master, lufs_log = master_chain(total, float(params.get("lufs_target", -8)), ceiling, sr)
    # stems exportés à l'échelle du master (gain global identique) pour reprise en DAW
    pre = np.abs(total).max() + 1e-9
    g = np.abs(master).max() / pre
    stems = {"drums": proc.get("drums", 0) + proc.get("fx", 0),
             "chops": proc.get("chops", 0) + proc.get("voix", 0) + proc.get("voix_filtre", 0),
             "basse": proc.get("basse", 0), "instru": proc.get("instru", 0) + proc.get("instru_filtre", 0)}
    stems = {k: (np.asarray(v, np.float32) * g if not np.isscalar(v) else np.zeros((2, n), np.float32))
             for k, v in stems.items()}
    return master, stems, {"lufs_iterations": lufs_log, "plafond_tp": ceiling, "bus": sorted(proc)}
