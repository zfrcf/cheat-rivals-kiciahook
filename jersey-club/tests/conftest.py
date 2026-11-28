"""Fixtures communes : audio synthétique généré à la volée, mémoire isolée."""
import os
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
OUT = ROOT / "tests" / "_out"
OUT.mkdir(parents=True, exist_ok=True)


@pytest.fixture()
def memoire_isolee(tmp_path, monkeypatch):
    """Redirige memory/ vers un dossier temporaire (copie de l'état initial)."""
    mem = tmp_path / "memory"
    (mem / "references").mkdir(parents=True)
    (mem / "history").mkdir()
    src = ROOT / "memory" / "lessons.md"
    if src.exists():
        shutil.copy(src, mem / "lessons.md")
    monkeypatch.setenv("JERSEY_MEMORY_DIR", str(mem))
    import importlib
    import jc_common
    importlib.reload(jc_common)
    for mod in ["params", "learn", "status", "reference"]:
        if mod in sys.modules:
            importlib.reload(sys.modules[mod])
    yield mem


@pytest.fixture(scope="session")
def chanson_wav():
    from jc_common import write_wav
    from synth import song
    p = OUT / "chanson_synth.wav"
    if not p.exists():
        write_wav(p, song(60, 100), subtype="PCM_16")
    return p
