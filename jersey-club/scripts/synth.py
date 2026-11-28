#!/usr/bin/env python3
"""Audio synthétique pour les tests et la démo (aucune musique protégée).

- `click(bpm, dur)` : métronome ;
- `song(dur, bpm)` : « chanson » avec accords, basse, batterie et une voix synthétique
  (harmoniques + formants) qui chante un refrain répété (le hook) et des couplets.

CLI : synth.py song -o chanson.wav [--bpm 100 --duree 60]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from scipy.signal import butter, lfilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jc_common import SR, write_wav  # noqa: E402


def midi_hz(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def click(bpm: float, dur: float, sr: int = SR) -> np.ndarray:
    n = int(dur * sr)
    y = np.zeros(n, np.float32)
    t = np.arange(int(0.03 * sr)) / sr
    c = (np.sin(2 * np.pi * 1000 * t) * np.exp(-t * 150)).astype(np.float32)
    k = 0
    while True:
        s = int(round(k * 60 / bpm * sr))
        if s >= n:
            break
        g = 1.0 if k % 4 == 0 else 0.6
        y[s:s + len(c)] += g * c[: n - s]
        k += 1
    return np.vstack([y, y]) * 0.8


def _voice(f0, dur, sr, vowel="a", rng=None):
    t = np.arange(int(dur * sr)) / sr
    vib = 1 + 0.01 * np.sin(2 * np.pi * 5.5 * t)
    ph = 2 * np.pi * np.cumsum(f0 * vib) / sr
    src = sum((1.0 / h) * np.sin(h * ph) for h in range(1, 25))
    form = {"a": [(800, 80), (1150, 90), (2900, 120)], "o": [(450, 70), (800, 80), (2830, 100)],
            "e": [(400, 60), (2000, 100), (2550, 120)], "i": [(300, 50), (2300, 100), (3000, 120)]}[vowel]
    out = np.zeros_like(src)
    for fc, bw in form:
        b, a = butter(2, [max(fc - bw, 50) / (sr / 2), (fc + bw) / (sr / 2)], btype="band")
        out += lfilter(b, a, src)
    noise = (rng.standard_normal(len(t)) if rng is not None else 0) * 0.02
    env = np.minimum(1, t / 0.015) * np.minimum(1, (dur - t) / 0.04).clip(0)
    return (out + noise) * env


def song(dur: float = 60, bpm: float = 100, sr: int = SR, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(dur * sr)
    L = np.zeros(n)
    R = np.zeros(n)
    beat = 60 / bpm
    bar = 4 * beat
    prog = [(57, "min"), (53, "maj"), (48, "maj"), (55, "maj")]  # Am F C G
    n_bars = int(dur / bar)

    def put(x, t0, g=1.0, pan=0.0):
        s = int(t0 * sr)
        if s >= n:
            return
        e = min(n, s + len(x))
        L[s:e] += g * x[: e - s] * (1 - max(pan, 0))
        R[s:e] += g * x[: e - s] * (1 + min(pan, 0))

    tk = np.arange(int(0.35 * sr)) / sr
    kick = np.sin(2 * np.pi * np.cumsum(50 + 90 * np.exp(-tk * 30)) / sr) * np.exp(-tk * 9)
    tsn = np.arange(int(0.2 * sr)) / sr
    snare = rng.standard_normal(len(tsn)) * np.exp(-tsn * 25) * 0.5 + np.sin(2 * np.pi * 190 * tsn) * np.exp(-tsn * 30) * 0.4
    th = np.arange(int(0.05 * sr)) / sr
    b_, a_ = butter(2, 7000 / (sr / 2), "high")
    hat = lfilter(b_, a_, rng.standard_normal(len(th))) * np.exp(-th * 80) * 0.3

    hook_melody = [69, 72, 74, 72, 69, 67, 69, 64]
    verse_melody = [64, 64, 67, 64, 62, 60, 62, 64]
    vowels = ["a", "o", "e", "a", "i", "a", "o", "e"]
    for b in range(n_bars):
        t0 = b * bar
        root, q = prog[b % 4]
        third = 3 if q == "min" else 4
        tp = np.arange(int(bar * sr)) / sr
        pad = sum(np.sign(np.sin(2 * np.pi * midi_hz(root + iv) * tp)) * 0.04 for iv in (0, third, 7))
        b2, a2 = butter(2, 1800 / (sr / 2))
        put(lfilter(b2, a2, pad) * np.minimum(1, tp / 0.05), t0, 1.0, -0.3)
        put(lfilter(b2, a2, pad) * np.minimum(1, tp / 0.05), t0, 1.0, 0.3)
        tb = np.arange(int(beat * 2 * sr)) / sr
        bass = np.sin(2 * np.pi * midi_hz(root - 24) * tb) * np.exp(-tb * 1.5) * 0.35
        put(bass, t0)
        put(bass, t0 + 2 * beat)
        for k in range(4):
            if k in (0, 2):
                put(kick, t0 + k * beat, 0.7)
            else:
                put(snare, t0 + k * beat, 0.5)
        for k in range(8):
            put(hat, t0 + k * beat / 2, 0.6 + 0.3 * (k % 2 == 0), 0.2)
        # voix : refrain (hook) sur les mesures 8-15, 24-31…, couplet ailleurs (1 mesure sur 2)
        chorus = (b // 8) % 2 == 1
        if chorus or b % 2 == 0:
            mel = hook_melody if chorus else verse_melody
            for k, note in enumerate(mel):
                d = beat / 2 * (0.85 if k % 2 == 0 else 0.6)
                put(_voice(midi_hz(note - (0 if chorus else 0)), d, sr, vowels[k], rng),
                    t0 + k * beat / 2, 0.22 if chorus else 0.12)
    y = np.vstack([L, R]).astype(np.float32)
    return y / (np.abs(y).max() + 1e-9) * 0.8


def main():
    ap = argparse.ArgumentParser(description="Génère de l'audio synthétique de test.")
    ap.add_argument("type", choices=["song", "click"])
    ap.add_argument("-o", "--sortie", required=True)
    ap.add_argument("--bpm", type=float, default=100)
    ap.add_argument("--duree", type=float, default=60)
    a = ap.parse_args()
    y = song(a.duree, a.bpm) if a.type == "song" else click(a.bpm, a.duree)
    write_wav(a.sortie, y, subtype="PCM_16")


if __name__ == "__main__":
    main()
