#!/usr/bin/env python3
"""Measure Chatterbox Nano streaming on the CPU: time to first audio, RTF, playback stalls, seams.

One configuration per process (threads are fixed at torch/ORT start-up). The process pins
itself to the first N P-cores (same as `taskset -c 0-(N-1)`), so 4 threads ~ a laptop,
8 threads ~ a desktop. Example:

  uv run bench.py --threads 8 --lm ort --pipeline --flow-steps 1 --flow-prompt 100 --flow-window 50 \\
      --first-tokens 20 --flat-chunks 2 --save --seam-ref --tag best-t8
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import statistics
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_VE = HERE.parent
LINES = REPO_VE.parent / "scripts" / "voice-bakeoff" / "lines.json"
REFS = REPO_VE / "_samples" / "bakeoff-r2" / "refs"
OUT = REPO_VE / "_samples" / "one-voice-spike" / "chatterbox-nano"
DEFAULT_LINES = "c01-greet,c02-tease,c10-ramble,r01-summary"


def peak_norm(x, db=-1.0):
    import numpy as np
    p = float(np.max(np.abs(x))) if x.size else 0.0
    return x if p <= 0 else x * (10 ** (db / 20) / p)


def playback(ready_s: list[float], samples: list[int], sr: int) -> dict:
    """Play each chunk as soon as it is ready and the previous one has finished.
    gaplessMs: the earliest playback start that never runs dry (a jitter buffer this deep)."""
    before, gapless = 0.0, 0.0
    for r, n in zip(ready_s, samples):
        gapless = max(gapless, r - before)
        before += n / sr
    cursor, stalls, stall_s = ready_s[0], 0, 0.0
    for i, (r, n) in enumerate(zip(ready_s, samples)):
        start = max(cursor, r)
        if i and start > cursor + 1e-3:
            stalls += 1
            stall_s += start - cursor
        cursor = start + n / sr
    return {"stalls": stalls, "stallMs": round(stall_s * 1000), "gaplessMs": round(gapless * 1000)}


def seam_report(wav, bounds: list[int], sr: int) -> dict:
    """Click detector: |first difference| peak in +/-2 ms of each seam vs. the 99.9th percentile
    of |diff| over the surrounding 100 ms (seam excluded). A click shows up as ratio >> 1;
    the same statistic at random non-seam points is the control."""
    import numpy as np
    d = np.abs(np.diff(wav))
    w, ctx = int(0.002 * sr), int(0.05 * sr)

    def ratio(b):
        lo, hi = max(0, b - ctx), min(d.size, b + ctx)
        around = np.concatenate([d[lo:max(lo, b - w)], d[min(hi, b + w):hi]])
        if around.size < 10:
            return None
        ref = np.percentile(around, 99.9) + 1e-6
        return float(d[max(0, b - w):b + w].max() / ref)

    seams = [r for r in (ratio(b) for b in bounds if ctx < b < d.size - ctx) if r is not None]
    rng = np.random.default_rng(0)
    ctrl_pts = rng.integers(ctx, max(ctx + 1, d.size - ctx), size=50) if d.size > 2 * ctx else []
    ctrl = [r for r in (ratio(int(b)) for b in ctrl_pts) if r is not None]
    return {"seams": len(seams), "maxSeamRatio": round(max(seams), 2) if seams else None,
            "medianSeamRatio": round(statistics.median(seams), 2) if seams else None,
            "controlP95Ratio": round(float(np.percentile(ctrl, 95)), 2) if ctrl else None}


_REF_EMB = {}


def speaker_sim(eng, wav, ref) -> float | None:
    """Cosine of Chatterbox's own voice-encoder embeddings (output vs. reference clip): a
    proxy for 'still the same voice' when the streaming decoder sees less prompt."""
    import librosa
    import numpy as np
    if wav.size < 16000:
        return None
    ve = eng.model.ve
    if ref not in _REF_EMB:
        r16, _ = librosa.load(str(ref), sr=16000)
        _REF_EMB[ref] = ve.embeds_from_wavs([r16], sample_rate=16000).mean(0)
    w16 = librosa.resample(wav.astype(np.float32), orig_sr=24000, target_sr=16000)
    e = ve.embeds_from_wavs([w16], sample_rate=16000).mean(0)
    a = _REF_EMB[ref]
    return round(float(np.dot(a, e) / (np.linalg.norm(a) * np.linalg.norm(e))), 4)


def seam_spectral(eng, ns, st, v_ref, wav, bounds) -> dict | None:
    """Same tokens, same flow noise, decoded in ONE pass (no chunks): compare 10 ms log-mel
    frames of the streamed vs one-pass audio. A seam artifact shows as extra spectral error in
    the frames at the seams versus all other frames (HiFT's sine source is random-phased, so a
    sample-level diff is meaningless; spectra are not)."""
    import librosa
    import numpy as np
    import torch
    if not st.token_ids or not bounds:
        return None
    v = eng.voice(v_ref)
    mel = eng._flow(st.token_ids + [ns.SIL] * 3, v, st.noise, finalize=True)
    ref, _ = eng.s3.mel2wav.inference(speech_feat=mel, cache_source=torch.zeros(1, 1, 0))
    ref = ref.squeeze(0).numpy()
    n = min(ref.size, wav.size)
    lm = lambda x: np.log(librosa.feature.melspectrogram(y=x[:n].astype(np.float32), sr=24000, n_fft=960,
                                                         hop_length=240, n_mels=80) + 1e-4)
    a, b = lm(wav), lm(ref)
    err = np.abs(a - b).mean(0)                       # per 10 ms frame
    seam_frames = set()
    for x in bounds:
        c = int(x // 240)
        seam_frames.update(range(max(0, c - 2), min(err.size, c + 3)))
    loud = a.max(0) > np.log(1e-3)                    # ignore digital silence
    sf_ = [i for i in seam_frames if loud[i]]
    other = [i for i in range(err.size) if i not in seam_frames and loud[i]]
    if not sf_ or not other:
        return None
    return {"seamSpecErr": round(float(np.mean(err[sf_])), 3), "otherSpecErr": round(float(np.mean(err[other])), 3),
            "seamSpecErrMax": round(float(np.max(err[sf_])), 3), "otherSpecErrP99": round(float(np.percentile(err[other], 99)), 3)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--cpus", default=None, help="CPU list to pin to (default: 0..threads-1 = P-cores here)")
    ap.add_argument("--lm", default="torch", choices=["torch", "ort"])
    ap.add_argument("--mode", default="token", choices=["token", "clause", "sentence-token", "whole"])
    ap.add_argument("--flow-prompt", type=int, default=0, help="prompt tokens kept for the streaming flow (0 = all)")
    ap.add_argument("--flow-window", type=int, default=0, help="emitted tokens kept as flow left context (0 = all)")
    ap.add_argument("--flow-steps", type=int, default=2)
    ap.add_argument("--pipeline", action="store_true", help="sample T3 on a second thread while decoding")
    ap.add_argument("--lm-threads", type=int, default=None)
    ap.add_argument("--first-tokens", type=int, default=10)
    ap.add_argument("--flat-chunks", type=int, default=1, help="chunks kept at --first-tokens before growth")
    ap.add_argument("--growth", type=float, default=2.0)
    ap.add_argument("--max-chunk", type=int, default=100)
    ap.add_argument("--lines", default=DEFAULT_LINES)
    ap.add_argument("--voices", default="Hannah,James")
    ap.add_argument("--takes", type=int, default=2)
    ap.add_argument("--tag", default=None)
    ap.add_argument("--save", action="store_true", help="write WAVs")
    ap.add_argument("--seam-ref", action="store_true", help="also decode each clip in one pass and compare spectra at seams")
    args = ap.parse_args()

    cpus = args.cpus or f"0-{args.threads - 1}"
    cpu_set = set()
    for part in cpus.split(","):
        a, _, b = part.partition("-")
        cpu_set.update(range(int(a), int(b or a) + 1))
    os.sched_setaffinity(0, cpu_set)

    import numpy as np
    import soundfile as sf
    sys.path.insert(0, str(HERE))
    import nano_stream as ns
    import torch
    torch.set_grad_enabled(False)

    tag = args.tag or (f"{args.lm}-{args.mode}-t{args.threads}-fp{args.flow_prompt}-fw{args.flow_window}"
                       f"{'-pipe' if args.pipeline else ''}-f{args.first_tokens}")
    load0 = os.getloadavg()
    t = time.perf_counter()
    eng = ns.NanoStream(threads=args.threads, lm=args.lm, flow_prompt_tokens=args.flow_prompt or None,
                        flow_window=args.flow_window, pipeline=args.pipeline, lm_threads=args.lm_threads,
                        flow_steps=args.flow_steps, flat_chunks=args.flat_chunks)
    load_s = time.perf_counter() - t
    voices = [v.strip() for v in args.voices.split(",") if v.strip()]
    prep = {}
    for v in voices:
        t = time.perf_counter()
        eng.voice(REFS / f"{v}.wav")
        prep[v] = round(time.perf_counter() - t, 2)
    for v in voices:  # warm-up, not timed
        for _ in eng.stream("Hello there, this is a short warm-up sentence.", REFS / f"{v}.wav", mode=args.mode,
                            first_tokens=args.first_tokens, growth=args.growth, max_chunk=args.max_chunk, seed=0):
            pass

    lines = {ln["id"]: ln for k in ("conversation", "readAloud") for ln in json.loads(LINES.read_text())[k]}
    out_dir = OUT / tag
    results = []
    for take in range(1, args.takes + 1):
        for lid in [x.strip() for x in args.lines.split(",") if x.strip()]:
            text = ns.translate_cues(lines[lid]["text"])
            for v in voices:
                st = ns.StreamStats()
                chunks = list(eng.stream(text, REFS / f"{v}.wav", mode=args.mode, first_tokens=args.first_tokens,
                                         growth=args.growth, max_chunk=args.max_chunk, stats=st, seed=take))
                wav = np.concatenate(chunks) if chunks else np.zeros(0, np.float32)
                audio_s = wav.size / ns.SR
                bounds = list(np.cumsum([c.size for c in chunks])[:-1])
                r = {"line": lid, "voice": v, "take": take, "text": text,
                     "ttfaMs": round(st.first_audio_s * 1000) if st.first_audio_s is not None else None,
                     "totalMs": round(st.total_s * 1000), "audioMs": round(audio_s * 1000),
                     "rtf": round(st.total_s / audio_s, 3) if audio_s else None,
                     "tokens": st.tokens, "t3Ms": round(st.t3_s * 1000), "decMs": round(st.dec_s * 1000),
                     "msPerToken": round(st.t3_s * 1000 / max(1, st.tokens), 2),
                     "chunks": len(chunks), "chunkReadyMs": [round(x * 1000) for x in st.chunk_ready_s],
                     **playback(st.chunk_ready_s, st.chunk_samples, ns.SR),
                     **seam_report(wav, bounds, ns.SR), "load1": round(os.getloadavg()[0], 2)}
                r["spkSim"] = speaker_sim(eng, wav, REFS / f"{v}.wav")
                if args.seam_ref and args.mode in ("token", "sentence-token"):
                    r["seamSpectral"] = seam_spectral(eng, ns, st, REFS / f"{v}.wav", wav, bounds)
                if args.save:
                    out_dir.mkdir(parents=True, exist_ok=True)
                    name = f"{lid}__{v}__t{take}.wav"
                    sf.write(str(out_dir / name), np.clip(peak_norm(wav), -1, 1), ns.SR, subtype="PCM_16")
                    r["wav"] = name
                results.append(r)
                print(json.dumps({k: r[k] for k in ("line", "voice", "take", "ttfaMs", "rtf", "audioMs", "chunks",
                                                    "stalls", "stallMs", "gaplessMs", "maxSeamRatio", "spkSim", "msPerToken", "load1")}),
                      flush=True)

    def med(key):
        xs = [r[key] for r in results if r.get(key) is not None]
        return round(statistics.median(xs), 3) if xs else None

    cpu_model = next((l.split(":", 1)[1].strip() for l in Path("/proc/cpuinfo").read_text().splitlines()
                      if l.startswith("model name")), platform.processor())
    summary = {"tag": tag, "threads": args.threads, "cpus": cpus, "cpuModel": cpu_model, "lm": args.lm,
               "ortGraph": getattr(eng.lm, "graph", None), "mode": args.mode, "flowPromptTokens": args.flow_prompt or "all",
               "flowWindow": args.flow_window or "all", "flowSteps": args.flow_steps, "pipeline": args.pipeline, "lmThreads": eng.lm_threads,
               "decThreads": eng.dec_threads, "ompWaitPolicy": os.environ.get("OMP_WAIT_POLICY"),
               "mkldnn": __import__("torch").backends.mkldnn.enabled,
               "firstTokens": args.first_tokens, "flatChunks": args.flat_chunks, "growth": args.growth, "maxChunk": args.max_chunk,
               "loadSeconds": round(load_s, 1), "voicePrepSeconds": prep,
               "loadAvgStart": [round(x, 2) for x in load0], "loadAvgEnd": [round(x, 2) for x in os.getloadavg()],
               "median": {k: med(k) for k in ("ttfaMs", "rtf", "gaplessMs", "msPerToken", "stallMs", "spkSim")},
               "p90TtfaMs": round(float(np.percentile([r["ttfaMs"] for r in results], 90))),
               "p90GaplessMs": round(float(np.percentile([r["gaplessMs"] for r in results], 90))),
               "maxRtf": max(r["rtf"] for r in results), "totalStalls": sum(r["stalls"] for r in results),
               "maxSeamRatio": max((r["maxSeamRatio"] for r in results if r["maxSeamRatio"] is not None), default=None),
               "controlP95Ratio": med("controlP95Ratio"),
               "seamSpectral": {k: round(statistics.mean([r["seamSpectral"][k] for r in results if r.get("seamSpectral")]), 3)
                                for k in ("seamSpecErr", "otherSpecErr", "seamSpecErrMax", "otherSpecErrP99")}
               if any(r.get("seamSpectral") for r in results) else None,
               "peakRssMb": round(__import__("resource").getrusage(__import__("resource").RUSAGE_SELF).ru_maxrss / 1024),
               "torch": __import__("torch").__version__, "results": results}
    try:
        import onnxruntime
        summary["onnxruntime"] = onnxruntime.__version__
    except ImportError:
        pass
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "runs").mkdir(exist_ok=True)
    (OUT / "runs" / f"{tag}.json").write_text(json.dumps(summary, indent=2) + "\n")
    print("SUMMARY", json.dumps({k: summary[k] for k in ("tag", "median", "p90TtfaMs", "p90GaplessMs", "maxRtf", "totalStalls",
                                                         "maxSeamRatio", "controlP95Ratio", "seamSpectral", "peakRssMb", "loadAvgStart", "loadAvgEnd")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
