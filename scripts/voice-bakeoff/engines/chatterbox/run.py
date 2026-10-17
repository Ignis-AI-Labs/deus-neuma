#!/usr/bin/env python3
"""Voice bake-off runner for the Resemble AI Chatterbox family.

Engines (all MIT, all clone from refs/Hannah.wav + refs/James.wav):
  chatterbox-turbo  ResembleAI/chatterbox-turbo  350M, native paralinguistic tags
  chatterbox        ResembleAI/chatterbox        500M original, exaggeration + cfg_weight
  chatterbox-nano   ResembleAI/chatterbox-nano   110M, CPU tier (run on CPU)
  chatterbox-flash  ResembleAI/chatterbox-flash  block-diffusion T3 (FlashInfer or SDPA engine)

Contract: ../../README.md. Usage (from this directory):
  HF_HOME=../../../../voice-engines/_models/_hf_cache uv run run.py \
    --lines ../../lines.json --samples ../../../../voice-engines/_samples/bakeoff-2026-09-30 \
    [--engines chatterbox-turbo,chatterbox,chatterbox-nano,chatterbox-flash] [--nano-gpu-probe]

No package in this family exposes a streaming API (chatterbox-tts 0.1.7/master
has none; chatterbox-flash 0.1.0 streams block-by-block internally but its
public API returns the whole utterance), so ttfbMs is omitted.
"""
from __future__ import annotations

import argparse
import gc
import json
import os
import random
import re
import statistics
import sys
import time
import traceback
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

PEAK_DBFS = -1.0
DIALOGUE_GAP_MS = 350
NANO_CPU_THREADS = 8  # the card's reference config: […]

# Turbo / Nano: tags the model card documents and the tokenizer carries as
# added tokens (added_tokens.json). There is no breath token -> dropped.
TURBO_TAGS = {"laugh": "[laugh]", "chuckle": "[chuckle]", "sigh": "[sigh]", "gasp": "[gasp]"}
NO_TAGS: dict[str, str] = {}

ENGINES = {
    "chatterbox-turbo": {
        "model": "ResembleAI/chatterbox-turbo",
        "device": "cuda",
        "tags": TURBO_TAGS,
        "cues": "native [laugh] [chuckle] [sigh] [gasp] (Turbo added tokens); {breath} dropped (no token)",
    },
    "chatterbox": {
        "model": "ResembleAI/chatterbox",
        "device": "cuda",
        "tags": NO_TAGS,
        "cues": "no paralinguistic tokens: every {cue} removed; emotion carried by exaggeration/cfg_weight from lines.json intensity",
    },
    "chatterbox-nano": {
        "model": "ResembleAI/chatterbox-nano",
        "device": "cpu",
        "tags": TURBO_TAGS,
        "cues": "native [laugh] [chuckle] [sigh] [gasp] (Nano shares Turbo's tokenizer/added tokens); {breath} dropped (no token)",
    },
    "chatterbox-flash": {
        "model": "ResembleAI/chatterbox-flash",
        "device": "cuda",
        "tags": NO_TAGS,
        "cues": "no paralinguistic tokens (original Chatterbox EnTokenizer): every {cue} removed",
    },
}


# ---------------------------------------------------------------- helpers

def translate(text: str, table: dict[str, str]) -> str:
    out = re.sub(r"\{(\w+)\}", lambda m: table.get(m.group(1), ""), text)
    return " ".join(out.split())


def seed_all(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def peak_norm(wav: np.ndarray) -> np.ndarray:
    peak = float(np.max(np.abs(wav))) if wav.size else 0.0
    if peak <= 0:
        return wav
    return wav * (10 ** (PEAK_DBFS / 20) / peak)


def write_wav(path: Path, wav: np.ndarray, sr: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), np.clip(peak_norm(wav.astype(np.float32)), -1, 1), sr, subtype="PCM_16")


def exaggeration_for(intensity: float) -> float:
    return round(0.35 + 0.5 * intensity, 3)


def cfg_for(exaggeration: float) -> float:
    # Card: defaults 0.5/0.5; expressive speech -> exaggeration ~0.7+ with cfg ~0.3
    # (higher exaggeration speeds speech up; lower cfg slows it back down).
    return round(min(0.5, max(0.3, 0.5 - (exaggeration - 0.5))), 3)


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9']+", re.sub(r"\[[^\]]*\]", " ", text)))


def sync(device: str) -> None:
    if device == "cuda":
        torch.cuda.synchronize()


# ---------------------------------------------------------------- engines

class Engine:
    sr: int
    settings: dict
    device: str

    def __init__(self, engine_id: str, device: str, refs: dict[str, Path]):
        self.id = engine_id
        self.device = device
        self.refs = refs
        self.conds: dict = {}
        self.load()
        for voice, ref in refs.items():
            self.conds[voice] = self.prepare(ref)

    def load(self) -> None: ...
    def prepare(self, ref: Path): ...
    def synth(self, text: str, voice: str, intensity: float) -> np.ndarray: ...

    def free(self) -> None:
        for k in list(vars(self)):
            if k not in ("id", "device", "sr", "settings"):
                setattr(self, k, None)


class TurboEngine(Engine):
    nano = False

    def load(self):
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        self.model = ChatterboxTurboTTS.from_pretrained(device=self.device, nano=self.nano)
        self.sr = self.model.sr
        # generate() defaults of chatterbox master (the card's recommended path)
        self.kw = dict(temperature=0.8, top_p=0.95, top_k=1000, repetition_penalty=1.2)
        self.settings = {**self.kw, "norm_loudness": True, "exaggeration/cfg": "unsupported by Turbo/Nano (ignored)",
                         "conditioning": "prepare_conditionals once per voice (ref loudness-normed to -27 LUFS by the model)"}

    def prepare(self, ref):
        self.model.prepare_conditionals(str(ref), norm_loudness=True)
        return self.model.conds

    def synth(self, text, voice, intensity):
        self.model.conds = self.conds[voice]
        return self.model.generate(text, **self.kw).squeeze(0).cpu().numpy()


class NanoEngine(TurboEngine):
    nano = True


class OriginalEngine(Engine):
    def load(self):
        from chatterbox.tts import ChatterboxTTS
        self.model = ChatterboxTTS.from_pretrained(device=self.device)
        self.sr = self.model.sr
        self.kw = dict(temperature=0.8, min_p=0.05, top_p=1.0, repetition_penalty=1.2)
        self.settings = {**self.kw,
                         "exaggeration": "0.35 + 0.5*intensity",
                         "cfg_weight": "clamp(0.5 - (exaggeration - 0.5), 0.3, 0.5)  (card: default 0.5; ~0.3 for exaggeration >= 0.7)",
                         "perIntensity": {str(i): {"exaggeration": exaggeration_for(i), "cfg_weight": cfg_for(exaggeration_for(i))}
                                          for i in (0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9)}}

    def prepare(self, ref):
        self.model.prepare_conditionals(str(ref), exaggeration=0.5)
        return self.model.conds

    def synth(self, text, voice, intensity):
        self.model.conds = self.conds[voice]
        ex = exaggeration_for(intensity)
        return self.model.generate(text, exaggeration=ex, cfg_weight=cfg_for(ex), **self.kw).squeeze(0).cpu().numpy()


class FlashEngine(Engine):
    def load(self):
        from chatterbox_flash import ChatterboxFlashTTS
        # FlashInfer (the paper engine) was tried on this rig and babbled: its
        # sm_120 kernels are not in flashinfer-jit-cache 0.6.17+cu128, so they JIT
        # with nvcc 13.2 + gcc-15, and the result produced garbled run-on speech
        # (see meta notes). The package's pure-PyTorch SDPA engine is its documented
        # fallback ("numerically matching output") and speaks the script cleanly.
        # Override with CHATTERBOX_FLASH_ENGINE=flashinfer to re-test.
        self.backend = os.environ.get("CHATTERBOX_FLASH_ENGINE", "torch")
        self.model = ChatterboxFlashTTS.from_pretrained("ResembleAI/chatterbox-flash", device=self.device)
        self.sr = self.model.sr
        # tts.generate() defaults == the card's paper configuration (D=16, K=10, temp 0.6 ...)
        self.kw = dict(num_steps=10, temperature=0.6, time_shift_tau=0.1, omnivoice_schedule_t_shift=0.5,
                       cfg_scale=1.0, position_temperature=5.0, n_cfm_timesteps=2, backend=self.backend)
        self.settings = {**self.kw, "drf_block_size": 16, "dtype": "bfloat16", "exaggeration": 0.5,
                         "note": "paper/card defaults; the card documents no exaggeration control, so it stays at the 0.5 default"}

    def prepare(self, ref):
        return self.model.prepare_conditionals(str(ref), exaggeration=0.5)

    def synth(self, text, voice, intensity):
        self.model.conds = self.conds[voice]
        return self.model.generate(text, **self.kw).float().cpu().numpy().reshape(-1)


CLASSES = {"chatterbox-turbo": TurboEngine, "chatterbox": OriginalEngine,
           "chatterbox-nano": NanoEngine, "chatterbox-flash": FlashEngine}


# ---------------------------------------------------------------- runner

def timed(eng: Engine, text: str, voice: str, intensity: float, seed: int) -> tuple[np.ndarray, dict]:
    seed_all(seed)
    sync(eng.device)
    t0 = time.perf_counter()
    wav = eng.synth(text, voice, intensity)
    sync(eng.device)
    gen_ms = (time.perf_counter() - t0) * 1000
    audio_ms = len(wav) / eng.sr * 1000
    return wav, {"genMs": round(gen_ms), "audioMs": round(audio_ms),
                 "rtf": round(gen_ms / audio_ms, 3) if audio_ms else None}


def sanity(key: str, text: str, audio_ms: float, notes: list[str]) -> None:
    words = word_count(text)
    tags = len(re.findall(r"\[[^\]]*\]", text))
    if not words:
        return
    per_word = (audio_ms - 800 * tags) / words
    if per_word > 750:
        notes.append(f"{key}: {audio_ms/1000:.1f}s for {words} words ({per_word:.0f} ms/word) - suspiciously long (runaway/babble?)")
    elif per_word < 170:
        notes.append(f"{key}: {audio_ms/1000:.1f}s for {words} words ({per_word:.0f} ms/word) - suspiciously short (truncated?)")


def run_engine(engine_id: str, lines: dict, samples: Path, device: str | None, notes_extra: list[str]) -> dict:
    spec = ENGINES[engine_id]
    device = device or spec["device"]
    out = samples / "out" / engine_id
    out.mkdir(parents=True, exist_ok=True)
    refs = {v: samples / info["ref"] for v, info in lines["voices"].items()}
    takes = int(lines.get("takes", 2))
    tags = spec["tags"]
    notes: list[str] = list(notes_extra)

    if device == "cuda":
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()
    else:
        torch.set_num_threads(NANO_CPU_THREADS)

    t_load = time.perf_counter()
    eng = CLASSES[engine_id](engine_id, device, refs)
    load_s = time.perf_counter() - t_load
    print(f"[{engine_id}] loaded on {device} in {load_s:.1f}s (sr={eng.sr})", flush=True)

    # warm-up (not saved, not timed): first-call kernels / graph capture
    for v in refs:
        seed_all(0)
        eng.synth(translate("Hello there, this is a short warm-up sentence.", tags), v, 0.5)
    sync(device)

    meta = {
        "engine": engine_id,
        "model": spec["model"],
        "license": "MIT",
        "clones": True,
        "voiceNote": "cloned from refs/Hannah.wav and refs/James.wav (zero-shot, per-voice conditionals prepared once)",
        "cues": spec["cues"],
        "contextAware": False,
        "settings": {**eng.settings, "seed": "take N = seed N (random/numpy/torch reseeded before every clip)",
                     "sampleRate": eng.sr, "loadSeconds": round(load_s, 1)},
        "device": device,
        "peakVramMb": None,
        "clips": {},
        "notes": notes,
    }
    if device == "cpu":
        meta["settings"]["cpuThreads"] = NANO_CPU_THREADS
    clips = meta["clips"]

    items = [(ln, "conversation") for ln in lines["conversation"]] + [(ln, "readAloud") for ln in lines["readAloud"]]
    try:
        for take in range(1, takes + 1):
            for ln, _ in items:
                text = translate(ln["text"], tags)
                for voice in ln["voices"]:
                    key = f"{ln['id']}__{voice}__t{take}"
                    wav, m = timed(eng, text, voice, ln["intensity"], take)
                    write_wav(out / f"{key}.wav", wav, eng.sr)
                    clips[key] = m
                    sanity(key, text, m["audioMs"], notes)
                    print(f"[{engine_id}] {key} {m}", flush=True)

            dlg = lines["dialogue"]
            gap = np.zeros(int(eng.sr * DIALOGUE_GAP_MS / 1000), dtype=np.float32)
            parts, gen_total = [], 0
            for n, turn in enumerate(dlg["turns"]):
                text = translate(turn["text"], tags)
                wav, m = timed(eng, text, turn["speaker"], turn["intensity"], take)
                gen_total += m["genMs"]
                sanity(f"{dlg['id']}__turn{n}__t{take}", text, m["audioMs"], notes)
                if turn["speaker"] == "hannah":
                    key = f"{dlg['id']}__turn{n}__t{take}"
                    write_wav(out / f"{key}.wav", wav, eng.sr)
                    clips[key] = m
                    print(f"[{engine_id}] {key} {m}", flush=True)
                if parts:
                    parts.append(gap)
                parts.append(peak_norm(wav.astype(np.float32)))
            full = np.concatenate(parts)
            key = f"{dlg['id']}__t{take}"
            write_wav(out / f"{key}.wav", full, eng.sr)
            audio_ms = len(full) / eng.sr * 1000
            clips[key] = {"genMs": gen_total, "audioMs": round(audio_ms), "rtf": round(gen_total / audio_ms, 3)}
            print(f"[{engine_id}] {key} {clips[key]}", flush=True)
    except Exception as e:  # keep partial output + say why
        notes.append(f"run aborted: {type(e).__name__}: {e}")
        traceback.print_exc()
    finally:
        if device == "cuda":
            meta["peakVramMb"] = round(torch.cuda.max_memory_allocated() / 2**20)
        rtfs = [c["rtf"] for k, c in clips.items() if c.get("rtf") and "__turn" not in k and not k.startswith(lines["dialogue"]["id"] + "__t")]
        meta["settings"]["medianRtfLineClips"] = round(statistics.median(rtfs), 3) if rtfs else None
        meta["settings"]["wavCount"] = len(list(out.glob("*.wav")))
        eng.free()
        del eng
        gc.collect()
        if device == "cuda":
            torch.cuda.empty_cache()
    return meta


def nano_gpu_probe(lines: dict, samples: Path) -> dict:
    """Cheap GPU speed probe for Nano: take-1 hannah conversation lines, not saved."""
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    refs = {"hannah": samples / lines["voices"]["hannah"]["ref"]}
    eng = NanoEngine("chatterbox-nano", "cuda", refs)
    seed_all(0)
    eng.synth("Hello there, this is a short warm-up sentence.", "hannah", 0.5)
    rtfs = []
    for ln in lines["conversation"]:
        _, m = timed(eng, translate(ln["text"], TURBO_TAGS), "hannah", ln["intensity"], 1)
        rtfs.append(m["rtf"])
    probe = {"device": "cuda", "clips": len(rtfs), "medianRtf": round(statistics.median(rtfs), 3),
             "peakVramMb": round(torch.cuda.max_memory_allocated() / 2**20)}
    eng.free()
    gc.collect()
    torch.cuda.empty_cache()
    return probe


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", required=True, type=Path)
    ap.add_argument("--samples", required=True, type=Path)
    ap.add_argument("--engines", default=",".join(ENGINES))
    ap.add_argument("--nano-gpu-probe", action="store_true", help="also time Nano on CUDA (recorded in meta, no WAVs)")
    args = ap.parse_args()

    lines = json.loads(args.lines.read_text())
    samples = args.samples.resolve()
    rc = 0
    for engine_id in [e.strip() for e in args.engines.split(",") if e.strip()]:
        if engine_id not in ENGINES:
            print(f"unknown engine {engine_id}; known: {', '.join(ENGINES)}", file=sys.stderr)
            return 2
        extra: list[str] = []
        if engine_id == "chatterbox-nano":
            extra.append(f"generated on CPU ({NANO_CPU_THREADS} torch threads) - Nano's purpose; the rig's CPU is shared with other work")
        if engine_id in ("chatterbox-turbo", "chatterbox", "chatterbox-nano"):
            extra.append("outputs carry Resemble's Perth imperceptible watermark (applied by the package)")
        extra.append("no streaming API in the package, so ttfbMs is omitted")
        meta = run_engine(engine_id, lines, samples, None, extra)
        if engine_id == "chatterbox-flash":
            meta["notes"].append(
                f"T3 engine: {meta['settings'].get('backend')}. The paper's FlashInfer engine (paged KV + CUDA graphs) "
                "was tried first: flashinfer 0.6.17 + jit-cache cu128 lacks these sm_120 kernels, they JIT-compiled with "
                "nvcc 13.2 (CC=g++-15) and every clip came out as garbled run-on babble (15 s for a 19-word line); the "
                "SDPA engine speaks the same text cleanly. So speed here is the unoptimised fallback, not the card's "
                "~0.1 RTF / ~110 ms TTFP.")
        if engine_id == "chatterbox-nano" and args.nano_gpu_probe:
            try:
                probe = nano_gpu_probe(lines, samples)
                meta["gpuProbe"] = probe
                meta["notes"].append(f"GPU probe (not the sample set): median RTF {probe['medianRtf']} on cuda, peak VRAM {probe['peakVramMb']} MB")
            except Exception as e:
                meta["notes"].append(f"GPU probe failed: {type(e).__name__}: {e}")
        path = samples / "out" / engine_id / "meta.json"
        path.write_text(json.dumps(meta, indent=2) + "\n")
        print(f"[{engine_id}] wrote {path} ({meta['settings']['wavCount']} wavs, median RTF {meta['settings']['medianRtfLineClips']})", flush=True)
        if any(n.startswith("run aborted") for n in meta["notes"]):
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
