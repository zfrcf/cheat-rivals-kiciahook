#!/usr/bin/env python3
"""Arrangement : construit le plan mesure par mesure à partir d'un gabarit YAML.

- Gabarits courts (config/arrangements/court*.yaml) : sections fixes, chaque mesure
  puise dans le hook (mesure source = début du hook + position modulo longueur).
- Gabarit complet : suit les segments du morceau ; le segment du hook devient un drop,
  les 4 mesures qui précèdent un drop deviennent un build, le premier segment l'intro,
  le dernier l'outro, le reste des couplets.

Chaque mesure du plan : section, pos, len, src_bar, voix, instru, kick, clap, hats,
chops, basse, fx, fondu. Le rendu des couches source se fait par copie de mesures avec
fondus complémentaires (reconstruction parfaite quand les mesures sont contiguës).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jc_common import CONFIG_DIR, Grid, load_yaml  # noqa: E402

LAYERS = ["voix", "instru", "hats", "kick", "clap", "chops", "basse", "fx", "fondu"]


def load_template(name: str) -> dict:
    p = CONFIG_DIR / "arrangements" / f"{name}.yaml"
    if not p.exists():
        raise FileNotFoundError(f"Gabarit d'arrangement introuvable : {p}")
    return load_yaml(p)


def plan_court(tpl: dict, hook: dict) -> list[dict]:
    H = max(1, hook["fin"] - hook["debut"])
    plan = []
    for sec in tpl["sections"]:
        L = int(sec["mesures"])
        for pos in range(L):
            bar = {"section": sec["nom"], "pos": pos, "len": L, "src_bar": hook["debut"] + pos % H}
            for k in LAYERS:
                bar[k] = sec.get(k, [] if k == "fx" else False)
            plan.append(bar)
    return plan


def plan_complet(tpl: dict, segments: list, hook: dict, n_bars: int) -> list[dict]:
    types = ["couplet"] * n_bars
    hook_lab = hook["label"]
    for sg in segments:
        if sg["label"] == hook_lab or (sg["debut"] < hook["fin"] and sg["fin"] > hook["debut"]):
            for b in range(sg["debut"], sg["fin"]):
                types[b] = "drop"
    if segments and types[0] != "drop":
        for b in range(segments[0]["debut"], min(segments[0]["fin"], 8)):
            types[b] = "intro"
    last = segments[-1] if segments else None
    if last and types[last["debut"]] != "drop":
        for b in range(max(last["debut"], n_bars - 8), n_bars):
            types[b] = "outro"
    for b in range(1, n_bars):  # build = 4 mesures avant chaque drop
        if types[b] == "drop" and types[b - 1] != "drop":
            for k in range(max(0, b - 4), b):
                if types[k] != "drop":
                    types[k] = "build"
    plan, b = [], 0
    while b < n_bars:
        e = b
        while e < n_bars and types[e] == types[b]:
            e += 1
        spec = tpl["types"][types[b]]
        for pos in range(e - b):
            bar = {"section": f"{types[b]}@{b}", "pos": pos, "len": e - b, "src_bar": b + pos}
            for k in LAYERS:
                bar[k] = spec.get(k, [] if k == "fx" else False)
            plan.append(bar)
        b = e
    return plan


def build_plan(length: str, template: str, analysis: dict) -> list[dict]:
    if length == "complet":
        return plan_complet(load_template("complet"), analysis["segments"], analysis["hook"], analysis["n_mesures"])
    return plan_court(load_template(template), analysis["hook"])


def sections_of(plan: list[dict], grid: Grid) -> list[dict]:
    out = []
    for i, bar in enumerate(plan):
        if bar["pos"] == 0:
            out.append({"nom": bar["section"].split("@")[0], "debut_mesure": i, "mesures": bar["len"],
                        "debut_s": round(i * grid.bar_sec, 2)})
    return out


def render_source_layer(stem: np.ndarray, plan: list[dict], grid: Grid, n: int, layer: str, modes) -> np.ndarray:
    """Copie, mesure par mesure, les mesures source dont la couche `layer` ∈ modes."""
    buf = np.zeros((2, n), np.float32)
    xf = int(0.006 * grid.sr)
    h = xf // 2
    ramp_in = np.linspace(0, 1, xf, dtype=np.float32)
    for i, bar in enumerate(plan):
        if bar.get(layer) not in modes or bar.get("src_bar") is None:
            continue
        s, e = grid.bar_start(bar["src_bar"]), grid.bar_start(bar["src_bar"] + 1)
        a = s - h
        if a < 0 or e + h > stem.shape[1]:
            continue
        seg = stem[:, a:e + h].copy()
        seg[:, :xf] *= ramp_in
        seg[:, -xf:] *= ramp_in[::-1]
        o = grid.bar_start(i) - h
        if o < 0:
            seg, o = seg[:, -o:], 0
        m = min(seg.shape[1], n - o)
        if m > 0:
            buf[:, o:o + m] += seg[:, :m]
    return buf
