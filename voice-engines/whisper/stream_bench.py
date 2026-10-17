"""Measure the /stream lane per model: first-partial and final latency, and WER.

Drives the sidecar's OWN decode path (stream_lane.build_processor + stream_pump)
with realtime-paced PCM — the same queue/thread shape /stream uses, minus the
socket — so the numbers are the lane's, not a toy decode loop's.

Clips: the portal-voice-stream test's two espeak-ng sentences (plus two more),
rendered fresh with a bounded espeak/ffmpeg into a work dir ON DISK beside this
file (never /tmp — tmpfs is RAM here) and removed at the end; and five English
human reference clips from voice-engines/_samples/bakeoff-2026-09-30/refs
(reference text = their transcripts.json, i.e. agreement, not ground truth).

    uv run python stream_bench.py --model tiny=<dir> --model base=<dir> [--device cuda]

Latencies (wall clock, per clip):
  first_partial_ms  first partial − the first 100 ms chunk with speech energy
  final_ms          last utterance − the last chunk with speech energy (includes the
                    VAD's min-silence wait, WHISPER_STREAM_MIN_SILENCE_MS)
  decode_ms         last utterance − the VAD's speech_stopped (the decode alone)
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import re
import shutil
import statistics
import subprocess
import threading
import time
from pathlib import Path

os.environ["HF_HUB_OFFLINE"] = "1"

import numpy as np  # noqa: E402

import stream_lane  # noqa: E402

HERE = Path(__file__).resolve().parent
REFS = HERE.parent / "_samples" / "bakeoff-2026-09-30" / "refs"
ESPEAK = [
    "The portal is open and the house is listening.",
    "The house answers in its own voice.",
    "Can you hear me clearly right now?",
    "Tell me what you remember about the first night we talked.",
]
HUMAN = ["Glenn", "Hannah", "James", "Lara", "Moses"]
CHUNK = 3200          # 100 ms of 16 kHz s16le
SPEECH_RMS = 300      # int16 RMS that counts as speech energy


def _run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _pcm_of(src: Path, out: Path) -> bytes:
    _run(["ffmpeg", "-y", "-t", "30", "-i", str(src), "-t", "30", "-f", "s16le", "-acodec", "pcm_s16le",
          "-ar", "16000", "-ac", "1", str(out)])
    return out.read_bytes()


def clips(work: Path) -> list[tuple[str, bytes, str]]:
    out = []
    for i, text in enumerate(ESPEAK):
        wav = work / f"espeak{i}.wav"
        _run(["espeak-ng", "-w", str(wav), "-s", "150", text])
        out.append((f"espeak{i}", _pcm_of(wav, work / f"espeak{i}.pcm"), text))
    refs = json.loads((REFS / "transcripts.json").read_text())
    for name in HUMAN:
        out.append((name, _pcm_of(REFS / f"{name}.wav", work / f"{name}.pcm"), refs[name]))
    return out


def _words(text: str) -> list[str]:
    return re.sub(r"[^a-z0-9' ]+", " ", text.lower()).split()


def wer(ref: str, hyp: str) -> float:
    r, h = _words(ref), _words(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev, d[j] = d[j], cur
    return d[len(h)] / max(1, len(r))


def _noise() -> bytes:
    return (np.random.uniform(-64, 64, CHUNK // 2)).astype(np.int16).tobytes()


def run_clip(proc, pcm: bytes, cadence_s: float) -> dict:
    frames_q: queue.Queue = queue.Queue()
    events: list[tuple[float, dict]] = []
    stop = threading.Event()
    pump = threading.Thread(target=stream_lane.stream_pump,
                            args=(proc, frames_q, lambda e: events.append((time.monotonic(), e)), stop, cadence_s),
                            daemon=True)
    pump.start()
    onset = last_speech = None
    t_next = time.monotonic()
    for off in range(0, len(pcm), CHUNK):
        chunk = pcm[off:off + CHUNK]
        frames_q.put(chunk)
        rms = float(np.sqrt(np.mean(np.frombuffer(chunk, dtype=np.int16).astype(np.float64) ** 2))) if chunk else 0
        now = time.monotonic()
        if rms > SPEECH_RMS:
            onset = onset or now
            last_speech = now
        t_next += 0.1
        time.sleep(max(0.0, t_next - time.monotonic()))
    for _ in range(20):                      # 2 s of room tone so the VAD finalizes
        frames_q.put(_noise())
        t_next += 0.1
        time.sleep(max(0.0, t_next - time.monotonic()))
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and not any(e["type"] == "utterance" and t > last_speech for t, e in events):
        time.sleep(0.02)
    time.sleep(0.5)
    stop.set()
    pump.join(10)
    partials = [t for t, e in events if e["type"] == "partial"]
    utts = [(t, e["text"]) for t, e in events if e["type"] == "utterance"]
    stops = [t for t, e in events if e["type"] == "speech_stopped"]
    last_utt = utts[-1][0] if utts else None
    return {
        "first_partial_ms": round((partials[0] - onset) * 1000) if partials and onset else None,
        "final_ms": round((last_utt - last_speech) * 1000) if last_utt and last_speech else None,
        "decode_ms": round((last_utt - stops[-1]) * 1000) if last_utt and stops else None,
        "text": " ".join(t for _, t in utts),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", action="append", required=True, help="label=<local CTranslate2 dir>")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--compute-type", default=None)
    ap.add_argument("--threads", type=int, default=int(os.environ.get("WHISPER_STREAM_CPU_THREADS", "16")))
    ap.add_argument("--cadence", type=float, default=0.3)
    ap.add_argument("--min-silence", type=int, default=400)
    ap.add_argument("--reps", type=int, default=2, help="passes over the espeak clips")
    args = ap.parse_args()
    compute = args.compute_type or ("int8" if args.device == "cpu" else "float16")
    if args.device == "cuda":
        from server import _preload_cuda_libs   # the sidecar's own cuBLAS/cuDNN preload

        _preload_cuda_libs()
    work = HERE / "_bench_work"
    work.mkdir(exist_ok=True)
    try:
        all_clips = clips(work)
        report = {}
        for spec in args.model:
            label, model_dir = spec.split("=", 1)
            t0 = time.time()
            proc = stream_lane.build_processor(model_dir, args.threads, args.cadence, args.min_silence,
                                               device=args.device, compute_type=compute)
            load_s = round(time.time() - t0, 1)
            rows = []
            for rep in range(args.reps):
                for name, pcm, ref in all_clips:
                    if rep and not name.startswith("espeak"):
                        continue
                    r = run_clip(proc, pcm, args.cadence)
                    r.update(clip=name, wer=round(wer(ref, r["text"]), 3))
                    rows.append(r)
                    print(json.dumps({"model": label, **r}), flush=True)

            def med(key, subset=rows):
                vals = [r[key] for r in subset if r[key] is not None]
                return statistics.median(vals) if vals else None
            esp = [r for r in rows if r["clip"].startswith("espeak")]
            hum = [r for r in rows if not r["clip"].startswith("espeak")]
            report[label] = {
                "device": f"{args.device}/{compute}", "load_s": load_s,
                "first_partial_ms_median": med("first_partial_ms"),
                "final_ms_median": med("final_ms"), "final_ms_max": max((r["final_ms"] or 0) for r in rows),
                "decode_ms_median": med("decode_ms"),
                "wer_espeak_mean": round(statistics.mean(r["wer"] for r in esp), 3),
                "wer_human_mean": round(statistics.mean(r["wer"] for r in hum), 3) if hum else None,
            }
            del proc
        print("SUMMARY " + json.dumps(report, indent=1), flush=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
