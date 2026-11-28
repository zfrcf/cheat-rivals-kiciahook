"""Jalon 7 : apprentissage, rollback, règles, exploration."""
import json

import numpy as np


def _sessions(dossier, profil="pop"):
    import params as P
    dossier.mkdir(parents=True, exist_ok=True)
    out = {}
    for i, let in enumerate("ABC"):
        p, _ = P.resolve(profil, let, np.random.default_rng(i))
        p = {k: v for k, v in p.items() if not k.startswith("_")}
        s = {"variante": let, "titre": "test", "profil": profil, "seed": i, "params": p}
        (dossier / f"session_{let}.json").write_text(json.dumps(s))
        out[let] = s
    return out


def _score(profil, param, opt):
    import params as P
    e = P.load_preferences()["profils"][profil][param]
    return e["alpha"][str(opt)] / (e["alpha"][str(opt)] + e["beta"][str(opt)])


def test_note_5_augmente_le_score(memoire_isolee, tmp_path):
    import learn
    s = _sessions(tmp_path / "rendu")
    kp = s["A"]["params"]["kick_pattern"]
    learn.learn(tmp_path / "rendu", {"A": 3})
    avant = _score("pop", "kick_pattern", kp)
    learn.learn(tmp_path / "rendu", {"A": 5})
    assert _score("pop", "kick_pattern", kp) > avant
    log = (memoire_isolee / "feedback_log.jsonl").read_text().strip().splitlines()
    assert len(log) == 2


def test_rollback_restaure_etat_exact(memoire_isolee, tmp_path):
    import learn
    _sessions(tmp_path / "rendu")
    learn.learn(tmp_path / "rendu", {"A": 4, "B": 2})
    ref_prefs = (memoire_isolee / "preferences.json").read_bytes()
    ref_lessons = (memoire_isolee / "lessons.md").read_bytes()
    snaps_avant = learn.list_snapshots()
    learn.learn(tmp_path / "rendu", {"C": 5}, commentaire="kick trop sec")
    assert (memoire_isolee / "preferences.json").read_bytes() != ref_prefs
    nouveau = [s for s in learn.list_snapshots() if s not in snaps_avant][0]
    learn.rollback(nouveau)
    assert (memoire_isolee / "preferences.json").read_bytes() == ref_prefs
    assert (memoire_isolee / "lessons.md").read_bytes() == ref_lessons


def test_regle_modifie_le_parametre(memoire_isolee, tmp_path):
    import learn
    import params as P
    s = _sessions(tmp_path / "rendu")
    avant = P.resolve("pop", "A", np.random.default_rng(0))[0]["kick_decay"]
    res = learn.learn(tmp_path / "rendu", {}, commentaire="Le kick trop sec, et j'aime quand la voix est pitchée")
    params = {r["param"] for r in res["regles"]}
    assert {"kick_decay", "chop_pitch_shift"} <= params
    apres, prov = P.resolve("pop", "A", np.random.default_rng(0))
    assert apres["kick_decay"] > avant
    assert apres["chop_pitch_shift"] == 7 and "règle" in prov["chop_pitch_shift"]
    # la règle prime aussi sur l'exploration (B) : plancher respecté
    for k in range(20):
        assert P.resolve("pop", "B", np.random.default_rng(k))[0]["kick_decay"] >= float(
            P.active_rules_for("pop")["kick_decay"]["cible"]) - 1e-9
    # une règle contraire archive l'ancienne
    learn.learn(tmp_path / "rendu", {}, commentaire="kick trop long")
    regles = [r for r in P.load_rules(include_archived=True) if r["param"] == "kick_decay"]
    assert sum(r["statut"] == "active" for r in regles) == 1
    assert any(r["statut"] == "archive" for r in regles)
    assert P.active_rules_for("pop")["kick_decay"]["dir"] == "-"


def test_exploration_jamais_nulle(memoire_isolee, tmp_path):
    import learn
    import params as P
    _sessions(tmp_path / "rendu")
    for _ in range(12):  # A très bien noté, répété : la distribution se resserre
        learn.learn(tmp_path / "rendu", {"A": 5, "B": 1, "C": 1})
    best = P.resolve("pop", "A", np.random.default_rng(0))[0]["kick_pattern"]
    hors = np.mean([P.resolve("pop", "B", np.random.default_rng(k))[0]["kick_pattern"] != best for k in range(300)])
    assert hors >= 0.12


def test_status_lisible(memoire_isolee, tmp_path):
    import learn
    import status
    _sessions(tmp_path / "rendu")
    learn.learn(tmp_path / "rendu", {"A": 5}, commentaire="plus de squeak")
    txt = status.render(status.collect())
    assert "Règles actives (1)" in txt and "squeak_amount" in txt and "Profil « pop »" in txt
