#!/usr/bin/env python3
"""Basse : 808 qui suit la tonique de l'accord, basse d'origine recalée, ou aucune.

Modes (`bass_mode`, paramètre appris) :
- 808_kick  : une note par kick, sur la racine de l'accord de la mesure source ;
- 808_temps : une note par temps ;
- origine   : le stem basse recalé, filtré (passe-bas 220 Hz) ;
- aucune.
La 808 : sinus avec chute de pitch (+12 dt → note en 25 ms), légère 2e harmonique,
saturation tanh, glide optionnel entre deux racines différentes.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jc_common import SR, TICKS_PER_BAR, Grid, add_at, fade  # noqa: E402


def root_midi(pc: int) -> int:
    m = 24 + int(pc) % 12
    return m + 12 if m < 28 else m  # E1 … D#2


def bass_notes(plan, drum_ev, chords, params, grid: Grid, rng) -> list[dict]:
    mode = params.get("bass_mode", "808_kick")
    if not str(mode).startswith("808"):
        return []
    starts = []
    if mode == "808_kick":
        starts = sorted((e["bar"], e["tick"]) for e in drum_ev if e["inst"] == "kick" and plan[e["bar"]].get("basse"))
    else:
        starts = [(b, t) for b, bar in enumerate(plan) if bar.get("basse") for t in (0, 12, 24, 36)]
    notes = []
    for i, (b, t) in enumerate(starts):
        src = plan[b].get("src_bar")
        ch = chords[src] if (src is not None and 0 <= src < len(chords)) else {"racine": 0}
        s0 = grid.tick_to_sample(b, t)
        if i + 1 < len(starts) and starts[i + 1][0] <= b + 1:
            s1 = grid.tick_to_sample(*starts[i + 1])
        else:
            s1 = s0 + grid.ticks_to_samples(12)
        notes.append({"start": s0, "len": max(s1 - s0, int(0.05 * grid.sr)), "midi": root_midi(ch["racine"])})
    return notes


def render_808(notes, n: int, params: dict, rng, sr=SR, glide=True) -> np.ndarray:
    buf = np.zeros((2, n), np.float32)
    prev = None
    for nt in notes:
        L = nt["len"]
        t = np.arange(L) / sr
        f_target = 440 * 2 ** ((nt["midi"] - 69) / 12)
        f = f_target * (1 + np.exp(-t / 0.012))  # chute de pitch d'attaque (punch)
        if glide and prev is not None and prev != nt["midi"] and rng.random() < 0.35:
            f_prev = 440 * 2 ** ((prev - 69) / 12)
            f = f + (f_prev - f_target) * np.exp(-t / 0.05)
        ph = 2 * np.pi * np.cumsum(f) / sr
        x = np.sin(ph) + 0.18 * np.sin(2 * ph)
        env = np.minimum(1, t / 0.003) * (0.55 + 0.45 * np.exp(-t / 0.15))
        x = np.tanh(2.2 * x * env) / np.tanh(2.2)
        x = fade(x.astype(np.float32), 0, min(int(0.015 * sr), L // 3))
        add_at(buf, x, nt["start"], 0.8)
        prev = nt["midi"]
    return buf


def render_origine(bass_aligned: np.ndarray, layer: np.ndarray) -> np.ndarray:
    sos = butter(4, 220 / (SR / 2), output="sos")
    return sosfilt(sos, layer, axis=-1).astype(np.float32)
