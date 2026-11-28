#!/usr/bin/env python3
"""Ingestion d'un VRAI morceau Jersey club fourni par l'utilisateur (fichier local).

Extrait : BPM exact, patterns de kick / clap / hats (onsets du stem batterie → grille de
48 ticks → pattern le plus fréquent par mesure), densité de chops (onsets voix par
temps), profil spectral moyen (5 bandes), LUFS, plage dynamique, durée, structure.
Stocke l'ANALYSE en JSON dans memory/references/ (jamais l'audio). Les patterns
nouveaux rejoignent config/patterns.yaml avec leur source et un score ; un pattern déjà
connu voit son score augmenter. Les moyennes des références recentrent les défauts.

CLI : reference.py <fichier> [--fast] [--nom mon_ref]
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

import librosa
import numpy as np
from scipy.signal import butter, sosfiltfilt

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jc_common as jc  # noqa: E402
from jc_common import SR, TICKS_PER_BAR, Grid, log, mono  # noqa: E402

BANDES_DRUMS = {"kick": (30, 150), "clap": (900, 4000), "hats": (7000, 16000)}


def band_onsets(y, lo, hi, sr=SR, rel=0.25):
    """Attaques dans une bande : pics de flux au-dessus de `rel` × le 95e centile des pics."""
    if lo <= 40:
        from scipy.signal import hilbert
        from evaluate import detect_kicks
        cand = detect_kicks(y, sr)
        xb = sosfiltfilt(butter(4, [30 / (sr / 2), 150 / (sr / 2)], "band", output="sos"), mono(y))
        amp = np.abs(hilbert(xb, N=1 << int(np.ceil(np.log2(len(xb)))))[: len(xb)])
        a15, a20 = int(0.015 * sr), int(0.02 * sr)
        peak = np.array([amp[int(t * sr):int(t * sr) + a15].max(initial=0) for t in cand])
        before = np.array([amp[max(0, int(t * sr) - a20):int(t * sr)].mean() if int(t * sr) > 0 else 0 for t in cand])
        if len(cand) == 0:
            return cand
        keep = (peak >= 0.45 * np.percentile(peak, 90)) & (peak > 1.5 * before)
        return cand[keep]
    x = sosfiltfilt(butter(4, [lo / (sr / 2), min(hi, sr / 2 - 200) / (sr / 2)], "band", output="sos"), mono(y))
    env = librosa.onset.onset_strength(y=x, sr=sr, hop_length=64, lag=1, max_size=1)
    pk = librosa.util.peak_pick(env, pre_max=8, post_max=8, pre_avg=30, post_avg=5, delta=env.max() * 0.03, wait=8)
    if len(pk) == 0:
        return np.array([])
    thr = rel * np.percentile(env[pk], 95)
    pk = pk[env[pk] >= thr]
    return librosa.frames_to_time(pk, sr=sr, hop_length=64)


def pattern_from_onsets(times, grid: Grid, n_bars: int, min_hits=2):
    """Pattern par vote : ticks présents dans ≥ 50 % des mesures suffisamment remplies.

    Renvoie (ticks, part des mesures dont le contenu correspond exactement au pattern).
    """
    bars = [set() for _ in range(n_bars)]
    for t in times:
        tick = t / grid.tick_sec
        b = int(np.floor((tick + 0.5) / TICKS_PER_BAR))
        if 0 <= b < n_bars:
            bars[b].add(int(round(tick - b * TICKS_PER_BAR)) % TICKS_PER_BAR)
    full = [b for b in bars if len(b) >= min_hits]
    if not full:
        return None, 0.0
    cnt = Counter(t for b in full for t in b)
    pat = sorted(t for t, c in cnt.items() if c >= 0.5 * len(full))
    if not pat:
        return None, 0.0
    exact = sum(set(pat) == b for b in full) / len(full)
    return pat, exact


def best_rotation(kick_ticks, known: list) -> int:
    """Décalage (en ticks, multiple d'un temps) qui corrige une erreur de downbeat.

    1) une rotation qui retrouve un pattern connu l'emporte ; 2) sinon : kick sur le 1 et
    densité maximale dans le dernier temps (hypothèse Jersey : rafale en fin de mesure).
    """
    rots = [0, 12, 24, 36]
    rot = lambda ts, r: sorted((t + r) % TICKS_PER_BAR for t in ts)  # noqa: E731
    for r in rots:
        if rot(kick_ticks, r) in known:
            return r
    def score(r):
        ts = rot(kick_ticks, r)
        return (0 in ts, sum(t >= 36 for t in ts), -r)
    return max(rots, key=score)


def update_patterns(family: str, ticks: list[int], source: str, share: float) -> str:
    """Ajoute (ou renforce) un pattern dans patterns.yaml en préservant les commentaires."""
    path = jc.CONFIG_DIR / "patterns.yaml"
    pats = jc.load_yaml(path)
    for name, spec in pats.get(family, {}).items():
        if jc.parse_ticks(spec) == sorted(ticks):
            txt = path.read_text(encoding="utf-8")
            pat = re.compile(rf"^(\s+{re.escape(name)}:.*score: )([0-9.]+)", re.M)
            txt = pat.sub(lambda m: f"{m.group(1)}{float(m.group(2)) + 0.5:.2f}", txt, count=1)
            path.write_text(txt, encoding="utf-8")
            return f"{name} (existant, score +0.5)"
    name = f"ref_{jc.slug_simple(source)}"[:40] if hasattr(jc, "slug_simple") else "ref_" + re.sub(r"\W+", "_", source)[:30]
    line = f"  {name}: {{ticks: {sorted(ticks)}, source: \"référence {source}\", score: {1.0 + share:.2f}}}"
    lines = path.read_text(encoding="utf-8").splitlines()
    i = next(i for i, l in enumerate(lines) if l.startswith(f"{family}:"))
    j = i + 1
    while j < len(lines) and lines[j].startswith("  "):
        j += 1
    lines.insert(j, line)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return f"{name} (nouveau)"


def analyze_reference(path: Path, fast: bool = False, nom: str | None = None) -> dict:
    from analyze import analyze_bars, analyze_tempo
    from evaluate import band_profile, lufs
    from separate import separate
    from stretch import align_stems
    nom = nom or re.sub(r"\W+", "_", path.stem)[:40]
    y = jc.decode(path)
    t = analyze_tempo(y, SR)
    bpm = t["bpm"]
    log(f"Référence {path.name} : {bpm:.2f} BPM")
    stems = separate((y / (np.abs(y).max() + 1e-9) * 0.9).astype(np.float32), SR, fast=fast)
    al, _ = align_stems(stems, t, bpm)  # recalage sur sa propre grille (tempo exact)
    g = Grid(bpm)
    n_bars = int(al["drums"].shape[1] // round(g.bar_sec * SR))
    res = {"nom": nom, "fichier": path.name, "analyse_le": jc.now_iso(), "bpm": round(bpm, 3),
           "duree_s": round(y.shape[1] / SR, 1), "n_mesures": n_bars, "patterns": {}}
    for fam, (lo, hi) in BANDES_DRUMS.items():
        on = band_onsets(al["drums"], lo, hi)
        ticks, share = pattern_from_onsets(on, g, n_bars, 2 if fam != "hats" else 4)
        if ticks:
            res["patterns"][fam] = {"ticks": ticks, "part_des_mesures": round(share, 3)}
    v_on = librosa.onset.onset_detect(y=mono(al["vocals"]), sr=SR, units="time")
    if "kick" in res["patterns"]:
        known = [jc.parse_ticks(v) for v in jc.load_yaml(jc.CONFIG_DIR / "patterns.yaml").get("kick", {}).values()]
        r = best_rotation(res["patterns"]["kick"]["ticks"], known)
        res["rotation_downbeat_ticks"] = r
        for fam in res["patterns"]:
            res["patterns"][fam]["ticks"] = sorted((t + r) % TICKS_PER_BAR for t in res["patterns"][fam]["ticks"])
    res["onsets_voix_par_temps"] = round(len(v_on) / max(1, n_bars * 4), 3)
    res["densite_chops"] = float(np.clip(res["onsets_voix_par_temps"] / 2, 0.1, 1.0))
    res["bandes_db"] = band_profile(y)
    res["lufs"] = round(lufs(y), 2)
    meter_win = int(3 * SR)
    import pyloudnorm as pyln
    mtr = pyln.Meter(SR)
    st = [mtr.integrated_loudness(y[:, i:i + meter_win].T.astype(np.float64)) for i in range(0, y.shape[1] - meter_win, meter_win)]
    st = [x for x in st if np.isfinite(x) and x > -70]
    res["plage_dynamique_lu"] = round(float(np.percentile(st, 95) - np.percentile(st, 10)), 2) if len(st) > 3 else None
    mix = al["vocals"] + al["drums"] + al["bass"] + al["other"]
    bars = analyze_bars(mix, al["other"] + al["bass"], al["vocals"], g)
    res["structure"] = bars["segments"]
    res["tonalite"] = bars["tonalite"]["nom"]
    res["patterns_ajoutes"] = {}
    for fam, p in res["patterns"].items():
        if fam == "hats":
            # un pattern de hats est rarement « propre » : on le classe plutôt qu'on l'ajoute
            t3 = sum(x % 3 == 0 for x in p["ticks"]) / len(p["ticks"])
            t2 = sum(x % 2 == 0 for x in p["ticks"]) / len(p["ticks"])
            res["hats_style"] = "doubles" if t3 >= t2 else "triolets_dbl"
            continue
        if len(p["ticks"]) >= 2:
            res["patterns_ajoutes"][fam] = update_patterns(fam, p["ticks"], nom, p["part_des_mesures"])
    jc.save_json(jc.MEMORY_DIR / "references" / f"{nom}.json", res)
    return res


def main():
    ap = argparse.ArgumentParser(description="Analyse un morceau Jersey club de référence (fichier local).")
    ap.add_argument("fichier")
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--nom", default=None)
    a = ap.parse_args()
    r = analyze_reference(Path(a.fichier), a.fast, a.nom)
    print(f"Référence « {r['nom']} » : {r['bpm']} BPM, {r['lufs']} LUFS, tonalité {r['tonalite']}, "
          f"densité de chops {r['densite_chops']:.2f}")
    for fam, p in r["patterns"].items():
        print(f"  {fam} : {p['ticks']} ({p['part_des_mesures'] * 100:.0f} % des mesures)")
    for fam, s in r["patterns_ajoutes"].items():
        print(f"  → patterns.yaml [{fam}] : {s}")
    print(f"Analyse enregistrée : memory/references/{r['nom']}.json (aucun audio stocké)")


if __name__ == "__main__":
    main()
