#!/usr/bin/env python3
"""Batterie et FX Jersey club : synthèse des one-shots, patterns, séquenceur, MIDI.

Tous les sons sont SYNTHÉTISÉS en numpy (aucun sample protégé) :
- kick : sinus à enveloppe de pitch + click, decay réglable (`kick_decay`) ;
- clap : bruit filtré multi-impulsions ; hats : bruit passe-haut ;
- squeak (« bed squeak ») : deux chirps sinus (montant puis descendant) ;
- crash, horn, sirène, riser, souffle (chopped breath).
Si l'utilisateur dépose kick*.wav, clap*.wav, hat*.wav, squeak*.wav, crash*.wav… dans
assets/user_packs/, ils remplacent les sons synthétiques correspondants.

CLI : drums.py --oneshots          (écrit les one-shots dans assets/oneshots/)
      drums.py --demo -o demo.wav  (4 mesures de chaque pattern de kick)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import mido
import numpy as np
from scipy.signal import butter, sosfilt

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jc_common import (ASSETS_DIR, CONFIG_DIR, SR, TICKS_PER_BAR, Grid, add_at, decode,  # noqa: E402
                       load_yaml, log, mono, pan_gains, parse_ticks, write_wav)

GM = {"kick": 36, "clap": 39, "hat": 42, "crash": 49, "squeak": 76, "horn": 61, "siren": 71,
      "breath": 70, "riser": 92}


# ---------------------------------------------------------------------- synthèse
def _t(d, sr=SR):
    return np.arange(int(d * sr)) / sr


def _bp(x, lo, hi, sr=SR, order=2):
    return sosfilt(butter(order, [lo / (sr / 2), min(hi, sr / 2 - 100) / (sr / 2)], "band", output="sos"), x)


def _hp(x, f, sr=SR, order=2):
    return sosfilt(butter(order, f / (sr / 2), "high", output="sos"), x)


def _lp(x, f, sr=SR, order=2):
    return sosfilt(butter(order, f / (sr / 2), "low", output="sos"), x)


def synth_kick(decay=0.22, rng=None, sr=SR):
    t = _t(decay * 1.3 + 0.03, sr)
    f = 48 + 150 * np.exp(-t / 0.028)
    body = np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-t * 4.6 / decay)
    click = _hp(rng.standard_normal(len(t)), 2500) * np.exp(-t / 0.003) * 0.35
    x = np.tanh(1.6 * (body + click))
    return (x / np.abs(x).max()).astype(np.float32)


def synth_clap(rng, sr=SR):
    t = _t(0.32, sr)
    env = np.zeros_like(t)
    for k, d in enumerate([0, 0.009, 0.019, 0.031]):
        env += (t >= d) * np.exp(-(t - d).clip(0) / (0.006 if k < 3 else 0.09))
    x = _bp(rng.standard_normal(len(t)), 900, 3200) * env
    return (x / np.abs(x).max()).astype(np.float32)


def synth_hat(rng, length=0.055, sr=SR):
    t = _t(length, sr)
    x = _hp(rng.standard_normal(len(t)), 7500, order=4) * np.exp(-t / (length / 4))
    return (x / np.abs(x).max()).astype(np.float32)


def synth_squeak(rng, sr=SR):
    """Bed squeak : « hiii-haa », deux chirps aigus à harmoniques + un peu de souffle."""
    out = []
    for f0, f1, d in [(1750, 2650, 0.075), (2500, 1500, 0.11)]:
        t = _t(d, sr)
        f = f0 + (f1 - f0) * (t / d) ** 0.7
        ph = 2 * np.pi * np.cumsum(f) / sr
        x = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
        x *= np.sin(np.pi * t / d) ** 0.6
        x += _bp(rng.standard_normal(len(t)), 2000, 6000) * 0.08 * np.sin(np.pi * t / d)
        out += [x, np.zeros(int(0.012 * sr))]
    x = np.concatenate(out)
    return (x / np.abs(x).max()).astype(np.float32)


def synth_crash(rng, sr=SR):
    t = _t(1.8, sr)
    x = _hp(rng.standard_normal(len(t)), 3500) * np.exp(-t * 2.2)
    x += sum(np.sin(2 * np.pi * f * t) * 0.05 for f in rng.uniform(3000, 9000, 12)) * np.exp(-t * 3)
    x *= np.minimum(1, t / 0.002)
    return (x / np.abs(x).max()).astype(np.float32)


def synth_horn(root_pc=0, sr=SR):
    t = _t(0.42, sr)
    f = 440 * 2 ** ((root_pc - 9) / 12) * (1 + 0.006 * np.sin(2 * np.pi * 6 * t))
    x = sum(((2 * ((f * r * t) % 1) - 1) * g) for r, g in [(1, 1), (1.5, 0.7), (2, 0.5)])
    env = np.minimum(1, t / 0.01) * np.exp(-t * 3.5)
    cutoff = np.linspace(4500, 1200, len(t))
    y = np.zeros_like(x)
    for i in range(0, len(x), 512):  # filtre passe-bas qui se referme (par blocs)
        y[i:i + 512] = _lp(x[i:i + 512], cutoff[i])
    y *= env
    return (y / np.abs(y).max()).astype(np.float32)


def synth_siren(bar_sec, sr=SR):
    t = _t(bar_sec * 2, sr)
    f = 900 + 350 * np.sin(2 * np.pi * (2 / bar_sec) * t)
    x = np.sin(2 * np.pi * np.cumsum(f) / sr) * np.minimum(1, t / 0.05) * np.minimum(1, (t[-1] - t) / 0.2)
    return (x * 0.8).astype(np.float32)


def synth_riser(length, rng, sr=SR):
    t = _t(length, sr)
    n = rng.standard_normal(len(t))
    y = np.zeros_like(n)
    blk = 1024
    for i in range(0, len(n), blk):
        fc = 300 * (8000 / 300) ** (i / len(n))
        y[i:i + blk] = _bp(n[i:i + blk], fc * 0.7, fc * 1.3)
    y += 0.3 * np.sin(2 * np.pi * np.cumsum(200 * 8 ** (t / length)) / sr)
    y *= (t / length) ** 2
    return (y / (np.abs(y).max() + 1e-9)).astype(np.float32)


def synth_breath(rng, sr=SR):
    t = _t(0.16, sr)
    x = _bp(rng.standard_normal(len(t)), 700, 3200) * np.sin(np.pi * t / t[-1]) ** 2
    return (x / np.abs(x).max()).astype(np.float32)


class Kit:
    """Jeu de one-shots (synthétisés ou packs utilisateur)."""

    def __init__(self, params: dict, seed: int, key_pc: int = 0, bpm: float = 140, sr=SR):
        rng = np.random.default_rng(seed + 1000)
        g = Grid(bpm, sr)
        self.s = {
            "kick": synth_kick(float(params.get("kick_decay", 0.22)), rng, sr),
            "clap": synth_clap(rng, sr), "hat": synth_hat(rng, sr=sr), "squeak": synth_squeak(rng, sr),
            "crash": synth_crash(rng, sr), "horn": synth_horn(key_pc, sr), "siren": synth_siren(g.bar_sec, sr),
            "breath": synth_breath(rng, sr),
        }
        self.rng = rng
        self.user = []
        pack = ASSETS_DIR / "user_packs"
        for name in list(self.s):
            files = sorted(list(pack.glob(f"{name}*.wav")) + list(pack.glob(f"{name}*.flac")))
            if not files:
                continue
            try:
                self.s[name] = mono(decode(files[0], sr)).astype(np.float32)
                self.user.append(files[0].name)
            except Exception as e:  # pack illisible : on garde la synthèse
                log(f"Pack ignoré ({files[0].name}) : {e}")

    def riser(self, length):
        return synth_riser(length, self.rng)

    def export(self, folder: Path):
        folder.mkdir(parents=True, exist_ok=True)
        for k, v in self.s.items():
            write_wav(folder / f"{k}.wav", v[None, :], subtype="PCM_24")


# ---------------------------------------------------------------------- patterns
def load_patterns() -> dict:
    return load_yaml(CONFIG_DIR / "patterns.yaml")


def ticks_of(patterns: dict, family: str, name: str) -> list[int]:
    fam = patterns.get(family, {})
    if name not in fam:
        name = next(iter(fam))
    return parse_ticks(fam[name])


def roll_ticks(subdivisions) -> list[int]:
    """Un roll sur une mesure : la mesure est découpée en len(subdiv) parts de pas décroissants."""
    out, n = [], len(subdivisions)
    for i, step in enumerate(subdivisions):
        a, b = i * TICKS_PER_BAR // n, (i + 1) * TICKS_PER_BAR // n
        out += list(range(a, b, int(step)))
    return sorted(set(out))


def build_steps(pos: int, length: int) -> int:
    """Pas (en ticks) du kick dans un build qui accélère : noires → croches → triolets."""
    r = pos / max(length, 1)
    return 12 if r < 0.5 else (6 if r < 0.75 else 4)


def drum_events(plan: list[dict], params: dict, patterns: dict, rng: np.random.Generator) -> list[dict]:
    """Construit la liste d'événements (inst, mesure, tick, vélocité, décalage ms)."""
    ev = []
    kp, cp, hp = params["kick_pattern"], params["clap_pattern"], params["hat_pattern"]
    rolls = patterns.get("rolls", {})
    kroll = rolls.get("kick_roll", {"subdivisions": [4, 3, 2]})["subdivisions"]
    croll = rolls.get("clap_roll", {"subdivisions": [6, 4, 3]})["subdivisions"]
    hum = float(params.get("humanize_ms", 3))
    swing = float(params.get("swing", 0))
    fxd, sq = float(params.get("fx_density", 0.4)), float(params.get("squeak_amount", 0.5))

    def add(inst, bar, tick, vel, jitter=1.0, swingable=False, **kw):
        off = rng.uniform(-hum, hum) * jitter if hum > 0 else 0.0
        t = tick + (swing * 3 if swingable and tick % 6 == 3 else 0)
        ev.append({"inst": inst, "bar": bar, "tick": float(t), "vel": float(np.clip(vel, 0.05, 1)), "off_ms": float(off), **kw})

    for b, bar in enumerate(plan):
        pos, L = bar["pos"], bar["len"]
        last = pos == L - 1
        # --- kick
        k = bar.get("kick")
        if k is True:
            for t in ticks_of(patterns, "kick", kp):
                add("kick", b, t, 1.0 if t == 0 else 0.9, jitter=0.4)
        elif k == "build":
            ts = roll_ticks(kroll) if last else list(range(0, TICKS_PER_BAR, build_steps(pos, L)))
            for i, t in enumerate(ts):
                add("kick", b, t, 0.55 + 0.45 * (pos + i / len(ts)) / L, jitter=0.4)
        # --- clap
        c = bar.get("clap")
        if c is True:
            for t in ticks_of(patterns, "clap", cp):
                add("clap", b, t, 0.95, jitter=0.8)
        elif c == "roll":
            if last:
                ts = roll_ticks(croll)
            elif pos >= L // 2:
                ts = list(range(0, TICKS_PER_BAR, 12))
            else:
                ts = ticks_of(patterns, "clap", "backbeat")
            for i, t in enumerate(ts):
                add("clap", b, t, 0.5 + 0.4 * (i / len(ts)) * (pos + 1) / L, jitter=0.8)
        # --- hats
        if bar.get("hats"):
            for i, t in enumerate(ticks_of(patterns, "hats", hp)):
                accent = 0.85 if t % 12 == 0 else (0.6 if t % 6 == 0 else 0.42)
                add("hat", b, t, accent * rng.uniform(0.8, 1.1), jitter=1.0, swingable=True,
                    pan=0.25)
        # --- FX
        fx = bar.get("fx", [])
        if "crash" in fx and pos == 0:
            add("crash", b, 0, 0.8, jitter=0)
        if "riser" in fx and pos == 0:
            add("riser", b, 0, 0.55, jitter=0, length_bars=L)
        if "siren" in fx and pos == L - 2 and rng.random() < 0.3 + fxd:
            add("siren", b, 0, 0.35, jitter=0)
        if "squeak" in fx and sq > 0.02:
            kt = ticks_of(patterns, "kick", kp) + [TICKS_PER_BAR]
            gaps = sorted(zip(np.diff(kt), kt[:-1]), reverse=True)[:2]  # les 2 plus grands trous
            spots = sorted(int(a + g // 2) // 3 * 3 for g, a in gaps) if bar.get("kick") else [12, 36]
            for t in spots:
                if rng.random() < sq:
                    add("squeak", b, t, 0.35 + 0.4 * sq, jitter=0.5, pan=rng.choice([-0.35, 0.35]))
        if "horn" in fx and fxd > 0.02 and (pos % 8 == 0) and rng.random() < 0.35 + fxd:
            add("horn", b, 0, 0.45, jitter=0)
        if "breath" in fx and fxd > 0.02:
            for t in (21, 45):
                if rng.random() < fxd * 0.6:
                    add("breath", b, t, 0.4, jitter=0.5, pan=rng.uniform(-0.4, 0.4))
    return ev


GAINS = {"kick": 1.0, "clap": 0.55, "hat": 0.28, "crash": 0.32, "squeak": 0.3, "horn": 0.28,
         "siren": 0.18, "breath": 0.22, "riser": 0.3}
DRUM_BUS = {"kick", "clap", "hat", "crash"}


def render_drums(events, kit: Kit, grid: Grid, n: int) -> dict:
    """Rend les événements → bus {'kick','drums','fx'} + temps théoriques des kicks."""
    buses = {k: np.zeros((2, n), np.float32) for k in ("kick", "drums", "fx")}
    kick_times = []
    for e in events:
        inst = e["inst"]
        s = grid.tick_to_sample(e["bar"], e["tick"]) + int(round(e["off_ms"] / 1000 * grid.sr))
        if inst == "riser":
            x = kit.riser(e.get("length_bars", 8) * grid.bar_sec)
        else:
            x = kit.s[inst]
        gl, gr = pan_gains(e.get("pan", 0.0))
        xs = np.vstack([x * gl, x * gr]) * np.sqrt(2)
        g = GAINS[inst] * e["vel"]
        if inst == "kick":
            add_at(buses["kick"], xs, s, g)
            kick_times.append(s / grid.sr)
        elif inst in DRUM_BUS:
            add_at(buses["drums"], xs, s, g)
        else:
            add_at(buses["fx"], xs, s, g)
    buses["kick_times"] = np.array(sorted(kick_times))
    return buses


def export_midi(events, bpm: float, path) -> None:
    """Exporte le pattern de batterie en MIDI (canal 10 GM)."""
    tpb = 480
    per_tick = tpb // 12
    mid = mido.MidiFile(ticks_per_beat=tpb)
    tr = mido.MidiTrack()
    mid.tracks.append(tr)
    tr.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0))
    tr.append(mido.MetaMessage("track_name", name="jersey drums", time=0))
    msgs = []
    for e in events:
        t = int(round((e["bar"] * TICKS_PER_BAR + e["tick"]) * per_tick))
        note = GM[e["inst"]]
        v = int(np.clip(e["vel"] * 127, 1, 127))
        msgs += [(t, 1, mido.Message("note_on", channel=9, note=note, velocity=v)),
                 (t + per_tick, 0, mido.Message("note_off", channel=9, note=note, velocity=0))]
    msgs.sort(key=lambda m: (m[0], m[1]))
    last = 0
    for t, _, m in msgs:
        m.time = t - last
        last = t
        tr.append(m)
    mid.save(str(path))


def main():
    ap = argparse.ArgumentParser(description="Synthèse des one-shots et démo des patterns Jersey club.")
    ap.add_argument("--oneshots", action="store_true", help="écrit les one-shots dans assets/oneshots/")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("-o", "--sortie", default="demo_drums.wav")
    ap.add_argument("--bpm", type=float, default=140)
    a = ap.parse_args()
    params = {"kick_decay": 0.22, "kick_pattern": "bounce_classique", "clap_pattern": "backbeat",
              "hat_pattern": "doubles", "humanize_ms": 2, "swing": 0.05, "fx_density": 0.4, "squeak_amount": 0.5}
    kit = Kit(params, 0, bpm=a.bpm)
    if a.oneshots:
        kit.export(ASSETS_DIR / "oneshots")
        log(f"One-shots écrits dans {ASSETS_DIR / 'oneshots'}")
    if a.demo:
        pats = load_patterns()
        plan = []
        for name in pats["kick"]:
            for p in range(4):
                plan.append({"pos": p, "len": 4, "kick": True, "clap": True, "hats": True, "fx": ["squeak"], "_k": name})
        g = Grid(a.bpm)
        evs = []
        rng = np.random.default_rng(0)
        for i in range(0, len(plan), 4):
            pr = dict(params, kick_pattern=plan[i]["_k"])
            sub = drum_events(plan[i:i + 4], pr, pats, rng)
            for e in sub:
                e["bar"] += i
            evs += sub
        buses = render_drums(evs, kit, g, g.bar_start(len(plan)) + SR)
        y = buses["kick"] + buses["drums"] + buses["fx"]
        write_wav(a.sortie, y / np.abs(y).max() * 0.9)
        log(f"Démo écrite : {a.sortie}")


if __name__ == "__main__":
    main()
