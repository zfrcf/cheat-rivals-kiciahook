"""Jalon 3 : synthèse, patterns, timing des kicks, MIDI."""
import mido
import numpy as np
import pytest

from drums import Kit, drum_events, export_midi, load_patterns, render_drums, roll_ticks
from evaluate import kick_timing
from jc_common import SR, Grid, parse_ticks

PARAMS = {"kick_decay": 0.22, "clap_pattern": "backbeat", "hat_pattern": "doubles",
          "humanize_ms": 3, "swing": 0.1, "fx_density": 0.5, "squeak_amount": 0.6}


def test_parse_et_roll():
    assert parse_ticks("every 2")[:3] == [0, 2, 4] and len(parse_ticks("every 2")) == 24
    r = roll_ticks([4, 3, 2])
    assert r[0] == 0 and all(0 <= t < 48 for t in r)
    assert np.diff(r)[-1] <= np.diff(r)[0]  # densité croissante


@pytest.mark.parametrize("kp", ["bounce_classique", "bounce_rafale", "bounce_syncope"])
def test_kicks_alignes(kp):
    pats = load_patterns()
    g = Grid(140)
    params = dict(PARAMS, kick_pattern=kp)
    plan = [{"pos": p, "len": 8, "kick": True, "clap": True, "hats": True, "fx": ["squeak", "crash"]} for p in range(8)]
    ev = drum_events(plan, params, pats, np.random.default_rng(3))
    b = render_drums(ev, Kit(params, 3), g, g.bar_start(8) + SR)
    y = b["kick"] + b["drums"] + b["fx"]
    voulu = np.array(sorted(g.tick_to_sample(e["bar"], e["tick"]) / SR for e in ev if e["inst"] == "kick"))
    attendu_par_mesure = len(parse_ticks(pats["kick"][kp]))
    assert len(voulu) == 8 * attendu_par_mesure
    m = kick_timing(y, voulu)
    assert m["taux_trouves"] >= 0.95
    assert m["mediane_ms"] < 10


def test_midi(tmp_path):
    pats = load_patterns()
    params = dict(PARAMS, kick_pattern="bounce_classique")
    plan = [{"pos": 0, "len": 1, "kick": True, "clap": True, "hats": False, "fx": []}]
    ev = drum_events(plan, params, pats, np.random.default_rng(0))
    p = tmp_path / "d.mid"
    export_midi(ev, 140, p)
    notes = [m.note for m in mido.MidiFile(p).tracks[0] if m.type == "note_on"]
    assert notes.count(36) == 5 and notes.count(39) == 2
