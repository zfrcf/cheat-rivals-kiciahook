#!/usr/bin/env python3
"""Résolution des paramètres d'un rendu à partir de la mémoire du skill.

Ordre de priorité (du plus faible au plus fort) :
1. défauts de config/style_profile.yaml ;
2. recentrage par les références (memory/references/*.json), poids n/(n+2) ;
3. préférences apprises (memory/preferences.json), par profil de source, repli sur « * » ;
4. règles explicites (memory/lessons.md) — elles priment sur les statistiques ;
5. options CLI (--bpm, --pitch) — décision explicite de l'utilisateur pour CE rendu.

Variantes : A = exploitation (meilleure valeur connue), B = exploration (tirage dans les
distributions apprises, ≥ 15 % hors optimum), C = joker (un paramètre structurant change
franchement).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jc_common as jc  # noqa: E402

RULE_RE = re.compile(r"^- \[(?P<date>[^\]]+)\] profil=(?P<profil>\S+) param=(?P<param>\S+) "
                     r"direction=(?P<dir>\S+)(?: cible=(?P<cible>\S+))?(?: \| (?P<note>.*))?$")


def style() -> dict:
    return jc.load_yaml(jc.CONFIG_DIR / "style_profile.yaml")


def param_specs() -> dict:
    """Spécifications des paramètres ; les options de patterns viennent de patterns.yaml."""
    st = style()
    specs = st["parametres"]
    pats = jc.load_yaml(jc.CONFIG_DIR / "patterns.yaml")
    for p, fam in (("kick_pattern", "kick"), ("clap_pattern", "clap"), ("hat_pattern", "hats")):
        specs[p]["options"] = list(pats.get(fam, {}).keys())
    tpl = sorted(f.stem for f in (jc.CONFIG_DIR / "arrangements").glob("*.yaml") if f.stem != "complet")
    specs["arrangement_template"]["options"] = tpl
    return specs


def pattern_prior(param: str, opt) -> float:
    fam = {"kick_pattern": "kick", "clap_pattern": "clap", "hat_pattern": "hats"}.get(param)
    if not fam:
        return 1.0
    p = jc.load_yaml(jc.CONFIG_DIR / "patterns.yaml").get(fam, {}).get(opt, {})
    return float(p.get("score", 1.0)) if isinstance(p, dict) else 1.0


# ------------------------------------------------------------------ mémoire
def load_preferences() -> dict:
    return jc.load_json(jc.MEMORY_DIR / "preferences.json", {"version": 1, "n_retours": {}, "profils": {}})


def load_rules(include_archived=False) -> list[dict]:
    p = jc.MEMORY_DIR / "lessons.md"
    if not p.exists():
        return []
    rules, section = [], None
    for line in p.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            section = "active" if "actives" in line.lower() else "archive"
            continue
        m = RULE_RE.match(line.strip())
        if m and (section == "active" or include_archived):
            d = m.groupdict()
            d["statut"] = section
            rules.append(d)
    return rules


def references_summary() -> dict:
    refs = [jc.load_json(f) for f in sorted((jc.MEMORY_DIR / "references").glob("*.json"))]
    refs = [r for r in refs if r]
    if not refs:
        return {"n": 0}
    out = {"n": len(refs)}
    for k in ("bpm", "lufs", "densite_chops"):
        vals = [r[k] for r in refs if r.get(k) is not None]
        if vals:
            out[k] = float(np.mean(vals))
    bands = [r["bandes_db"] for r in refs if r.get("bandes_db")]
    if bands:
        out["bandes_db"] = {k: float(np.mean([b[k] for b in bands])) for k in bands[0]}
    return out


def defaults_with_refs(specs: dict) -> tuple[dict, dict]:
    """Défauts recentrés par les références. Renvoie (valeurs, provenance)."""
    vals = {k: s["defaut"] for k, s in specs.items()}
    prov = {k: "défaut" for k in specs}
    ref = references_summary()
    n = ref.get("n", 0)
    if n:
        w = n / (n + 2)
        mapping = {"bpm_target": ref.get("bpm"), "lufs_target": ref.get("lufs"), "chop_density": ref.get("densite_chops")}
        for k, rv in mapping.items():
            if rv is None:
                continue
            s = specs[k]
            vals[k] = float(np.clip((1 - w) * vals[k] + w * rv, s["min"], s["max"]))
            prov[k] = f"référence ({n})"
    return vals, prov


def learned_entry(prefs: dict, profil: str, param: str):
    """Entrée apprise pour un profil ; repli sur « * » si le profil a < 2 retours."""
    pp = prefs.get("profils", {})
    e = pp.get(profil, {}).get(param)
    n_prof = prefs.get("n_retours", {}).get(profil, 0)
    if e is not None and n_prof >= 2:
        return e, profil
    g = pp.get("*", {}).get(param)
    if g is not None:
        return g, "*"
    return e, profil if e is not None else None


def active_rules_for(profil: str) -> dict:
    """Règle applicable par paramètre : la plus spécifique, puis la plus récente."""
    best = {}
    for r in load_rules():
        if r["profil"] not in ("*", profil):
            continue
        cur = best.get(r["param"])
        key = (r["profil"] != "*", r["date"])
        if cur is None or key >= (cur["profil"] != "*", cur["date"]):
            best[r["param"]] = r
    return best


def _cast(spec, v):
    if spec["type"] == "continu":
        return float(v)
    for o in spec["options"]:
        if str(o) == str(v):
            return o
    try:
        return type(spec["options"][0])(v)
    except Exception:
        return v


def apply_rule(spec: dict, value, rule: dict):
    d = rule["dir"]
    if d.startswith("="):
        return _cast(spec, d[1:])
    if d.startswith("!"):
        if str(value) == d[1:] and spec["type"] == "categoriel":
            others = [o for o in spec["options"] if str(o) != d[1:]]
            return others[0] if others else value
        return value
    if spec["type"] == "continu" and rule.get("cible") not in (None, ""):
        c = float(rule["cible"])
        return max(value, c) if d == "+" else min(value, c)
    return value


# ------------------------------------------------------------------ résolution
def resolve(profil: str, variante: str, rng: np.random.Generator, cli: dict | None = None) -> tuple[dict, dict]:
    """Paramètres + provenance pour une variante A/B/C."""
    st = style()
    specs = param_specs()
    learn_cfg = st.get("apprentissage", {})
    explo = float(learn_cfg.get("exploration_min", 0.15))
    prefs = load_preferences()
    base, prov = defaults_with_refs(specs)
    rules = active_rules_for(profil)
    params = {}
    for k, s in specs.items():
        e, src = learned_entry(prefs, profil, k)
        if s["type"] == "continu":
            lo, hi = s["min"], s["max"]
            mean = e["moyenne"] if e else base[k]
            sd = e["ecart_type"] if e else learn_cfg.get("std_initial_frac", 0.2) * (hi - lo)
            if e:
                prov[k] = f"appris ({src}, n={e.get('n', 0)})"
            if variante == "B":
                if rng.random() < explo:
                    v = rng.uniform(lo, hi)
                    prov[k] += " · exploration"
                else:
                    v = rng.normal(mean, sd)
                    prov[k] += " · tirage"
            else:
                v = mean
            params[k] = float(np.clip(v, lo, hi))
        else:
            opts = s["options"]
            a = {o: (e["alpha"].get(str(o), pattern_prior(k, o)) if e else pattern_prior(k, o)) for o in opts}
            b = {o: (e["beta"].get(str(o), 1.0) if e else 1.0) for o in opts}
            if e:
                prov[k] = f"appris ({src})"
            means = {o: a[o] / (a[o] + b[o]) for o in opts}
            best = max(opts, key=lambda o: (means[o], str(o) == str(base[k])))
            if not e:
                best = _cast(s, base[k]) if any(str(o) == str(base[k]) for o in opts) else best
            if variante == "B" and len(opts) > 1:
                if rng.random() < explo:
                    v = opts[int(rng.integers(0, len(opts)))]
                    while str(v) == str(best):
                        v = opts[int(rng.integers(0, len(opts)))]
                    prov[k] += " · exploration"
                else:
                    draws = {o: rng.beta(a[o], b[o]) for o in opts}
                    v = max(opts, key=lambda o: draws[o])
                    prov[k] += " · Thompson"
            else:
                v = best
            params[k] = v
        if k in rules:
            nv = apply_rule(s, params[k], rules[k])
            if str(nv) != str(params[k]) or rules[k]["dir"].startswith("="):
                prov[k] = f"règle du {rules[k]['date']} ({rules[k]['dir']})"
            params[k] = nv
    if variante == "C":
        cands = [j for j in st.get("joker", []) if not (j in rules and rules[j]["dir"].startswith("="))
                 and len(specs[j].get("options", [])) > 1]
        if cands:
            j = cands[int(rng.integers(0, len(cands)))]
            others = [o for o in specs[j]["options"] if str(o) != str(params[j])]
            params[j] = others[int(rng.integers(0, len(others)))]
            prov[j] = "joker (variante C)"
            params["_joker"] = j
    for k, v in (cli or {}).items():
        if v is not None:
            params[k] = v
            prov[k] = "option CLI"
    return params, prov


def describe_difference(pa: dict, pb: dict, specs: dict | None = None) -> str:
    specs = specs or param_specs()
    diffs = []
    for k, s in specs.items():
        va, vb = pa.get(k), pb.get(k)
        if s["type"] == "continu":
            if abs(float(va) - float(vb)) > 0.08 * (s["max"] - s["min"]):
                diffs.append(f"{k} {float(vb):.2f} (A : {float(va):.2f})")
        elif str(va) != str(vb):
            diffs.append(f"{k} = {vb} (A : {va})")
    return ", ".join(diffs[:4]) if diffs else "proche de A"
