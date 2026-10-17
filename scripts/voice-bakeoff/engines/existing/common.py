"""Shared runner loop for the engines Neuma already carries (kokoro, zonos,
kyutai, qwen3-tts). Stdlib + numpy only, so every sidecar's own .venv can
import it. Each run_<engine>.py supplies an adapter:

    adapter.engine_id, adapter.meta (dict), adapter.load(),
    adapter.synth(text, voice, emotion, intensity, seed) -> (float32 mono ndarray, sr, ttfb_ms|None)
    adapter.render_text(raw_text) -> text with {cues} translated or dropped

The loop follows scripts/voice-bakeoff/README.md: every conversation + read-aloud
line x voices x takes, the d01 dialogue (350 ms gaps) and its hannah turns,
peak-normalised -1 dBFS mono 16-bit WAVs, and out/<engine>/meta.json.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
DEFAULT_LINES = REPO / "scripts" / "voice-bakeoff" / "lines.json"
DEFAULT_SAMPLES = REPO / "voice-engines" / "_samples" / "bakeoff-2026-09-30"
MIN_RATE = 24000
PEAK_DBFS = -1.0
DIALOGUE_GAP_MS = 350

CUE_RE = re.compile(r"\{(\w+)\}")


def strip_cues(text: str) -> str:
    """Remove every {cue} and tidy the whitespace/punctuation it leaves."""
    out = CUE_RE.sub("", text)
    out = re.sub(r"\s+", " ", out).strip()
    out = re.sub(r"\s+([,.!?])", r"\1", out)
    return out


def peak_normalize(audio: np.ndarray) -> np.ndarray:
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak <= 1e-9:
        return audio
    return audio * (10 ** (PEAK_DBFS / 20.0) / peak)


def resample_linear(audio: np.ndarray, sr: int, target: int) -> np.ndarray:
    """Only used if an engine emits below 24 kHz (none of these four do)."""
    n = int(round(len(audio) * target / sr))
    x_old = np.linspace(0.0, 1.0, num=len(audio), endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=n, endpoint=False)
    return np.interp(x_new, x_old, audio).astype(np.float32)


def write_wav(path: Path, audio: np.ndarray, sr: int) -> None:
    pcm = np.clip(audio, -1.0, 1.0)
    pcm = (pcm * 32767.0).round().astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def seed_everything(seed: int) -> None:
    import random
    random.seed(seed)
    np.random.seed(seed)
    try:
        import torch
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
    except ImportError:
        pass


def cuda_sync() -> None:
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.synchronize()
    except ImportError:
        pass


def peak_vram_mb() -> int | None:
    try:
        import torch
        if torch.cuda.is_available():
            return int(torch.cuda.max_memory_allocated() / (1024 * 1024))
    except ImportError:
        pass
    return None


def parse_args(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", default=str(DEFAULT_LINES))
    ap.add_argument("--samples", default=str(DEFAULT_SAMPLES))
    ap.add_argument("--only", default=None, help="comma list of line ids (debug)")
    ap.add_argument("--takes", type=int, default=None, help="override take count (debug)")
    return ap.parse_args(argv)


def run(adapter, argv=None) -> None:
    args = parse_args(argv)
    lines = json.loads(Path(args.lines).read_text())
    samples = Path(args.samples)
    out_dir = samples / "out" / adapter.engine_id
    out_dir.mkdir(parents=True, exist_ok=True)
    takes = args.takes or int(lines.get("takes", 2))
    only = set(args.only.split(",")) if args.only else None

    adapter.samples = samples
    adapter.voices_cfg = lines["voices"]
    t0 = time.time()
    adapter.load()
    load_s = time.time() - t0
    print(f"[{adapter.engine_id}] loaded in {load_s:.1f}s", file=sys.stderr, flush=True)

    clips: dict = {}
    notes: list = list(getattr(adapter, "notes", []))
    rate_notes: set = set()

    def synth(text_raw, voice, emotion, intensity, seed):
        text = adapter.render_text(text_raw)
        seed_everything(seed)
        cuda_sync()
        t = time.perf_counter()
        audio, sr, ttfb = adapter.synth(text, voice, emotion, intensity, seed)
        cuda_sync()
        gen_ms = (time.perf_counter() - t) * 1000.0
        audio = np.asarray(audio, dtype=np.float32).reshape(-1)
        if sr < MIN_RATE:
            rate_notes.add(f"native rate {sr} Hz resampled (linear) to {MIN_RATE} Hz")
            audio = resample_linear(audio, sr, MIN_RATE)
            sr = MIN_RATE
        audio_ms = len(audio) / sr * 1000.0
        stat = {"genMs": round(gen_ms), "audioMs": round(audio_ms),
                "rtf": round(gen_ms / audio_ms, 3) if audio_ms else None}
        if ttfb is not None:
            stat["ttfbMs"] = round(ttfb)
        stat["text"] = text
        return peak_normalize(audio), sr, stat

    # -- conversation + read-aloud lines ---------------------------------
    for line in lines["conversation"] + lines["readAloud"]:
        if only and line["id"] not in only:
            continue
        for voice in line["voices"]:
            for take in range(1, takes + 1):
                key = f"{line['id']}__{voice}__t{take}"
                audio, sr, stat = synth(line["text"], voice, line.get("emotion"),
                                        line.get("intensity"), take)
                write_wav(out_dir / f"{key}.wav", audio, sr)
                clips[key] = stat
                print(f"[{adapter.engine_id}] {key} gen={stat['genMs']}ms "
                      f"audio={stat['audioMs']}ms rtf={stat['rtf']}"
                      + (f" ttfb={stat.get('ttfbMs')}ms" if "ttfbMs" in stat else ""),
                      file=sys.stderr, flush=True)

    # -- dialogue: each turn alone, concatenated with 350 ms gaps -----------
    dlg = lines["dialogue"]
    if not only or dlg["id"] in only:
        for take in range(1, takes + 1):
            pieces, sr_d = [], None
            for n, turn in enumerate(dlg["turns"]):
                audio, sr, stat = synth(turn["text"], turn["speaker"], turn.get("emotion"),
                                        turn.get("intensity"), take)
                if sr_d is None:
                    sr_d = sr
                key = f"{dlg['id']}__turn{n}__t{take}"
                stat["speaker"] = turn["speaker"]
                clips[key] = stat
                if turn["speaker"] == "hannah":
                    write_wav(out_dir / f"{key}.wav", audio, sr)
                if pieces:
                    pieces.append(np.zeros(int(sr_d * DIALOGUE_GAP_MS / 1000), dtype=np.float32))
                pieces.append(audio)
                print(f"[{adapter.engine_id}] {key} gen={stat['genMs']}ms "
                      f"audio={stat['audioMs']}ms", file=sys.stderr, flush=True)
            write_wav(out_dir / f"{dlg['id']}__t{take}.wav",
                      peak_normalize(np.concatenate(pieces)), sr_d)

    meta = dict(adapter.meta)
    meta["engine"] = adapter.engine_id
    meta["device"] = getattr(adapter, "device", "cuda")
    meta["peakVramMb"] = peak_vram_mb()
    meta["loadSeconds"] = round(load_s, 1)
    meta["clips"] = clips
    meta["notes"] = notes + sorted(rate_notes) + [
        "timings taken while a llama-server benchmark shared the GPU: relative, not absolute",
        "dialogue: james turns (turn0/2/4) synthesized in james's voice and kept only inside "
        "d01-news__t<take>.wav; clips[...turnN...] carry timings for all six turns",
    ]
    rtfs = sorted(c["rtf"] for c in clips.values() if c.get("rtf") is not None)
    ttfbs = sorted(c["ttfbMs"] for c in clips.values() if "ttfbMs" in c)
    meta["summary"] = {
        "clips": len(clips),
        "medianRtf": rtfs[len(rtfs) // 2] if rtfs else None,
        "medianTtfbMs": ttfbs[len(ttfbs) // 2] if ttfbs else None,
    }
    if only:
        # Debug partial run: never clobber a full meta.json.
        (out_dir / "meta.partial.json").write_text(json.dumps(meta, indent=2))
    else:
        (out_dir / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"[{adapter.engine_id}] done: {len(clips)} clips, summary={meta['summary']}, "
          f"peakVramMb={meta['peakVramMb']}", file=sys.stderr, flush=True)
