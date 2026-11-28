#!/usr/bin/env python3
"""Séparation de stems : Demucs htdemucs (voix, batterie, basse, autres) ou mode rapide.

Mode rapide (--fast) : séparation harmonique/percussive librosa + extraction du centre
stéréo pour une voix approximative. Beaucoup plus rapide, nettement moins propre
(la « voix » contient des nappes/synthés du même registre).

Les stems sont mis en cache (cache/<empreinte>/<mode>/) : relancer un rendu ou une
variante ne refait pas la séparation.

CLI : separate.py <fichier> [--fast] -o dossier_stems/
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jc_common import CACHE_DIR, SR, array_hash, decode, log, write_wav  # noqa: E402

STEMS = ["vocals", "drums", "bass", "other"]


def separate_demucs(y: np.ndarray, sr: int = SR) -> dict:
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    torch.set_num_threads(max(1, __import__("os").cpu_count() or 1))
    torch.manual_seed(0)
    model = get_model("htdemucs")
    model.eval()
    if sr != model.samplerate:
        raise ValueError("Demucs attend du 44,1 kHz")
    wav = torch.from_numpy(y.astype(np.float32))
    ref = wav.mean(0)
    mu, sd = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        out = apply_model(model, ((wav - mu) / sd)[None], device="cpu", shifts=0, split=True,
                          overlap=0.25, progress=False)[0]
    out = out * sd + mu
    return {name: out[i].numpy().astype(np.float32) for i, name in enumerate(model.sources)}


def separate_fast(y: np.ndarray, sr: int = SR) -> dict:
    n_fft, hop = 4096, 1024
    St = [librosa.stft(ch, n_fft=n_fft, hop_length=hop) for ch in y]
    H, P = zip(*[librosa.decompose.hpss(s, margin=(1.0, 2.0)) for s in St])
    f = librosa.fft_frequencies(sr=sr, n_fft=n_fft)[:, None]
    Hm = (H[0] + H[1]) / 2
    Hs = (H[0] - H[1]) / 2
    center = np.abs(Hm) ** 2 / (np.abs(Hm) ** 2 + 4 * np.abs(Hs) ** 2 + 1e-12)
    band = ((f > 180) & (f < 7000)).astype(float)
    vmask = center * band
    bmask = (f < 160).astype(float)
    ist = lambda S: librosa.istft(S, hop_length=hop, length=y.shape[1])  # noqa: E731
    stems = {
        "vocals": np.vstack([ist(h * vmask) for h in H]),
        "bass": np.vstack([ist(h * bmask) for h in H]),
        "other": np.vstack([ist(h * (1 - vmask) * (1 - bmask)) for h in H]),
        "drums": np.vstack([ist(p) for p in P]),
    }
    return {k: v.astype(np.float32) for k, v in stems.items()}


def separate(y: np.ndarray, sr: int = SR, fast: bool = False, use_cache: bool = True) -> dict:
    mode = "rapide" if fast else "demucs"
    key = array_hash(y[:, :: 97])[:16]
    cdir = CACHE_DIR / key / mode
    if use_cache and all((cdir / f"{s}.wav").exists() for s in STEMS):
        log(f"Stems lus depuis le cache ({mode})")
        return {s: np.ascontiguousarray(sf.read(cdir / f"{s}.wav", dtype="float32")[0].T) for s in STEMS}
    t0 = time.time()
    log(f"Séparation des stems ({mode})…")
    stems = separate_fast(y, sr) if fast else separate_demucs(y, sr)
    log(f"Séparation terminée en {time.time() - t0:.0f} s")
    if use_cache:
        for s in STEMS:
            write_wav(cdir / f"{s}.wav", stems[s])
    return stems


def main():
    ap = argparse.ArgumentParser(description="Séparation en 4 stems (Demucs) ou mode rapide (HPSS).")
    ap.add_argument("fichier")
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("-o", "--sortie", required=True)
    a = ap.parse_args()
    st = separate(decode(a.fichier), SR, a.fast)
    out = Path(a.sortie)
    for k, v in st.items():
        write_wav(out / f"{k}.wav", v)
    log(f"Stems écrits dans {out}")


if __name__ == "__main__":
    main()
