"""Jalons 5-6 : pipeline complet sur une chanson synthétique de 60 s + reproductibilité."""
import json

import pytest

pytestmark = pytest.mark.lent


def _check(out_dir, lettres):
    for let in lettres:
        s = json.loads((out_dir / f"session_{let}.json").read_text())
        m = s["resultat"]["metriques"]
        assert m["ok"], (let, m["bloquantes"], m)
        for f in (f"chanson_synth_jersey_{let}.wav", f"chanson_synth_jersey_{let}.mp3", f"drums_{let}.mid",
                  f"spectro_{let}.png", f"stems/{let}/drums.wav", f"stems/{let}/chops.wav"):
            assert (out_dir / f).exists(), f
    rapport = (out_dir / "rapport.md").read_text()
    assert "usage privé" in rapport and "Variante A" in rapport
    assert (out_dir / "feedback.md").read_text().startswith("Morceau : chanson_synth")


def test_pipeline_rapide_et_rejeu(memoire_isolee, chanson_wav, tmp_path):
    from jerseyfy import replay, run
    out = run(chanson_wav, {"variants": 3, "fast": True, "seed": 11, "sortie": str(tmp_path), "length": "court"})
    _check(out, "ABC")
    rej, identique = replay(out / "session_A.json", str(tmp_path / "rejeu"))
    assert identique, "même session.json + même seed ⇒ même empreinte audio"


def test_pipeline_demucs(memoire_isolee, chanson_wav, tmp_path):
    from jerseyfy import run
    out = run(chanson_wav, {"variants": 1, "fast": False, "seed": 3, "sortie": str(tmp_path), "length": "court"})
    _check(out, "A")


def test_pipeline_complet_structure_source(memoire_isolee, chanson_wav, tmp_path):
    from jerseyfy import run
    out = run(chanson_wav, {"variants": 1, "fast": True, "seed": 5, "sortie": str(tmp_path), "length": "complet"})
    _check(out, "A")
