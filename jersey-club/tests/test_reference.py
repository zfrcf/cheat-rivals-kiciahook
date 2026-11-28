"""Jalon 7 : ingestion d'une référence (morceau Jersey synthétique, aucun audio protégé)."""
import json

import numpy as np
import pytest


@pytest.fixture(scope="module")
def ref_wav(tmp_path_factory):
    from drums import Kit, drum_events, load_patterns, render_drums
    from jc_common import SR, Grid, write_wav
    g = Grid(142)
    params = {"kick_decay": 0.2, "kick_pattern": "bounce_rafale", "clap_pattern": "backbeat",
              "hat_pattern": "doubles", "humanize_ms": 1, "swing": 0, "fx_density": 0, "squeak_amount": 0}
    plan = [{"pos": p % 8, "len": 8, "kick": True, "clap": True, "hats": True, "fx": []} for p in range(24)]
    ev = drum_events(plan, params, load_patterns(), np.random.default_rng(0))
    b = render_drums(ev, Kit(params, 0, bpm=142), g, g.bar_start(24) + SR)
    y = b["kick"] + b["drums"] * 0.7
    p = tmp_path_factory.mktemp("ref") / "ref_jersey.wav"
    write_wav(p, y / np.abs(y).max() * 0.9, subtype="PCM_16")
    return p


def test_reference_extrait_pattern_et_bpm(memoire_isolee, ref_wav):
    import jc_common as jc
    import params as P
    from reference import analyze_reference
    avant = P.pattern_prior("kick_pattern", "bounce_rafale")
    r = analyze_reference(ref_wav, fast=True, nom="ref_test")
    assert abs(r["bpm"] - 142) < 0.3
    assert r["patterns"]["kick"]["ticks"] == [0, 12, 24, 36, 40, 44]
    assert "existant" in r["patterns_ajoutes"]["kick"]
    assert P.pattern_prior("kick_pattern", "bounce_rafale") > avant
    stocke = json.loads((memoire_isolee / "references" / "ref_test.json").read_text())
    assert "audio" not in json.dumps(stocke).lower().replace("aucun audio", "")
    # la référence recentre le défaut de BPM
    vals, prov = P.defaults_with_refs(P.param_specs())
    assert 140 < vals["bpm_target"] <= 142 and "référence" in prov["bpm_target"]
