#!/usr/bin/env python3
"""Vocal chops : découpe du hook en syllabes et séquençage façon Jersey club.

1. Banque : onsets du stem voix (déjà recalé sur la grille) dans le hook → tranches
   « syllabes » (60 ms – 1 temps), silence de fin rogné, fondus 3/5 ms anti-clics.
2. Motifs (par mesure, grille de 48 ticks) : appel/réponse dans l'ordre du hook,
   stutter en triolets (pas de 4 ticks) ou triolets de doubles (2 ticks), répétition de
   la dernière syllabe, roll avant le drop (pas 4 → 3 → 2), reverse ponctuel, chops
   pitchés de +3/+5/+7 demi-tons (par rééchantillonnage : plus aigu ET plus court,
   comme un sample accéléré).
3. Rendu : chaque chop est tronqué à la longueur de sa case (+ fondu) → pas de
   chevauchement ; les points de coupe sont renvoyés pour la détection de clics.
"""
from __future__ import annotations

import sys
from pathlib import Path

import librosa
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jc_common import SR, TICKS_PER_BAR, Grid, add_at, fade, log, mono  # noqa: E402
from drums import roll_ticks  # noqa: E402


def make_bank(vocals: np.ndarray, grid: Grid, hook: dict, fades_ms=(3, 5), max_chops: int = 16) -> list[dict]:
    a, z = grid.bar_start(hook["debut"]), grid.bar_start(hook["fin"])
    seg = vocals[:, a:z]
    ym = mono(seg)
    if len(ym) < grid.sr * 0.5 or np.abs(ym).max() < 1e-4:
        return []
    on = librosa.onset.onset_detect(y=ym, sr=grid.sr, hop_length=256, backtrack=True, units="samples")
    on = np.unique(np.r_[on, len(ym)])
    beat = int(grid.beat_sec * grid.sr)
    lo, hi = int(0.06 * grid.sr), beat
    env = np.abs(ym)
    peak = env.max()
    fi, fo = (int(f / 1000 * grid.sr) for f in fades_ms)
    bank = []
    for s, e in zip(on[:-1], on[1:]):
        e = min(e, s + hi)
        if e - s < lo:
            continue
        x = seg[:, s:e].copy()
        loc = np.abs(mono(x))
        if loc.max() < 0.12 * peak:
            continue
        # rognage du silence final
        sm = np.convolve(loc, np.ones(256) / 256, mode="same")
        above = np.nonzero(sm > 0.1 * sm.max())[0]
        if len(above):
            x = x[:, : max(above[-1] + 1, lo)]
        fade(x, fi, fo)
        rms = float(np.sqrt((x ** 2).mean()))
        bank.append({"audio": x, "src_s": (a + s) / grid.sr, "tick_hook": (s / grid.sr) / grid.tick_sec,
                     "rms": rms, "dur_s": x.shape[1] / grid.sr})
    if len(bank) > max_chops:
        keep = sorted(sorted(range(len(bank)), key=lambda i: -bank[i]["rms"])[:max_chops])
        bank = [bank[i] for i in keep]
    # normalisation douce des niveaux
    ref = np.median([c["rms"] for c in bank]) if bank else 1
    for c in bank:
        g = np.clip(ref / (c["rms"] + 1e-9), 0.5, 2.0)
        c["audio"] *= g
    log(f"Banque de chops : {len(bank)} syllabes")
    return bank


def _phrase(n_bars: int, bank_n: int, params: dict, rng, fixes: dict, stutter_boost: float = 0.0) -> list[dict]:
    """Génère une phrase de chops (événements relatifs au début de la phrase)."""
    dens = float(params["chop_density"])
    stut = min(0.95, float(params["stutter_prob"]) + stutter_boost)
    semis = int(params.get("chop_pitch_shift", 0))
    ppitch = float(fixes.get("chop_pitch_prob", 0.25))
    ev, ci = [], int(rng.integers(0, max(bank_n, 1)))
    beats = n_bars * 4
    for bt in range(beats):
        last = bt == beats - 1
        if not last and rng.random() > dens:
            continue
        base = bt * 12
        sp = semis if (semis and rng.random() < ppitch) else 0
        rev = bool(rng.random() < 0.06)
        if last or rng.random() < stut:
            step = 4 if rng.random() < 0.7 else 2
            reps = 12 // step
            c = ci if not last else (ci - 1) % bank_n  # dernière syllabe répétée
            for r in range(reps):
                ev.append({"tick": base + r * step, "chop": c, "semis": sp, "rev": rev and r == reps - 1,
                           "gain": 0.75 + 0.25 * (r == 0), "slot": step})
        else:
            ev.append({"tick": base, "chop": ci, "semis": sp, "rev": rev, "gain": 0.95, "slot": 6 if rng.random() < 0.5 else 12})
            if rng.random() < 0.5 * dens:
                ci = (ci + 1) % bank_n
                ev.append({"tick": base + 6, "chop": ci, "semis": 0, "rev": False, "gain": 0.85, "slot": 6})
        ci = (ci + 1) % bank_n
    return ev


def chop_events(plan: list[dict], bank: list, params: dict, rng, fixes: dict) -> list[dict]:
    """Place les phrases de chops selon le plan d'arrangement."""
    if not bank:
        return []
    n = len(bank)
    out, cache = [], {}
    for b, bar in enumerate(plan):
        mode = bar.get("chops")
        if not mode:
            continue
        pos, L = bar["pos"], bar["len"]
        if mode == "roll":
            if pos == L - 1:
                for t in roll_ticks([4, 3, 2]):
                    out.append({"bar": b, "tick": t, "chop": 0, "semis": 0, "rev": False,
                                "gain": 0.6 + 0.4 * t / TICKS_PER_BAR, "slot": 2})
            elif rng.random() < float(params["chop_density"]) * 0.5:
                out.append({"bar": b, "tick": 36, "chop": int(rng.integers(0, n)), "semis": 0, "rev": False, "gain": 0.7, "slot": 12})
            continue
        key = (bar["section"], mode)
        if key not in cache:
            sub = np.random.default_rng(rng.integers(1 << 31))
            boost = 0.15 if mode == "variation" else 0.0
            cache[key] = (_phrase(2, n, params, sub, fixes, boost), _phrase(2, n, params, sub, fixes, boost + 0.2))
        main, fill = cache[key]
        ph = fill if (pos // 2) % 4 == 3 else main  # une phrase « fill » tous les 8 mesures
        for e in ph:
            if e["tick"] // TICKS_PER_BAR == pos % 2:
                out.append(dict(e, bar=b, tick=e["tick"] % TICKS_PER_BAR))
    return out


def render_chops(events, bank, grid: Grid, n: int, params: dict, fixes: dict, rng) -> tuple[np.ndarray, list]:
    buf = np.zeros((2, n), np.float32)
    cuts = []
    fo = int(fixes.get("fade_chop_ms", [3, 5])[1] / 1000 * grid.sr)
    hum = float(params.get("humanize_ms", 0))
    swing = float(params.get("swing", 0))
    pitched = {}
    for e in events:
        c = bank[e["chop"] % len(bank)]
        k = (e["chop"] % len(bank), e["semis"])
        if k not in pitched:
            x = c["audio"]
            if e["semis"]:
                x = librosa.resample(x, orig_sr=grid.sr * 2 ** (e["semis"] / 12), target_sr=grid.sr, res_type="soxr_hq")
                fade(x, int(0.003 * grid.sr), fo)
            pitched[k] = x.astype(np.float32)
        x = pitched[k]
        if e["rev"]:
            x = np.ascontiguousarray(x[:, ::-1])
        tick = e["tick"] + (swing * 3 if e["tick"] % 6 == 3 else 0)
        maxlen = grid.ticks_to_samples(e["slot"]) - int(0.002 * grid.sr)
        if x.shape[1] > maxlen:
            x = fade(x[:, :maxlen].copy(), 0, fo)
        s = grid.tick_to_sample(e["bar"], tick) + int(rng.uniform(-hum, hum) / 1000 * grid.sr * 0.5)
        add_at(buf, x, s, e["gain"])
        cuts += [s, s + x.shape[1]]
    return buf, cuts
