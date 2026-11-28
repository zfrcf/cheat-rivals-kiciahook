#!/usr/bin/env python3
"""Apprentissage explicite à partir des retours de l'utilisateur.

Trois sources, par priorité :
1. commentaires → règles datées dans memory/lessons.md (via config/lexique.yaml ou --regle) ;
2. notes 1-5 des variantes → memory/preferences.json, par profil de source ET global « * » :
   - continus : moyenne mobile exponentielle pondérée par la note, écart-type qui se
     resserre quand les valeurs bien notées convergent (plancher tant que < 3 retours) ;
   - catégoriels : Beta(α, β) par option (Thompson sampling au rendu) ;
   - comparatifs (« B>A », préférée) : bonus/malus sur ce qui diffère ;
3. références (reference.py) : agissent sur les défauts, pas ici.
Avant chaque mise à jour : snapshot de preferences.json + lessons.md dans memory/history/.

Exemples :
  learn.py --dossier jersey_out/titre --notes A=4,B=2,C=5 --preferee C --commentaire "kick trop sec"
  learn.py --feedback jersey_out/titre/feedback.md
  learn.py --regle "chop_density:-" --profil rap --note "trop de chops dans le 2e drop"
  learn.py --historique        |   learn.py --rollback 2026-11-28T14:03:12
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
import unicodedata
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jc_common as jc  # noqa: E402
import params as P  # noqa: E402


def norm_txt(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.replace("’", "'")


# ------------------------------------------------------------------ snapshots
def hist_dir() -> Path:
    return jc.MEMORY_DIR / "history"


def snapshot(raison: str = "") -> str:
    ts = jc.now_iso().replace(":", "-")
    d = hist_dir() / ts
    k = 1
    while d.exists():
        d = hist_dir() / f"{ts}_{k}"
        k += 1
    d.mkdir(parents=True)
    for f in ("preferences.json", "lessons.md"):
        src = jc.MEMORY_DIR / f
        if src.exists():
            shutil.copy2(src, d / f)
        else:
            (d / f"{f}.absent").write_text("")
    (d / "raison.txt").write_text(raison, encoding="utf-8")
    return d.name


def list_snapshots() -> list[str]:
    return sorted(p.name for p in hist_dir().glob("*") if p.is_dir())


def rollback(cible: str) -> str:
    snaps = list_snapshots()
    match = [s for s in snaps if s.startswith(cible.replace(":", "-"))]
    if not match:
        raise SystemExit(f"Aucun snapshot ne correspond à « {cible} ». Disponibles : {', '.join(snaps[-10:]) or 'aucun'}")
    s = match[0]
    snapshot(f"avant rollback vers {s}")
    d = hist_dir() / s
    for f in ("preferences.json", "lessons.md"):
        dst = jc.MEMORY_DIR / f
        if (d / f).exists():
            shutil.copy2(d / f, dst)
        elif (d / f"{f}.absent").exists() and dst.exists():
            dst.unlink()
    return s


# ------------------------------------------------------------------ règles
def add_rule(param: str, direction: str, profil: str, note: str, base_value=None) -> dict:
    specs = P.param_specs()
    if param not in specs:
        raise SystemExit(f"Paramètre inconnu : {param}. Connus : {', '.join(specs)}")
    s = specs[param]
    cible = ""
    if direction in ("+", "-") and s["type"] == "continu":
        force = 0.25
        m = re.match(r"^([+-])(\d*\.?\d+)?$", direction)
        if base_value is None:
            base_value = P.resolve(profil, "A", np.random.default_rng(0))[0][param]
        delta = force * (s["max"] - s["min"])
        cible = float(np.clip(float(base_value) + (delta if m.group(1) == "+" else -delta), s["min"], s["max"]))
        cible = f"{cible:.4g}"
    return _write_rule(param, direction, profil, note, cible)


def _write_rule(param, direction, profil, note, cible) -> dict:
    p = jc.MEMORY_DIR / "lessons.md"
    if not p.exists():
        shutil.copy(jc.SKILL_DIR / "memory" / "lessons.md", p) if (jc.SKILL_DIR / "memory" / "lessons.md").exists() else p.write_text("# Leçons\n\n## Règles actives\n\n## Règles archivées\n", encoding="utf-8")
    lines = p.read_text(encoding="utf-8").splitlines()
    date = jc.now_iso()
    new = f"- [{date}] profil={profil} param={param} direction={direction}" + (f" cible={cible}" if cible else "") + f" | « {note.strip()} »"
    i_act = next(i for i, l in enumerate(lines) if l.startswith("## Règles actives"))
    i_arc = next(i for i, l in enumerate(lines) if l.startswith("## Règles archivées"))
    active = [l for l in lines[i_act + 1:i_arc] if l.strip()]
    archived = [l for l in lines[i_arc + 1:] if l.strip()]
    keep, moved = [], []
    for l in active:
        m = P.RULE_RE.match(l.strip())
        if m and m["param"] == param and m["profil"] == profil:
            moved.append(f"{l} (archivée le {date[:10]} : remplacée par une règle plus récente)")
        else:
            keep.append(l)
    out = lines[:i_act + 1] + [""] + keep + [new] + ["", lines[i_arc], ""] + archived + moved
    p.write_text("\n".join(out) + "\n", encoding="utf-8")
    return {"param": param, "direction": direction, "profil": profil, "cible": cible, "archivees": len(moved)}


def motif_match(motif: str, txt: str) -> bool:
    """Mots du motif dans l'ordre, jusqu'à 2 mots intercalés (« kick est trop sec » ⊃ « kick trop sec »)."""
    words = [re.escape(w) for w in norm_txt(motif).split()]
    pat = r"\b" + r"(?:\W+\w+){0,2}?\W+".join(words) + r"\b"
    return re.search(pat, txt) is not None


def comment_to_rules(comment: str, profil: str, base_params: dict) -> tuple[list, list]:
    """Convertit un commentaire libre en règles via le lexique ; renvoie (règles, fragments non compris)."""
    lex = jc.load_yaml(jc.CONFIG_DIR / "lexique.yaml") or []
    specs = P.param_specs()
    txt = norm_txt(comment)
    rules, used = [], set()
    for ent in lex:
        if any(motif_match(m, txt) for m in ent["motifs"]) and ent["param"] not in used:
            s = specs[ent["param"]]
            d = str(ent["direction"])
            cible = ""
            if d in ("+", "-") and s["type"] == "continu":
                base = float(base_params.get(ent["param"], s["defaut"]))
                delta = float(ent.get("force", 0.25)) * (s["max"] - s["min"])
                cible = f"{float(np.clip(base + (delta if d == '+' else -delta), s['min'], s['max'])):.4g}"
            rules.append(_write_rule(ent["param"], d, profil, comment, cible))
            used.add(ent["param"])
    fragments = [f.strip() for f in re.split(r"[,;.]| et | mais ", txt) if f.strip()]
    lex_m = [m for e in lex for m in e["motifs"]]
    incompris = [f for f in fragments if not any(motif_match(m, f) for m in lex_m)]
    return rules, incompris


# ------------------------------------------------------------------ préférences
def _entry(prefs, profil, param, spec, base):
    e = prefs["profils"].setdefault(profil, {}).get(param)
    if e is None:
        if spec["type"] == "continu":
            e = {"moyenne": float(base), "ecart_type": float(0.2 * (spec["max"] - spec["min"])), "n": 0}
        else:
            e = {"alpha": {str(o): P.pattern_prior(param, o) for o in spec["options"]},
                 "beta": {str(o): 1.0 for o in spec["options"]}}
        prefs["profils"][profil][param] = e
    if spec["type"] == "categoriel":
        for o in spec["options"]:
            e["alpha"].setdefault(str(o), P.pattern_prior(param, o))
            e["beta"].setdefault(str(o), 1.0)
    return e


def update_preferences(sessions: dict, notes: dict, comparaisons: list, profil: str) -> list[str]:
    """Met à jour preferences.json ; renvoie un journal lisible des changements."""
    st = P.style()
    cfg = st.get("apprentissage", {})
    taux = float(cfg.get("taux", 0.35))
    min_n = int(cfg.get("min_retours_resserrage", 3))
    specs = P.param_specs()
    base, _ = P.defaults_with_refs(specs)
    prefs = P.load_preferences()
    journal = []
    for prof in (profil, "*"):
        nret = prefs["n_retours"].get(prof, 0)
        for lettre, note in sorted(notes.items(), key=lambda kv: -kv[1]):
            if lettre not in sessions:
                continue
            w = (float(note) - 1) / 4
            sp = sessions[lettre]["params"]
            for k, s in specs.items():
                if k not in sp:
                    continue
                e = _entry(prefs, prof, k, s, base[k])
                x = sp[k]
                if s["type"] == "continu":
                    rng_ = s["max"] - s["min"]
                    std0 = float(cfg.get("std_initial_frac", 0.2)) * rng_
                    a = taux * w
                    m0 = e["moyenne"]
                    e["moyenne"] = float(m0 + a * (float(x) - m0))
                    var = (1 - a) * e["ecart_type"] ** 2 + a * (float(x) - m0) ** 2
                    floor = max(float(cfg.get("std_min_frac", 0.04)) * rng_, 0.7 * std0 if nret + 1 < min_n else 0)
                    e["ecart_type"] = float(max(np.sqrt(var), floor))
                    e["n"] = e.get("n", 0) + 1
                    e["poids"] = float(e.get("poids", 0.0) + a)  # signal positif cumulé
                    if prof == profil and abs(e["moyenne"] - m0) > 0.02 * rng_:
                        journal.append(f"{k} : {m0:.3g} → {e['moyenne']:.3g} (note {note} de {lettre})")
                else:
                    e["alpha"][str(x)] += w
                    e["beta"][str(x)] += 1 - w
                    if prof == profil and k in ("kick_pattern", "bass_mode", "pitch_mode", "hat_pattern", "clap_pattern", "chop_pitch_shift"):
                        sc = e["alpha"][str(x)] / (e["alpha"][str(x)] + e["beta"][str(x)])
                        journal.append(f"{k}={x} : score {sc:.2f} (note {note} de {lettre})")
        for gagnant, perdant in comparaisons:
            if gagnant not in sessions or perdant not in sessions:
                continue
            pg, pp = sessions[gagnant]["params"], sessions[perdant]["params"]
            for k, s in specs.items():
                if k not in pg or k not in pp or str(pg[k]) == str(pp[k]):
                    continue
                e = _entry(prefs, prof, k, s, base[k])
                if s["type"] == "categoriel":
                    e["alpha"][str(pg[k])] += 0.5
                    e["beta"][str(pp[k])] += 0.5
                else:
                    e["moyenne"] = float(e["moyenne"] + taux * 0.5 * (float(pg[k]) - e["moyenne"]))
            if prof == profil:
                journal.append(f"comparaison {gagnant} > {perdant} prise en compte")
        prefs["n_retours"][prof] = nret + 1
    prefs["maj"] = jc.now_iso()
    jc.save_json(jc.MEMORY_DIR / "preferences.json", prefs)
    return journal


# ------------------------------------------------------------------ entrées
def parse_notes(s: str) -> dict:
    out = {}
    for part in re.split(r"[,\s]+", s.strip()):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip().upper()] = float(v)
    return out


def parse_feedback_md(path: Path) -> dict:
    txt = path.read_text(encoding="utf-8")
    notes = {m[0].upper(): float(m[1]) for m in re.findall(r"Note\s+([A-H])(?:\s*\(1-5\))?\s*:\s*([1-5](?:[.,]5)?)", txt)}
    get = lambda lab: (re.search(rf"^{lab}\s*:\s*(.*)$", txt, re.M) or [None, ""])[1].strip()  # noqa: E731
    com = "; ".join(x for x in (get("Ce qui ne marche pas"), get("Ce qui marche"), get("À tester la prochaine fois")) if x)
    return {"notes": notes, "preferee": get("Préférée").upper()[:1], "commentaire": com}


def load_sessions(dossier: Path) -> dict:
    out = {}
    for f in sorted(dossier.glob("session_*.json")):
        s = jc.load_json(f)
        out[s["variante"]] = s
    if not out:
        raise SystemExit(f"Aucun session_*.json dans {dossier}")
    return out


def learn(dossier: Path, notes: dict, preferee: str = "", commentaire: str = "", comparaisons=None) -> dict:
    sessions = load_sessions(dossier)
    profil = next(iter(sessions.values()))["profil"]
    comps = list(comparaisons or [])
    if preferee and preferee in sessions:
        comps += [(preferee, o) for o in sessions if o != preferee]
    snap = snapshot(f"retour sur {dossier.name}")
    journal = update_preferences(sessions, notes, comps, profil) if (notes or comps) else []
    regles, incompris = [], []
    if commentaire:
        base = sessions.get("A", next(iter(sessions.values())))["params"]
        regles, incompris = comment_to_rules(commentaire, profil, base)
    entry = {"date": jc.now_iso(), "dossier": str(dossier), "titre": next(iter(sessions.values()))["titre"],
             "profil": profil, "notes": notes, "preferee": preferee, "comparaisons": comps, "commentaire": commentaire,
             "regles_creees": regles, "non_compris": incompris, "snapshot_avant": snap,
             "params": {k: v["params"] for k, v in sessions.items()}, "seeds": {k: v["seed"] for k, v in sessions.items()}}
    with open(jc.MEMORY_DIR / "feedback_log.jsonl", "a", encoding="utf-8") as f:
        f.write(__import__("json").dumps(entry, ensure_ascii=False, default=jc._json_default) + "\n")
    return {"profil": profil, "journal": journal, "regles": regles, "non_compris": incompris, "snapshot": snap}


def resume(res: dict) -> str:
    L = [f"Profil « {res['profil']} » — snapshot avant mise à jour : {res['snapshot']}"]
    j = res["journal"]
    L.append("Préférences : " + ("; ".join(j[:6]) + (" …" if len(j) > 6 else "") if j else "aucun changement notable"))
    r = res["regles"]
    L.append("Règles : " + ("; ".join(f"{x['param']} {x['direction']}" + (f" (cible {x['cible']})" if x["cible"] else "") for x in r) if r else "aucune nouvelle règle"))
    if res["non_compris"]:
        L.append("Non converti (à traduire avec --regle si utile) : " + " | ".join(res["non_compris"]))
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description="Met à jour la mémoire du skill à partir d'un retour.")
    ap.add_argument("--dossier", help="dossier de sortie d'un rendu (contient session_*.json)")
    ap.add_argument("--notes", default="", help="ex. A=4,B=2,C=5")
    ap.add_argument("--preferee", default="")
    ap.add_argument("--commentaire", default="")
    ap.add_argument("--comparaison", action="append", default=[], help="ex. B>A (répétable)")
    ap.add_argument("--feedback", help="feedback.md rempli (le dossier est déduit)")
    ap.add_argument("--regle", help="règle directe param:direction (ex. kick_decay:+ , bass_mode:=aucune)")
    ap.add_argument("--profil", default="*", help="profil de la règle directe (défaut : tous)")
    ap.add_argument("--note", default="règle ajoutée à la main")
    ap.add_argument("--rollback", help="date (préfixe) du snapshot à restaurer")
    ap.add_argument("--historique", action="store_true")
    a = ap.parse_args()
    if a.historique:
        for s in list_snapshots():
            r = hist_dir() / s / "raison.txt"
            print(f"{s}  {r.read_text(encoding='utf-8') if r.exists() else ''}")
        return
    if a.rollback:
        print(f"Mémoire restaurée à l'état du snapshot {rollback(a.rollback)}")
        return
    if a.regle:
        param, _, d = a.regle.partition(":")
        snap = snapshot(f"règle manuelle {a.regle}")
        r = add_rule(param.strip(), d.strip(), a.profil, a.note)
        print(f"Règle ajoutée : {r} (snapshot {snap})")
        return
    if a.feedback:
        fb = parse_feedback_md(Path(a.feedback))
        res = learn(Path(a.feedback).parent, fb["notes"], fb["preferee"], fb["commentaire"])
    elif a.dossier:
        comps = [tuple(c.upper().replace(" ", "").split(">")) for c in a.comparaison]
        res = learn(Path(a.dossier), parse_notes(a.notes), a.preferee.upper()[:1], a.commentaire, comps)
    else:
        ap.error("--dossier, --feedback, --regle, --rollback ou --historique requis")
    print(resume(res))


if __name__ == "__main__":
    main()
