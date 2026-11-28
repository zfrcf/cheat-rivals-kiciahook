"""Jalon 2 : analyse de tempo + stretch."""
import numpy as np

from analyze import analyze_tempo, measure_bpm
from jc_common import SR
from stretch import align_stems, choose_multiplier, pitch_semitones
from synth import click


def test_multiplicateur():
    assert choose_multiplier(100, 140) == 2
    assert choose_multiplier(70, 140) == 2
    assert choose_multiplier(140, 140) == 1
    assert choose_multiplier(280, 140) == 0.5
    assert abs(pitch_semitones("follow", 130, 140, 1) - 12 * np.log2(140 / 130)) < 1e-9
    assert pitch_semitones("+3", 100, 140, 2) == 3


def test_clic_100_vers_140():
    y = click(100, 30)
    t = analyze_tempo(y, SR)
    assert abs(t["bpm"] - 100) < 0.2
    out, info = align_stems({"mix": y}, t, 140)
    assert info["avertissements"], "un stretch de 30 % doit lever un avertissement"
    assert abs(measure_bpm(out["mix"], SR, 140) - 140) <= 0.5
