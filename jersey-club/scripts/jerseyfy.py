#!/usr/bin/env python3
"""jerseyfy — transforme un morceau en remix Jersey club (point d'entrée unique).

Usage :
  jerseyfy.py <fichier> [--variants 3] [--bpm 140] [--length court|complet] [--fast]
              [--seed N] [--pitch preserve|follow|+N] [--bpm-source N] [--profil rap]
              [--sortie ./jersey_out]
  jerseyfy.py --depuis-session jersey_out/<titre>/session_A.json [--sortie dossier]

Pipeline : décodage → analyse tempo → séparation (Demucs | HPSS) → profil de source →
paramètres A/B/C depuis la mémoire → recalage sur la grille (rubberband) → analyse par
mesure (tonalité, accords, segments, hook) → arrangement → batterie/FX, chops, basse →
mix/master → évaluation (+ 2 tentatives d'auto-correction) → exports.
"""
from __future__ import annotations

import argparse
import copy
import re
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jc_common as jc  # noqa: E402
from jc_common import SR, Grid, log  # noqa: E402

LETTRES = "ABCDEFGH"
MENTION_DROITS = ("Rappel : un remix d'un morceau dont vous n'avez pas les droits est réservé à un usage privé ; "
                  "toute publication nécessite l'accord des ayants droit (sauf sur vos propres morceaux).")


def slug(s: str) -> str:
    s = re.sub(r"[^\w\-]+", "_", s, flags=re.UNICODE).strip("_")
    return s[:60] or "morceau"


# ------------------------------------------------------------------ préparation
class Contexte:
    """Données partagées par toutes les variantes d'un même morceau."""

    def __init__(self, source: Path, opts: dict):
        from analyze import analyze_tempo, classify_profile, source_features
        from separate import separate
        self.source = source
        self.opts = opts
        self.style = jc.load_yaml(jc.CONFIG_DIR / "style_profile.yaml")
        self.fixes = self.style.get("fixes", {})
        y = jc.decode(source)
        pk = np.abs(y).max()
        if pk < 1e-5:
            raise RuntimeError("Le fichier est silencieux.")
        self.y = (y / pk * 0.9).astype(np.float32)  # niveau d'analyse normalisé
        log(f"Fichier : {source.name} ({self.y.shape[1] / SR:.1f} s)")
        self.tempo = analyze_tempo(self.y, SR, opts.get("bpm_source"))
        log(f"BPM source : {self.tempo['bpm']:.2f} (stable : {self.tempo['stable']})")
        self.stems = separate(self.y, SR, fast=opts.get("fast", False))
        self.features = source_features(self.y, SR, self.tempo["bpm"], self.stems["vocals"])
        prof, scores = classify_profile(self.features)
        self.profil = opts.get("profil") or prof
        self.scores_profil = scores
        log(f"Profil de source : {self.profil}")
        self._aligned = {}

    def aligned(self, bpm: float, pitch_mode) -> tuple[dict, dict, dict]:
        from analyze import analyze_bars
        from stretch import align_stems
        key = (round(float(bpm), 3), str(pitch_mode))
        if key not in self._aligned:
            al, info = align_stems(self.stems, self.tempo, float(bpm), pitch_mode, SR, self.fixes)
            g = Grid(bpm)
            mix = al["vocals"] + al["drums"] + al["bass"] + al["other"]
            ana = analyze_bars(mix, al["other"] + al["bass"], al["vocals"], g, int(self.fixes.get("hook_mesures", 8)))
            self._aligned[key] = (al, info, ana)
        return self._aligned[key]


# ------------------------------------------------------------------ rendu
def render_variant(ctx: Contexte, params: dict, seed: int, rendu: dict) -> dict:
    from arrange import build_plan, render_source_layer, sections_of
    from bass import bass_notes, render_808, render_origine
    from chop import chop_events, make_bank, render_chops
    from drums import Kit, drum_events, load_patterns, render_drums
    from mix import mix

    fixes = dict(ctx.fixes, **rendu.get("fixes", {}))
    bpm = float(params["bpm_target"])
    al, sinfo, ana = ctx.aligned(bpm, params["pitch_mode"])
    g = Grid(bpm)
    rng = np.random.default_rng(seed)
    plan = build_plan(ctx.opts.get("length", "court"), params["arrangement_template"], ana)
    n = g.bar_start(len(plan)) + 2 * SR
    pats = load_patterns()
    p = dict(params)
    if rendu.get("humanize_force") is not None:
        p["humanize_ms"] = rendu["humanize_force"]
    # batterie + FX
    dev = drum_events(plan, p, pats, rng)
    kit = Kit(p, seed, key_pc=ana["tonalite"]["tonique"], bpm=bpm)
    dr = render_drums(dev, kit, g, n)
    voulu = np.array(sorted(g.tick_to_sample(e["bar"], e["tick"]) / SR for e in dev if e["inst"] == "kick"))
    # chops
    bank = make_bank(al["vocals"], g, ana["hook"], fixes.get("fade_chop_ms", [3, 5]))
    source_chops = "voix"
    if not bank:
        bank = make_bank(al["other"], g, ana["hook"], fixes.get("fade_chop_ms", [3, 5]))
        source_chops = "instru (aucune voix exploitable)"
    cev = chop_events(plan, bank, p, rng, fixes)
    chops, cuts = render_chops(cev, bank, g, n, p, fixes, rng) if bank else (np.zeros((2, n), np.float32), [])
    # couches source
    voix = render_source_layer(al["vocals"], plan, g, n, "voix", ("intacte",))
    voix_f = render_source_layer(al["vocals"], plan, g, n, "voix", ("filtre",))
    instru = render_source_layer(al["other"], plan, g, n, "instru", ("plein",))
    instru_f = render_source_layer(al["other"], plan, g, n, "instru", ("filtre",))
    # basse
    notes = []
    bm = str(p["bass_mode"])
    if bm.startswith("808"):
        notes = bass_notes(plan, dev, ana["accords"], p, g, rng)
        basse = render_808(notes, n, p, rng, glide=bool(fixes.get("bass_glide", True)))
    elif bm == "origine":
        basse = render_origine(al["bass"], render_source_layer(al["bass"], plan, g, n, "basse", (True,)))
    else:
        basse = np.zeros((2, n), np.float32)
    buses = {"drums": dr["kick"] + dr["drums"], "fx": dr["fx"], "chops": chops, "voix": voix,
             "voix_filtre": voix_f, "instru": instru, "instru_filtre": instru_f, "basse": basse}
    secs = sections_of(plan, g)
    fondu = None
    for s, sec in zip(secs, [b for b in plan if b["pos"] == 0]):
        if sec.get("fondu"):
            fondu = (g.bar_start(s["debut_mesure"]), g.bar_start(s["debut_mesure"] + s["mesures"]))
    mctx = {"plafond_tp": rendu.get("plafond_tp", float(fixes.get("true_peak_max", -1.0)) - 0.3), "fondu": fondu}
    master, stems, minfo = mix(buses, p, dr["kick_times"], mctx)
    # données d'évaluation (bus chops non traités, pour la détection de clics)
    ev_ctx = {"bpm": bpm, "kick_times": voulu, "cuts": cuts, "key": ana["tonalite"],
              "bass_notes": [nt["midi"] for nt in notes], "sections": secs, "fixes": fixes,
              "lufs_target": float(p["lufs_target"])}
    return {"master": master, "stems": stems, "eval_buses": {"chops": chops, "basse": stems["basse"]},
            "ev_ctx": ev_ctx, "plan": plan, "sections": secs, "drum_events": dev, "stretch": sinfo,
            "analyse": ana, "mix": minfo, "n_chops": len(bank), "source_chops": source_chops}


def render_checked(ctx: Contexte, params: dict, seed: int, rendu: dict, ref_prof, png, titre) -> tuple[dict, dict, dict]:
    """Rend, évalue et corrige automatiquement (2 tentatives max)."""
    from evaluate import evaluate
    rendu = copy.deepcopy(rendu)
    rendu.setdefault("corrections", [])
    for tentative in range(3):
        out = render_variant(ctx, params, seed, rendu)
        out["ev_ctx"]["titre"] = titre
        m = evaluate(out["master"], out["ev_ctx"], out["eval_buses"], ref_prof, png)
        if m["ok"] or tentative == 2 or rendu.get("pas_de_correction"):
            break
        b = m["bloquantes"]
        if not b["true_peak"]:
            rendu["plafond_tp"] = rendu.get("plafond_tp", -1.3) - 0.5
            rendu["corrections"].append(f"tentative {tentative + 1} : true peak {m['true_peak_dbtp']} dBTP → plafond du limiteur abaissé à {rendu['plafond_tp']} dB")
        if not b["clics"]:
            f = rendu.setdefault("fixes", {}).get("fade_chop_ms", ctx.fixes.get("fade_chop_ms", [3, 5]))
            rendu["fixes"]["fade_chop_ms"] = [f[0] * 2, f[1] * 2]
            rendu["corrections"].append(f"tentative {tentative + 1} : {m['clics_chops']['clics']} clic(s) → fondus des chops doublés")
        if not b["timing_kicks"]:
            rendu["humanize_force"] = 0.0
            rendu["corrections"].append(f"tentative {tentative + 1} : timing des kicks {m['kicks']} → humanisation coupée")
        if not b["bpm"]:
            rendu["corrections"].append(f"tentative {tentative + 1} : BPM mesuré {m['bpm_mesure']} ≠ {params['bpm_target']} (pas de correction automatique possible ; vérifier --bpm-source)")
            if b["true_peak"] and b["clics"] and b["timing_kicks"]:
                break
    return out, m, rendu


def export_variant(out_dir: Path, titre: str, lettre: str, out: dict, m: dict, params, prov, seed, rendu, ctx) -> dict:
    from drums import export_midi
    base = out_dir / f"{titre}_jersey_{lettre}"
    jc.write_wav(base.with_suffix(".wav"), out["master"], subtype="PCM_24")
    jc.wav_to_mp3(base.with_suffix(".wav"), base.with_suffix(".mp3"))
    for k, v in out["stems"].items():
        jc.write_wav(out_dir / "stems" / lettre / f"{k}.wav", v, subtype="PCM_24")
    export_midi(out["drum_events"], float(params["bpm_target"]), out_dir / f"drums_{lettre}.mid")
    session = {
        "version": 1, "titre": titre, "variante": lettre, "cree_le": jc.now_iso(),
        "source": str(ctx.source.resolve()), "source_empreinte": jc.file_hash(ctx.source),
        "seed": int(seed), "profil": ctx.profil,
        "options": {k: ctx.opts.get(k) for k in ("fast", "length", "bpm_source", "profil")},
        "params": {k: v for k, v in params.items() if not k.startswith("_")},
        "joker": params.get("_joker"), "provenance": prov, "rendu": rendu,
        "resultat": {"wav": base.with_suffix(".wav").name, "empreinte_audio": jc.array_hash(out["master"]),
                     "metriques": {k: v for k, v in m.items() if k != "png"}},
        "analyse": {"bpm_source": ctx.tempo["bpm"], "tonalite": out["analyse"]["tonalite"]["nom"],
                    "hook": out["analyse"]["hook"], "stretch": out["stretch"]},
        "libs": jc.libs_versions(),
    }
    jc.save_json(out_dir / f"session_{lettre}.json", session)
    return session


def write_report(out_dir: Path, titre: str, ctx: Contexte, results: list) -> None:
    from params import describe_difference, param_specs
    specs = param_specs()
    a0 = results[0]
    ana = a0["out"]["analyse"]
    L = [f"# Rapport — {titre} (version Jersey club)", "", f"> {MENTION_DROITS}", "",
         "## Analyse de la source", "",
         f"- Fichier : `{ctx.source.name}` — {ctx.y.shape[1] / SR:.1f} s",
         f"- BPM source : **{ctx.tempo['bpm']:.2f}** (tempo {'stable' if ctx.tempo['stable'] else 'flottant'}, résidu {ctx.tempo['residu_ms']:.1f} ms)",
         f"- Tonalité : **{ana['tonalite']['nom']}** (confiance {ana['tonalite']['confiance']})",
         f"- Hook : mesures {ana['hook']['debut']}–{ana['hook']['fin']} (répétition {ana['hook'].get('repetition')}, voix ×{ana['hook']['score_voix']})",
         f"- Profil de source : **{ctx.profil}** (scores : {ctx.scores_profil})",
         f"- Séparation : {'rapide (HPSS)' if ctx.opts.get('fast') else 'Demucs htdemucs'} ; chops tirés de : {a0['out']['source_chops']} ({a0['out']['n_chops']} syllabes)",
         f"- Grille d'accords (début) : {' | '.join(c['nom'] for c in ana['accords'][ana['hook']['debut']:ana['hook']['fin']])}", ""]
    warns = sorted({w for r in results for w in r["out"]["stretch"]["avertissements"]})
    if warns:
        L += ["### ⚠ Avertissements", ""] + [f"- {w}" for w in warns] + [""]
    L += ["## Variantes", ""]
    for r in results:
        let, p, m = r["lettre"], r["params"], r["m"]
        role = {"A": "exploitation (meilleurs paramètres connus)", "B": "exploration (tirage dans les distributions apprises)",
                "C": f"joker : {p.get('_joker', '—')} change franchement"}.get(let, "exploration supplémentaire")
        diff = "référence" if let == "A" else describe_difference(results[0]["params"], p, specs)
        b = m["bloquantes"]
        L += [f"### Variante {let} — {role}", "", f"- Ce qui la distingue : {diff}",
              f"- Fichiers : `{titre}_jersey_{let}.wav` / `.mp3`, `stems/{let}/`, `drums_{let}.mid`, `session_{let}.json`",
              f"- Structure : " + " → ".join(f"{s['nom']} {s['mesures']}" for s in r["out"]["sections"]),
              "", "| Métrique | Valeur | Statut |", "|---|---|---|",
              f"| BPM mesuré | {m['bpm_mesure']} (cible {p['bpm_target']:.1f}) | {'OK' if b['bpm'] else 'ÉCHEC'} |",
              f"| Timing kicks (médiane) | {m['kicks'].get('mediane_ms')} ms, {m['kicks'].get('taux_trouves', 0) * 100:.0f} % trouvés | {'OK' if b['timing_kicks'] else 'ÉCHEC'} |",
              f"| LUFS intégré | {m['lufs']} (cible {p['lufs_target']:.1f}) | {'OK' if m['indicatives']['loudness'] else 'à surveiller'} |",
              f"| True peak | {m['true_peak_dbtp']} dBTP, {m['clipping_echantillons']} éch. clippés | {'OK' if b['true_peak'] else 'ÉCHEC'} |",
              f"| Clics aux coupes | {m['clics_chops']['clics']} / {m['clics_chops']['points_testes']} | {'OK' if b['clics'] else 'ÉCHEC'} |",
              f"| Corrélation de phase | {m['correlation_phase']} | {'OK' if m['indicatives']['phase'] else 'à surveiller'} |",
              f"| Cohérence tonale | {m['tonal']} | {'OK' if m['indicatives']['basse_tonale'] else 'à surveiller'} |",
              f"| Bandes (dB rel.) | {m['bandes_db']} | — |"]
        if m.get("distance_spectrale_refs_db") is not None:
            L.append(f"| Distance spectrale aux références | {m['distance_spectrale_refs_db']} dB | — |")
        L += ["", f"![spectrogramme {let}](spectro_{let}.png)", ""]
        if r["rendu"].get("corrections"):
            L += ["Corrections automatiques :", ""] + [f"- {c}" for c in r["rendu"]["corrections"]] + [""]
        L += ["<details><summary>Paramètres et provenance</summary>", "", "| Paramètre | Valeur | Provenance |", "|---|---|---|"]
        for k in specs:
            v = p[k]
            L.append(f"| {k} | {v:.3f} | {r['prov'][k]} |" if isinstance(v, float) else f"| {k} | {v} | {r['prov'][k]} |")
        L += ["", "</details>", ""]
    (out_dir / "rapport.md").write_text("\n".join(L), encoding="utf-8")


def write_feedback(out_dir: Path, titre: str, ctx: Contexte, lettres) -> None:
    notes = "     ".join(f"Note {x}{' (1-5)' if x == 'A' else ''} :" for x in lettres)
    txt = (f"Morceau : {titre}  |  Profil source : {ctx.profil}\n{notes}\nPréférée :\nCe qui marche :\n"
           f"Ce qui ne marche pas :\nÀ tester la prochaine fois :\n")
    (out_dir / "feedback.md").write_text(txt, encoding="utf-8")


def run(source: Path, opts: dict) -> Path:
    from params import resolve
    t0 = time.time()
    ctx = Contexte(source, opts)
    titre = slug(opts.get("titre") or source.stem)
    out_dir = Path(opts.get("sortie") or "jersey_out") / titre
    out_dir.mkdir(parents=True, exist_ok=True)
    seed = int(opts["seed"]) if opts.get("seed") is not None else int(time.time()) % 100000
    from params import references_summary
    ref_prof = references_summary().get("bandes_db")
    cli = {"bpm_target": opts.get("bpm"), "pitch_mode": opts.get("pitch")}
    results = []
    nvar = max(1, min(int(opts.get("variants", 3)), len(LETTRES)))
    for i in range(nvar):
        let = LETTRES[i]
        mode = let if let in "ABC" else "B"
        vseed = seed + i
        params, prov = resolve(ctx.profil, mode, np.random.default_rng(vseed), cli)
        log(f"— Variante {let} (seed {vseed}) : kick={params['kick_pattern']}, basse={params['bass_mode']}, "
            f"pitch={params['pitch_mode']}, {params['bpm_target']:.1f} BPM")
        out, m, rendu = render_checked(ctx, params, vseed, {}, ref_prof, out_dir / f"spectro_{let}.png", titre)
        export_variant(out_dir, titre, let, out, m, params, prov, vseed, rendu, ctx)
        results.append({"lettre": let, "params": params, "prov": prov, "out": out, "m": m, "rendu": rendu})
        log(f"  {let} : {'OK' if m['ok'] else 'ÉCHEC'} — {m['lufs']} LUFS, TP {m['true_peak_dbtp']} dBTP, "
            f"BPM {m['bpm_mesure']}, kicks {m['kicks'].get('mediane_ms')} ms, clics {m['clics_chops']['clics']}")
    write_report(out_dir, titre, ctx, results)
    write_feedback(out_dir, titre, ctx, [r["lettre"] for r in results])
    jc.save_json(out_dir / "analyse.json", {"tempo": {k: v for k, v in ctx.tempo.items() if k != "beats"},
                                            "features": ctx.features, "profil": ctx.profil,
                                            "mesures": {k: v for k, v in results[0]["out"]["analyse"].items() if not k.startswith("rms")}})
    log(f"Terminé en {time.time() - t0:.0f} s → {out_dir}")
    print(out_dir)
    return out_dir


def replay(session_path: Path, sortie: str | None) -> Path:
    """Rejoue un rendu à l'identique depuis un session.json."""
    s = jc.load_json(session_path)
    src = Path(s["source"])
    if not src.exists():
        raise FileNotFoundError(f"Source introuvable : {src}")
    if jc.file_hash(src) != s["source_empreinte"]:
        log("⚠ Le fichier source a changé depuis la session : le rendu ne sera pas identique.")
    opts = dict(s["options"])
    ctx = Contexte(src, opts)
    out_dir = Path(sortie) if sortie else session_path.parent / "rejoue"
    out_dir.mkdir(parents=True, exist_ok=True)
    params = dict(s["params"])
    if s.get("joker"):
        params["_joker"] = s["joker"]
    rendu = dict(s["rendu"], pas_de_correction=True)
    out = render_variant(ctx, params, int(s["seed"]), rendu)
    jc.write_wav(out_dir / s["resultat"]["wav"], out["master"], subtype="PCM_24")
    h = jc.array_hash(out["master"])
    same = h == s["resultat"]["empreinte_audio"]
    log(f"Rendu rejoué : {'IDENTIQUE' if same else 'DIFFÉRENT'} (empreinte {h[:12]})")
    print(out_dir / s["resultat"]["wav"])
    return out_dir


def main():
    ap = argparse.ArgumentParser(description="Transforme un morceau en remix Jersey club (3 variantes A/B/C).")
    ap.add_argument("fichier", nargs="?")
    ap.add_argument("--variants", type=int, default=3)
    ap.add_argument("--bpm", type=float, default=None, help="BPM cible (sinon : mémoire / profil de style)")
    ap.add_argument("--length", choices=["court", "complet"], default="court")
    ap.add_argument("--fast", action="store_true", help="séparation rapide (HPSS) au lieu de Demucs")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--pitch", default=None, help="preserve | follow | +N (demi-tons)")
    ap.add_argument("--bpm-source", type=float, default=None, help="impose le BPM source si la détection hésite")
    ap.add_argument("--profil", choices=jc.PROFILS, default=None, help="impose le profil de source")
    ap.add_argument("--titre", default=None)
    ap.add_argument("--sortie", default="jersey_out")
    ap.add_argument("--depuis-session", default=None, help="rejoue un rendu à l'identique")
    a = ap.parse_args()
    if a.depuis_session:
        replay(Path(a.depuis_session), a.sortie if a.sortie != "jersey_out" else None)
        return
    if not a.fichier:
        ap.error("fichier source manquant")
    run(Path(a.fichier), {"variants": a.variants, "bpm": a.bpm, "length": a.length, "fast": a.fast, "seed": a.seed,
                          "pitch": a.pitch, "bpm_source": a.bpm_source, "profil": a.profil, "titre": a.titre,
                          "sortie": a.sortie})


if __name__ == "__main__":
    main()
