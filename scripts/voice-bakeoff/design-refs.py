#!/usr/bin/env python3
"""Designed reference voices for the voice bake-off (round 2 cloning sources).

Round 1 cloned flat 10-second donor clips. This script DESIGNS six expressive,
conversational voices from natural-language descriptions (no reference audio)
on the three voice-design engines the bake-off already carries, so later
cloning runs can use a lively ~20 s clip WITH its transcript.

  voxcpm2       openbmb/VoxCPM2 "Voice Design": "(description)text", no reference
                venv: scripts/voice-bakeoff/engines/dia-voxcpm/.venv
  qwen3-design  Qwen3-TTS-12Hz-1.7B-VoiceDesign: generate_voice_design(instruct=...)
                venv: voice-engines/qwen3/.venv (weights voice-engines/_models/qwen3/voice-design;
                the sidecar is never started or touched)
  maya1         maya-research/maya1: <description="..."> + inline <laugh>
                venv: scripts/voice-bakeoff/engines/snac-lm/.venv
  transcribe    faster-whisper (voice-engines/_models/whisper, CPU int8) over every clip
                venv: voice-engines/whisper/.venv

Output: voice-engines/_samples/bakeoff-2026-09-30/pool/designed/
  <engine>__<voiceId>__s<seed>.wav   mono 16-bit, native rate (>= 24 kHz), peak -1 dBFS
  designed.json                      one entry per clip: engine, voiceId, description,
                                     promptText, seed, duration, transcript, WER, flags

Run everything (one model on the GPU at a time, each engine in its own process):
  python3 scripts/voice-bakeoff/design-refs.py all
One engine / one step (any python; it re-execs under the right venv):
  python3 scripts/voice-bakeoff/design-refs.py gen --engine maya1 [--voices f-warm,m-deep] [--seeds 1,2]
  python3 scripts/voice-bakeoff/design-refs.py transcribe
"""
from __future__ import annotations

import argparse
import gc
import json
import os
import re
import subprocess
import sys
import time
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
OUT = REPO / "voice-engines" / "_samples" / "bakeoff-2026-09-30" / "pool" / "designed"
MANIFEST = OUT / "designed.json"
HF_HOME = REPO / "voice-engines" / "_models" / "_hf_cache"
QWEN3_DESIGN_DIR = REPO / "voice-engines" / "_models" / "qwen3" / "voice-design"
WHISPER_DIR = REPO / "voice-engines" / "_models" / "whisper"

VENVS = {
    "voxcpm2": HERE / "engines" / "dia-voxcpm" / ".venv" / "bin" / "python",
    "qwen3-design": REPO / "voice-engines" / "qwen3" / ".venv" / "bin" / "python",
    "maya1": HERE / "engines" / "snac-lm" / ".venv" / "bin" / "python",
    "transcribe": REPO / "voice-engines" / "whisper" / ".venv" / "bin" / "python",
}
ENGINES = ("voxcpm2", "qwen3-design", "maya1")
SEEDS = (1, 2)
PEAK_DBFS = -1.0

PASSAGE = ("Oh, hey! Honestly, I'm so glad you called. I was just sitting here thinking about, um, "
           "last weekend? That whole thing at the lake. {laugh} I still can't believe you jumped in. "
           "Anyway... how are you, really? You sounded a little tired yesterday, and I just wanted "
           "to check on you.")

VOICE_IDS = ("f-warm", "f-bright", "f-intimate", "m-warm", "m-deep", "m-bright")

# The brief's descriptions, one meaning, three documented formats.
DESCRIPTIONS = {
    # VoxCPM2 README "Voice Design": a short natural-language description in parentheses
    # at the start of the text, e.g. […].
    "voxcpm2": {
        "f-warm": "A warm, playful American woman in her late twenties, soft and slightly husky voice, "
                  "smiling while she talks, relaxed conversational pace",
        "f-bright": "A bright, upbeat American young woman in her mid twenties, expressive and animated "
                    "voice, quick to laugh",
        "f-intimate": "A calm, intimate woman in her thirties, low and smooth voice, gentle and unhurried, "
                      "close to the microphone",
        "m-warm": "A warm, easygoing American man in his late twenties, friendly and a little playful "
                  "voice, relaxed pace",
        "m-deep": "A deep, calm man in his thirties, smooth and grounded voice, gentle and unhurried",
        "m-bright": "A bright, energetic American young man in his twenties, expressive voice, laughs easily",
    },
    # Qwen3-TTS VoiceDesign: free-form instruct describing the voice in full sentences.
    "qwen3-design": {
        "f-warm": "A warm, playful American woman in her late twenties. Her voice is soft and slightly "
                  "husky, she smiles while she talks, and she speaks at a relaxed, conversational pace.",
        "f-bright": "A bright, upbeat American young woman in her mid twenties. She is expressive and "
                    "animated, and quick to laugh.",
        "f-intimate": "A calm, intimate woman in her thirties. Her voice is low and smooth, gentle and "
                      "unhurried, recorded close to the microphone.",
        "m-warm": "A warm, easygoing American man in his late twenties. He sounds friendly and a little "
                  "playful, and speaks at a relaxed pace.",
        "m-deep": "A deep, calm man in his thirties. His voice is smooth and grounded, gentle and unhurried.",
        "m-bright": "A bright, energetic American young man in his twenties. He is expressive and laughs easily.",
    },
    # Maya1 prompt.txt attribute vocabulary ([…]), the brief's extra colour in plain words.
    "maya1": {
        "f-warm": "Realistic female voice in her late 20s with an american accent. Normal pitch, warm "
                  "timbre, soft and slightly husky, smiling while she talks, conversational pacing, "
                  "playful tone at med intensity, casual register.",
        "f-bright": "Realistic female voice in her mid 20s with an american accent. High pitch, bright "
                    "timbre, brisk pacing, upbeat excited tone at high intensity, expressive and animated, "
                    "quick to laugh, casual register.",
        "f-intimate": "Realistic female voice in her 30s. Low pitch, smooth timbre, slow pacing, calm "
                      "intimate tone at low intensity, gentle and unhurried, close to the microphone, "
                      "casual register.",
        "m-warm": "Realistic male voice in his late 20s with an american accent. Normal pitch, warm "
                  "timbre, conversational pacing, friendly and easygoing tone at med intensity, a little "
                  "playful, casual register.",
        "m-deep": "Realistic male voice in his 30s. Low pitch, deep smooth timbre, slow pacing, calm "
                  "grounded tone at low intensity, gentle and unhurried, casual register.",
        "m-bright": "Realistic male voice in his 20s with an american accent. Normal pitch, bright timbre, "
                    "brisk pacing, energetic tone at high intensity, expressive, laughs easily, casual register.",
    },
}

# {laugh}: Maya1 has a trained <laugh> tag (emotions.txt). VoxCPM2 and Qwen3 VoiceDesign
# have no laugh token, so the cue is dropped for them.
LAUGH = {"voxcpm2": None, "qwen3-design": None, "maya1": "<laugh>"}

MODELS = {
    "voxcpm2": "openbmb/VoxCPM2 (voice design, no reference audio)",
    "qwen3-design": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign (bf16)",
    "maya1": "maya-research/maya1 (bf16) + hubertsiuzdak/snac_24khz",
}


def passage_for(engine: str) -> str:
    tag = LAUGH[engine]
    out = PASSAGE.replace("{laugh}", tag if tag else "")
    return re.sub(r"\s+", " ", out).strip()


def clip_name(engine: str, voice: str, seed: int) -> str:
    return f"{engine}__{voice}__s{seed}.wav"


# ------------------------------------------------------------------ io -------
def load_manifest() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {"passage": PASSAGE, "clips": []}


def save_manifest(m: dict) -> None:
    m["clips"].sort(key=lambda c: (ENGINES.index(c["engine"]), VOICE_IDS.index(c["voiceId"]), c["seed"]))
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = MANIFEST.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(MANIFEST)


def upsert(m: dict, entry: dict) -> None:
    m["clips"] = [c for c in m["clips"] if c["file"] != entry["file"]] + [entry]


def write_wav(path: Path, audio, sr: int) -> float:
    import numpy as np

    a = np.asarray(audio, dtype=np.float32)
    if a.ndim > 1:
        a = a.mean(axis=0) if a.shape[0] < a.shape[-1] else a.mean(axis=-1)
    a = a.reshape(-1)
    peak = float(np.max(np.abs(a))) if a.size else 0.0
    if peak > 1e-9:
        a = a * (10 ** (PEAK_DBFS / 20) / peak)
    pcm = (np.clip(a, -1.0, 1.0) * 32767.0).round().astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sr))
        w.writeframes(pcm.tobytes())
    return len(a) / sr


def seed_all(seed: int) -> None:
    import random

    import numpy as np
    import torch

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def sync() -> None:
    import torch

    if torch.cuda.is_available():
        torch.cuda.synchronize()


# ------------------------------------------------------------- engines -------
class VoxCPM2:
    settings = {"cfg_value": 2.0, "inference_timesteps": 10, "normalize": False, "retry_badcase": True,
                "format": "(description)text — VoxCPM2 README Voice Design", "torch_compile": False}

    def load(self):
        from huggingface_hub import snapshot_download
        from voxcpm import VoxCPM

        local = snapshot_download("openbmb/VoxCPM2", local_files_only=True)
        self.model = VoxCPM.from_pretrained(local, load_denoiser=False, optimize=False)
        self.sr = self.model.tts_model.sample_rate

    def synth(self, description: str, text: str):
        wav = self.model.generate(text=f"({description}){text}", cfg_value=2.0, inference_timesteps=10)
        return wav, self.sr, {}


class Qwen3Design:
    settings = {"language": "English", "non_streaming_mode": False, "max_new_tokens": 600,
                "generation": "checkpoint generation_config.json (temp 0.9, top_k 50, top_p 1.0, rep 1.05)"}

    def load(self):
        import torch
        from qwen_tts import Qwen3TTSModel

        self.model = Qwen3TTSModel.from_pretrained(str(QWEN3_DESIGN_DIR), device_map="cuda",
                                                   dtype=torch.bfloat16)

    def synth(self, description: str, text: str):
        import numpy as np

        wavs, sr = self.model.generate_voice_design(text=text, instruct=description, language="English",
                                                    non_streaming_mode=False, max_new_tokens=600)
        audio = np.concatenate([np.asarray(w, dtype=np.float32) for w in wavs])
        return audio, int(sr), {"hitMaxTokens": len(audio) / sr >= 600 / 12.0 - 0.5}


class Maya1:
    # Maya1 card quick-start settings; max_new_tokens raised from the bake-off's 2048 because
    # the passage is ~20 s (~82 SNAC tokens/s) — the cap is now ~45 s.
    MAX_NEW = 3700
    settings = {"temperature": 0.4, "top_p": 0.9, "repetition_penalty": 1.1, "max_new_tokens": MAX_NEW,
                "min_new_tokens": 28, "trimWarmupSamples": 2048,
                "format": '<description="..."> text, inline <laugh> (maya1 card build_prompt)'}

    def load(self):
        sys.path.insert(0, str(HERE / "engines" / "snac-lm"))
        import run as snac_lm  # the bake-off's own Maya1 runner: prompt layout + SNAC unpacking

        self.m = snac_lm
        spec = dict(snac_lm.MAYA1)
        spec["voices"] = {}
        spec["settings"] = dict(spec["settings"], max_new_tokens=self.MAX_NEW)
        self.spec = spec
        self.runner = snac_lm.Runner(spec, "cuda")

    def synth(self, description: str, text: str):
        self.spec["voices"]["_"] = description
        s = self.spec["settings"]
        import torch

        ids = self.runner.prompt_ids("_", text).to("cuda")
        with torch.inference_mode():
            out = self.runner.model.generate(
                input_ids=ids, attention_mask=torch.ones_like(ids), max_new_tokens=s["max_new_tokens"],
                min_new_tokens=s["min_new_tokens"], do_sample=True, temperature=s["temperature"],
                top_p=s["top_p"], repetition_penalty=s["repetition_penalty"],
                eos_token_id=self.m.END_OF_SPEECH, pad_token_id=self.runner.tok.pad_token_id or 128004)
        gen = out[0, ids.shape[1]:].tolist()
        codes, info = self.runner.codes_from(gen)
        audio = self.m.snac_decode(self.runner.snac, codes)
        if len(audio) > s["trimWarmupSamples"]:
            audio = audio[s["trimWarmupSamples"]:]
        return audio, self.m.SR, {"eos": info["eos"], "newTokens": info["newTokens"],
                                   "hitMaxTokens": len(gen) >= s["max_new_tokens"]}


IMPLS = {"voxcpm2": VoxCPM2, "qwen3-design": Qwen3Design, "maya1": Maya1}


def cmd_gen(engine: str, voices: list[str], seeds: list[int]) -> None:
    import torch

    torch.cuda.reset_peak_memory_stats()
    impl = IMPLS[engine]()
    t0 = time.time()
    impl.load()
    print(f"[{engine}] loaded in {time.time() - t0:.1f}s", flush=True)
    seed_all(0)
    impl.synth(DESCRIPTIONS[engine][voices[0]], "Warming up.")  # untimed warm-up
    text = passage_for(engine)
    for voice in voices:
        desc = DESCRIPTIONS[engine][voice]
        for seed in seeds:
            seed_all(seed)
            sync()
            t = time.perf_counter()
            audio, sr, info = impl.synth(desc, text)
            sync()
            gen_ms = (time.perf_counter() - t) * 1000
            name = clip_name(engine, voice, seed)
            dur = write_wav(OUT / name, audio, sr)
            entry = {"file": name, "engine": engine, "model": MODELS[engine], "voiceId": voice,
                     "description": desc, "promptText": text, "seed": seed, "sampleRate": sr,
                     "durationS": round(dur, 2), "genMs": round(gen_ms), "settings": impl.settings, **info}
            m = load_manifest()  # re-read: never clobber another step's entries
            upsert(m, entry)
            save_manifest(m)
            print(f"[{engine}] {name}: {dur:.1f}s audio in {gen_ms / 1000:.1f}s {info}", flush=True)
    print(f"[{engine}] peak VRAM {torch.cuda.max_memory_allocated() / 2**20:.0f} MB", flush=True)
    del impl
    gc.collect()
    torch.cuda.empty_cache()


# ---------------------------------------------------------- transcribe -------
FILLERS = {"um", "uh", "umm", "uhm", "hmm", "mm", "ah", "oh"}


def words(text: str, drop_fillers: bool = True) -> list[str]:
    t = re.sub(r"\{\w+\}|<\w+>", " ", text).lower().replace("’", "'")
    w = re.findall(r"[a-z0-9']+", t)
    return [x for x in w if not (drop_fillers and x in FILLERS)]


def wer(ref: list[str], hyp: list[str]) -> float:
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
            prev, d[j] = d[j], cur
    return d[len(hyp)] / max(1, len(ref))


def cmd_transcribe(only: set[str] | None) -> None:
    from faster_whisper import WhisperModel

    model = WhisperModel(str(WHISPER_DIR), device="cpu", compute_type="int8",
                         cpu_threads=int(os.environ.get("WHISPER_THREADS", "8")))
    ref = words(PASSAGE)
    m = load_manifest()
    names = [c["file"] for c in m["clips"] if not only or c["engine"] in only]
    for name in names:
        t = time.time()
        segs, _ = model.transcribe(str(OUT / name), language="en", beam_size=5,
                                   condition_on_previous_text=False, vad_filter=False)
        text = " ".join(s.text.strip() for s in segs).strip()
        m = load_manifest()
        c = next(x for x in m["clips"] if x["file"] == name)
        hyp = words(text)
        e = wer(ref, hyp)
        flags = []
        if e > 0.10:
            flags.append(f"transcript diverges from the passage (WER {e:.2f}, fillers ignored)")
        if len(hyp) > len(ref) * 1.15:
            flags.append(f"extra speech: {len(hyp)} words heard vs {len(ref)} in the passage (babble)")
        if c["durationS"] > 32:
            flags.append(f"long for the passage ({c['durationS']} s): long pauses, a long laugh, or babble")
        if c["durationS"] < 12:
            flags.append(f"short for the passage ({c['durationS']} s): skipped words likely")
        if c.get("hitMaxTokens"):
            flags.append("hit max_new_tokens (runaway / cut off)")
        if c.get("eos") is False:
            flags.append("no end-of-speech token")
        c.update(transcript=text, transcriptModel="faster-whisper large-v3 (cpu int8, beam 5)",
                 werVsPassage=round(e, 3), flags=flags, usable=not flags)
        save_manifest(m)
        print(f"[whisper] {name}: WER {e:.2f} in {time.time() - t:.0f}s {flags or ''}", flush=True)


# ---------------------------------------------------------------- main -------
def reexec(step: str, argv: list[str]) -> int:
    py = VENVS[step]
    env = dict(os.environ, HF_HOME=str(HF_HOME), HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
               PYTHONUNBUFFERED="1")
    return subprocess.call([str(py), __file__, *argv, "--in-venv"], env=env)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("step", choices=["all", "gen", "transcribe"])
    ap.add_argument("--engine", choices=ENGINES)
    ap.add_argument("--engines", default=",".join(ENGINES), help="for `all` / `transcribe`")
    ap.add_argument("--voices", default=",".join(VOICE_IDS))
    ap.add_argument("--seeds", default=",".join(map(str, SEEDS)))
    ap.add_argument("--in-venv", action="store_true", help=argparse.SUPPRESS)
    a = ap.parse_args()

    if a.step == "all":
        rc = 0
        for e in a.engines.split(","):
            print(f"== gen {e}", flush=True)
            rc |= reexec(e, ["gen", "--engine", e, "--voices", a.voices, "--seeds", a.seeds])
        print("== transcribe", flush=True)
        rc |= reexec("transcribe", ["transcribe", "--engines", a.engines])
        sys.exit(rc)
    if not a.in_venv:
        step = a.engine if a.step == "gen" else "transcribe"
        if a.step == "gen" and not a.engine:
            ap.error("gen needs --engine")
        sys.exit(reexec(step, sys.argv[1:]))
    if a.step == "gen":
        cmd_gen(a.engine, a.voices.split(","), [int(s) for s in a.seeds.split(",")])
    else:
        cmd_transcribe(set(a.engines.split(",")))


if __name__ == "__main__":
    main()
