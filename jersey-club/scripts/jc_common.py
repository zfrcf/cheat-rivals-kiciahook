"""Utilitaires partagés par tous les scripts du skill jersey-club.

Conventions :
- l'audio circule en numpy float32, forme (2, n) (stéréo), à 44,1 kHz ;
- la grille rythmique compte 48 ticks par mesure 4/4 (12 par temps) ;
- tous les messages destinés à l'utilisateur sont en français.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
import yaml

SKILL_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = SKILL_DIR / "config"
MEMORY_DIR = Path(os.environ.get("JERSEY_MEMORY_DIR", SKILL_DIR / "memory"))
ASSETS_DIR = SKILL_DIR / "assets"
CACHE_DIR = Path(os.environ.get("JERSEY_CACHE_DIR", SKILL_DIR / "cache"))

SR = 44100
TICKS_PER_BAR = 48
TICKS_PER_BEAT = 12

PROFILS = ["rap", "rnb", "pop", "electro", "variete_fr", "acoustique"]


# --------------------------------------------------------------------------- I/O
def log(msg: str) -> None:
    print(f"[jersey] {msg}", file=sys.stderr, flush=True)


def load_yaml(path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def save_yaml(path, data) -> None:
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False, default_flow_style=None)


def load_json(path, default=None):
    p = Path(path)
    if not p.exists():
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=_json_default)
    tmp.replace(p)


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, Path):
        return str(o)
    raise TypeError(f"non sérialisable : {type(o)}")


def now_iso() -> str:
    return _dt.datetime.now().replace(microsecond=0).isoformat()


def today() -> str:
    return _dt.date.today().isoformat()


def file_hash(path, n=1 << 20) -> str:
    """Empreinte rapide d'un fichier (taille + premier Mo) : sert de clé de cache."""
    h = hashlib.sha1()
    p = Path(path)
    h.update(str(p.stat().st_size).encode())
    with open(p, "rb") as f:
        h.update(f.read(n))
    return h.hexdigest()[:16]


def array_hash(y: np.ndarray) -> str:
    return hashlib.sha1(np.ascontiguousarray(y, dtype=np.float32).tobytes()).hexdigest()


def decode(path, sr: int = SR) -> np.ndarray:
    """Décode n'importe quel format lisible par ffmpeg → (2, n) float32 à `sr`."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Fichier introuvable : {path}")
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg est introuvable (sudo apt install ffmpeg)")
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "dec.wav"
        cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(path), "-vn",
               "-ac", "2", "-ar", str(sr), "-c:a", "pcm_f32le", str(out)]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0 or not out.exists():
            raise RuntimeError(f"Format non supporté ou fichier illisible ({path.name}) : {r.stderr.strip()[:300]}")
        y, _ = sf.read(out, dtype="float32", always_2d=True)
    return np.ascontiguousarray(y.T)


def write_wav(path, y: np.ndarray, sr: int = SR, subtype="FLOAT") -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    y = np.atleast_2d(y)
    sf.write(str(path), y.T, sr, subtype=subtype)


def wav_to_mp3(wav, mp3, kbps=320) -> None:
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(wav),
                    "-c:a", "libmp3lame", "-b:a", f"{kbps}k", str(mp3)], check=True)


# ------------------------------------------------------------------------ signal
def mono(y: np.ndarray) -> np.ndarray:
    return y.mean(axis=0) if y.ndim == 2 else y


def stereo(y: np.ndarray) -> np.ndarray:
    return np.vstack([y, y]) if y.ndim == 1 else y


def db(x) -> float:
    return float(20 * np.log10(max(float(x), 1e-12)))


def undb(d) -> float:
    return float(10 ** (d / 20))


def fade(x: np.ndarray, n_in: int, n_out: int) -> np.ndarray:
    """Fondus linéaires (in/out) en place sur le dernier axe ; renvoie x."""
    n = x.shape[-1]
    n_in, n_out = min(n_in, n // 2), min(n_out, n // 2)
    if n_in > 0:
        x[..., :n_in] *= np.linspace(0, 1, n_in, dtype=x.dtype)
    if n_out > 0:
        x[..., n - n_out:] *= np.linspace(1, 0, n_out, dtype=x.dtype)
    return x


def add_at(buf: np.ndarray, x: np.ndarray, start: int, gain: float = 1.0) -> None:
    """Ajoute x (mono ou stéréo) dans buf (2, N) à l'échantillon `start` (tronque)."""
    if start >= buf.shape[1]:
        return
    x = stereo(x)
    s0 = max(start, 0)
    off = s0 - start
    n = min(x.shape[1] - off, buf.shape[1] - s0)
    if n > 0:
        buf[:, s0:s0 + n] += gain * x[:, off:off + n]


def pan_gains(pan: float):
    """Pan à puissance constante, pan ∈ [-1, 1]."""
    a = (pan + 1) * np.pi / 4
    return float(np.cos(a)), float(np.sin(a))


# ------------------------------------------------------------------------ grille
class Grid:
    """Grille temporelle à tempo fixe : mesures de 48 ticks."""

    def __init__(self, bpm: float, sr: int = SR):
        self.bpm = float(bpm)
        self.sr = sr
        self.beat_sec = 60.0 / self.bpm
        self.tick_sec = self.beat_sec / TICKS_PER_BEAT
        self.bar_sec = self.beat_sec * 4

    def bar_start(self, bar: int) -> int:
        return int(round(bar * self.bar_sec * self.sr))

    def tick_to_sample(self, bar: int, tick: float) -> int:
        return int(round((bar * self.bar_sec + tick * self.tick_sec) * self.sr))

    def ticks_to_samples(self, ticks: float) -> int:
        return int(round(ticks * self.tick_sec * self.sr))


def parse_ticks(spec) -> list[int]:
    """Convertit une définition de pattern en liste de ticks (0..47).

    Accepte une liste explicite, ou une chaîne « every N » (un coup tous les N ticks).
    """
    if isinstance(spec, str):
        s = spec.strip().lower()
        if s.startswith("every"):
            step = int(s.split()[1])
            return list(range(0, TICKS_PER_BAR, step))
        raise ValueError(f"Pattern inconnu : {spec}")
    if isinstance(spec, dict):
        spec = spec.get("ticks", [])
    return sorted(int(t) % TICKS_PER_BAR for t in spec)


def libs_versions() -> dict:
    import importlib
    out = {"python": sys.version.split()[0]}
    for m in ["numpy", "scipy", "librosa", "soundfile", "pedalboard", "pyloudnorm",
              "pyrubberband", "mido", "yaml", "demucs", "torch"]:
        try:
            out[m] = getattr(importlib.import_module(m), "__version__", "?")
        except Exception:
            out[m] = None
    try:
        r = subprocess.run(["rubberband", "--version"], capture_output=True, text=True)
        out["rubberband-cli"] = (r.stdout + r.stderr).strip().splitlines()[-1]
    except Exception:
        out["rubberband-cli"] = None
    return out
