#!/usr/bin/env python3
"""Résumé lisible de ce que le skill a appris.

Affiche : nombre de retours (global, par profil), références, règles actives, top
patterns par profil, paramètres stabilisés ou encore incertains, derniers snapshots.
CLI : status.py [--profil rap] [--json]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jc_common as jc  # noqa: E402
import params as P  # noqa: E402


def collect(profil_filtre: str | None = None) -> dict:
    prefs = P.load_preferences()
    specs = P.param_specs()
    st = P.style()
    min_n = st.get("apprentissage", {}).get("min_retours_resserrage", 3)
    out = {"retours": prefs.get("n_retours", {}), "references": P.references_summary(),
           "regles_actives": P.load_rules(), "profils": {}}
    for prof, entries in prefs.get("profils", {}).items():
        if profil_filtre and prof not in (profil_filtre, "*"):
            continue
        nret = prefs["n_retours"].get(prof, 0)
        d = {"top": {}, "stabilises": [], "incertains": []}
        for k, e in entries.items():
            s = specs.get(k)
            if not s:
                continue
            if s["type"] == "categoriel":
                sc = {o: e["alpha"][o] / (e["alpha"][o] + e["beta"][o]) for o in e["alpha"]}
                d["top"][k] = sorted(sc.items(), key=lambda x: -x[1])[:3]
            else:
                rel = e["ecart_type"] / (s["max"] - s["min"])
                item = f"{k} ≈ {e['moyenne']:.3g} (±{e['ecart_type']:.2g})"
                (d["stabilises"] if rel < 0.1 and nret >= min_n else d["incertains"]).append(item)
        out["profils"][prof] = d
    out["snapshots"] = sorted(p.name for p in (jc.MEMORY_DIR / "history").glob("*") if p.is_dir())[-5:]
    return out


def render(c: dict) -> str:
    r = c["retours"]
    L = ["=== État d'apprentissage du skill jersey-club ===",
         f"Retours : {r.get('*', 0)} au total" + (" (" + ", ".join(f"{k} : {v}" for k, v in r.items() if k != "*") + ")" if len(r) > 1 else ""),
         f"Références analysées : {c['references'].get('n', 0)}" +
         (f" (BPM moyen {c['references']['bpm']:.1f}, LUFS moyen {c['references'].get('lufs', float('nan')):.1f})" if c["references"].get("bpm") else "")]
    L.append(f"Règles actives ({len(c['regles_actives'])}) :")
    for x in c["regles_actives"]:
        L.append(f"  - [{x['date'][:10]}] {x['profil']} · {x['param']} {x['dir']}" + (f" (cible {x['cible']})" if x.get("cible") else "") + f" — {x.get('note') or ''}")
    if not c["regles_actives"]:
        L.append("  (aucune)")
    if not c["profils"]:
        L.append("Aucune préférence apprise pour l'instant : les rendus utilisent les défauts (± références).")
    for prof, d in c["profils"].items():
        L.append(f"Profil « {prof} » :")
        for k in ("kick_pattern", "bass_mode", "pitch_mode", "hat_pattern", "chop_pitch_shift"):
            if k in d["top"]:
                L.append(f"  {k} : " + ", ".join(f"{o} {s:.2f}" for o, s in d["top"][k]))
        L.append("  stabilisés : " + (", ".join(d["stabilises"]) or "aucun"))
        L.append("  incertains : " + (", ".join(d["incertains"][:8]) or "aucun") + (" …" if len(d["incertains"]) > 8 else ""))
    L.append("Derniers snapshots : " + (", ".join(c["snapshots"]) or "aucun"))
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description="Affiche ce que le skill a appris.")
    ap.add_argument("--profil", default=None)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    c = collect(a.profil)
    print(json.dumps(c, ensure_ascii=False, indent=1, default=str) if a.json else render(c))


if __name__ == "__main__":
    main()
