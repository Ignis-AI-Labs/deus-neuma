"""Phase 0 speed spike bench: TTFA, RTF, stalls, VRAM for the streaming CSM generator.

  cd voice-engines/csm
  uv run bench.py --model csm-1b            # or misotts-8b
  uv run bench.py --model csm-1b --no-compile

Small-footprint / CPU feasibility (Light tier; defaults are the Standard/High path unchanged):
  PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True uv run bench.py --model csm-1b --quant int8 --lean \
      --kv-len 1024 --mimi-dtype bf16 --mimi-enc-device cpu --profile --takes 3 \
      --lines c01-greet,c02-tease,c10-ramble,r01-summary --out csm-1b-small/gpu-int8-lean
  CUDA_VISIBLE_DEVICES= taskset -c 0-7 uv run bench.py --model csm-1b --device cpu --threads 8 \
      --quant dyn8 --lean --kv-len 1024 --no-compile --lines c01-greet --no-dialogue --takes 1 --profile \
      --out csm-1b-small/cpu/prof-dyn8-t8

Writes WAVs + meta.json to voice-engines/_samples/one-voice-spike/<model>/.
Lines: scripts/voice-bakeoff/lines.json (c01-greet, c02-tease, c10-ramble + the d01-news dialogue,
each being turn conditioned on both reference clips + every earlier turn). References:
voice-engines/_samples/bakeoff-r2/refs/{Hannah,James}.wav + transcripts.json.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import threading
import time
import zlib
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
REFS = REPO / "voice-engines" / "_samples" / "bakeoff-r2" / "refs"
LINES = REPO / "scripts" / "voice-bakeoff" / "lines.json"
OUT = REPO / "voice-engines" / "_samples" / "one-voice-spike"
SR = 24_000
PEAK = 10 ** (-1 / 20)
CONV_IDS = ["c01-greet", "c02-tease", "c10-ramble"]


def strip_cues(text: str) -> str:
    t = re.sub(r"\{[a-z]+\}", " ", text)
    t = re.sub(r"\s+", " ", t).strip()
    return re.sub(r"\s+([,.!?])", r"\1", t)


def load_ref(path: Path) -> np.ndarray:
    audio, sr = sf.read(str(path), dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if sr != SR:
        g = np.gcd(sr, SR)
        audio = resample_poly(audio, SR // g, sr // g).astype(np.float32)
    return audio


def write_wav(path: Path, audio: np.ndarray) -> None:
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0:
        audio = audio * (PEAK / peak)  # same -1 dBFS peak normalisation as the bake-off runner
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio, SR, subtype="PCM_16")


class GpuSampler(threading.Thread):
    """`nvidia-smi pmon` (1 s buckets): SM% of THIS process vs every other process (the substrate et al.),
    plus this process's peak memory from --query-compute-apps."""

    def __init__(self, pid: int):
        super().__init__(daemon=True)
        self.pid = pid
        self.rows: list[tuple[float, int, int]] = []  # (time, pid, sm%)
        self.proc_mb = 0
        self._stop = threading.Event()
        self.proc = subprocess.Popen(["nvidia-smi", "pmon", "-s", "u", "-d", "1"], stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, text=True)

    def run(self):
        threading.Thread(target=self._mem, daemon=True).start()
        for line in self.proc.stdout:
            if self._stop.is_set():
                break
            if line.startswith("#"):
                continue
            f = line.split()
            if len(f) >= 4 and f[1].isdigit():
                self.rows.append((time.time(), int(f[1]), int(f[3]) if f[3].isdigit() else 0))

    def _mem(self):
        while not self._stop.is_set():
            try:
                p = subprocess.run(["nvidia-smi", "--query-compute-apps=pid,used_memory",
                                    "--format=csv,noheader,nounits"], capture_output=True, text=True,
                                   timeout=5).stdout
                for line in p.splitlines():
                    pid, mb = [x.strip() for x in line.split(",")]
                    if int(pid) == self.pid:
                        self.proc_mb = max(self.proc_mb, int(mb))
            except Exception:
                pass
            self._stop.wait(1.0)

    def window(self, t0: float, t1: float) -> dict:
        """Mean SM% of others / of us over the 1 s buckets touching [t0, t1 + 1]."""
        buckets: dict[int, list[int]] = {}
        for t, pid, sm in self.rows:
            if t0 <= t <= t1 + 1.0:
                b = buckets.setdefault(int(t), [0, 0])
                b[0 if pid != self.pid else 1] += sm
        if not buckets:
            return {"othersSmPct": None, "oursSmPct": None}
        o = [v[0] for v in buckets.values()]
        u = [v[1] for v in buckets.values()]
        return {"othersSmPct": round(float(np.mean(o))), "oursSmPct": round(float(np.mean(u)))}

    def stop(self):
        self._stop.set()
        self.proc.terminate()  # our own child only


def timed_stream(gen, text, speaker, ctx):
    """Consume generate_stream; return audio + timing. Stalls simulate a player that starts at TTFA."""
    import torch

    if gen.device.type == "cuda":
        torch.cuda.synchronize()
    t0 = time.perf_counter()
    chunks, arrivals = [], []
    for pcm in gen.generate_stream(text, speaker, ctx):
        arrivals.append(time.perf_counter() - t0)
        chunks.append(pcm)
    total = time.perf_counter() - t0
    audio = np.concatenate(chunks) if chunks else np.zeros(0, np.float32)
    audio_s = len(audio) / SR
    ttfa = arrivals[0] if arrivals else float("nan")
    first_s = len(chunks[0]) / SR if chunks else 0.0
    # playback simulation: start at TTFA; a stall happens when chunk i arrives after the audio queued so far ran out
    play_clock, queued, stall = ttfa, 0.0, 0.0
    for t, c in zip(arrivals, chunks):
        if t > play_clock + queued:
            stall += t - (play_clock + queued)
            play_clock = t - queued
        queued += len(c) / SR
    steady = (total - ttfa) / (audio_s - first_s) if audio_s - first_s > 0 else float("nan")
    return audio, {
        "ttfaMs": round(ttfa * 1000, 1),
        "totalMs": round(total * 1000, 1),
        "audioMs": round(audio_s * 1000),
        "rtf": round(total / audio_s, 3) if audio_s else None,
        "rtfSteady": round(steady, 3),
        "stallMs": round(stall * 1000, 1),
        "frames": gen.last_frames,
        "hitMax": gen.last_frames >= gen.max_frames,
        "chunks": len(chunks),
    }


def profile_frames(gen, n: int = 50, reps: int = 5) -> dict:
    """Per-frame cost in isolation (best of `reps` batches of `n`): the LM frame step (depth decoder x31 +
    sampling + one backbone token) and one streaming Mimi decode; plus the bytes the step must read."""
    import torch

    cuda = gen.device.type == "cuda"

    def clock(fn):
        best = float("inf")
        for _ in range(reps):
            gen.pos.fill_(min(300, gen.kv_len - n - 2))
            if cuda:
                a, b = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)
                a.record()
                for _ in range(n):
                    fn()
                b.record()
                torch.cuda.synchronize()
                best = min(best, a.elapsed_time(b) / n)
            else:
                t0 = time.perf_counter()
                for _ in range(n):
                    fn()
                best = min(best, (time.perf_counter() - t0) * 1000 / n)
        return round(best, 3)

    with torch.inference_mode():
        lm = clock(gen._replay)
        codes = torch.randint(1, 2048, (1, 32, 1), device=gen.device)
        mimi = clock(lambda: gen.mimi_dec.decode(codes))
        gen.mimi_dec.reset_streaming()

    def nbytes(t):
        return t.numel() * t.element_size() if isinstance(t, torch.Tensor) else 0

    bb = sum(nbytes(t) for l in gen.bb.L for k, t in l.items())
    dec = sum(nbytes(t) for l in gen.dec.L for k, t in l.items())
    kv = nbytes(gen.bb.k) + nbytes(gen.bb.v)
    head = nbytes(gen.W["audio_head"]) if "audio_head" in gen.W else nbytes(gen.W["audio_head_q"]) + nbytes(gen.W["audio_head_s"])
    heads = nbytes(gen.W["c0_head"]) + head + nbytes(gen.W["projection"])
    mimi_b = sum(nbytes(p) for p in gen.mimi_dec.parameters())
    # per frame: backbone weights once, the decoder's 31 passes, the heads, a full sweep of the (masked) KV window
    lm_bytes = bb + dec * (NCB - 1) + heads + kv
    return {"lmStepMs": lm, "mimiDecodeMs": mimi, "frameMs": round(lm + mimi, 3),
            "lmBytesPerFrameMb": round(lm_bytes / 2**20), "backboneMb": round(bb / 2**20),
            "decoderMb": round(dec / 2**20), "kvCacheMb": round(kv / 2**20), "mimiDecoderWeightsMb": round(mimi_b / 2**20)}


NCB = 32


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="csm-1b", choices=["csm-1b", "misotts-8b"])
    ap.add_argument("--no-compile", action="store_true")
    ap.add_argument("--quant", choices=["int8", "dyn8", "int4", "int4/int8"], default=None,
                    help="int8: weight-only int8 LM linears (GPU Triton GEMV / CPU int8pack); dyn8: PyTorch dynamic int8 (CPU); "
                         "int4: group-128 int4 (GPU); int4/int8: int4 backbone + int8 depth decoder")
    ap.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    ap.add_argument("--dtype", choices=["bf16", "fp16", "fp32"], default=None, help="LM dtype (default bf16 GPU / fp32 CPU)")
    ap.add_argument("--threads", type=int, default=None, help="torch CPU threads (pin cores with taskset)")
    ap.add_argument("--kv-len", type=int, default=None, help="backbone KV window (default 2048)")
    ap.add_argument("--lean", action="store_true", help="trim Mimi halves, text table on CPU, no pre-projected table")
    ap.add_argument("--mimi-dtype", choices=["bf16", "fp16"], default=None, help="Mimi weights dtype (default fp32)")
    ap.add_argument("--mimi-enc-device", choices=["cuda", "cpu"], default=None, help="where reference audio is encoded")
    ap.add_argument("--lines", default=None, help="comma list of conversation/readAloud ids (default c01,c02,c10)")
    ap.add_argument("--no-dialogue", action="store_true", help="skip the d01-news rolling-context dialogue")
    ap.add_argument("--profile", action="store_true", help="time the per-frame LM step and Mimi decode in isolation")
    ap.add_argument("--out", default=None, help="output dir under one-voice-spike/ (default <model><tag>)")
    ap.add_argument("--takes", type=int, default=2)
    ap.add_argument("--tag", default="", help="suffix for the output dir (e.g. -nocompile)")
    ap.add_argument("--max-audio-ms", type=float, default=None)
    args = ap.parse_args()

    import torch
    from csm_stream import MAX_SEQ, CsmStream, Segment

    cuda = args.device == "cuda"
    if args.threads:
        torch.set_num_threads(args.threads)
    sampler = GpuSampler(os.getpid()) if cuda else None
    if sampler:
        sampler.start()
    lines = json.loads(LINES.read_text())
    ref_text = json.loads((REFS / "transcripts.json").read_text())
    refs = {"hannah": load_ref(REFS / "Hannah.wav"), "james": load_ref(REFS / "James.wav")}
    rtext = {"hannah": ref_text["Hannah"], "james": ref_text["James"]}

    if cuda:
        torch.cuda.reset_peak_memory_stats()
    t0 = time.perf_counter()
    gen = CsmStream(args.model, device=args.device, compile=not args.no_compile, quant=args.quant,
                    max_frames=375,  # 30 s cap
                    kv_len=args.kv_len or MAX_SEQ, lean=args.lean, dtype=args.dtype, mimi_dtype=args.mimi_dtype,
                    mimi_enc_device=args.mimi_enc_device)
    startup_s = time.perf_counter() - t0
    print(f"[{args.model}] load {gen.timings['load_s']:.1f}s, warm-up/capture {gen.timings['capture_s']:.1f}s, "
          + (f"allocated {torch.cuda.memory_allocated() / 2**30:.2f} GiB" if cuda else f"device {args.device}"),
          flush=True)

    # Voice DNA load: encode the reference clips once (what a session does when it opens)
    enc = {}
    for v in refs:
        if cuda:
            torch.cuda.synchronize()
        e0 = time.perf_counter()
        gen.encode(refs[v])
        if cuda:
            torch.cuda.synchronize()
        enc[v] = round((time.perf_counter() - e0) * 1000, 1)
    print(f"[{args.model}] reference encode ms (one-time per session): {enc}", flush=True)

    # warm-up utterance (not measured)
    gen.generate("Okay, let's get started.", 0, [Segment(0, rtext["hannah"], refs["hannah"])])

    prof = None
    if args.profile:
        prof = profile_frames(gen)
        print(f"[{args.model}] PROFILE {json.dumps(prof)}", flush=True)

    out = OUT / (args.out or (args.model + args.tag))
    out.mkdir(parents=True, exist_ok=True)
    clips = {}

    def run(cid, text, spk, ctx, save=True):
        torch.manual_seed(zlib.crc32(cid.encode()))
        w0 = time.time()
        audio, m = timed_stream(gen, text, spk, ctx)
        if sampler:
            time.sleep(1.1)  # let pmon emit the bucket covering this clip
            m.update(sampler.window(w0, time.time() - 1.1))
        else:
            m.update({"othersSmPct": None, "oursSmPct": None, "loadavg": os.getloadavg()[0]})
        m["promptPositions"] = int(gen.prompt(text, spk, ctx)[0].size(0))
        m["contextTurns"] = len(ctx)
        clips[cid] = m
        if save:
            write_wav(out / f"{cid}.wav", audio)
        print(f"[{args.model}] {cid:26s} ctx={len(ctx)} pos={m['promptPositions']:4d} TTFA {m['ttfaMs']:6.1f} ms  "
              f"audio {m['audioMs'] / 1000:5.2f}s  RTF {m['rtf']:.3f} (steady {m['rtfSteady']:.3f})  "
              f"stall {m['stallMs']:.0f} ms  [others SM {m['othersSmPct']}%]{'  HIT-MAX' if m['hitMax'] else ''}",
              flush=True)
        return audio

    conv = {i["id"]: i for i in lines["conversation"] + lines["readAloud"]}
    for take in range(1, args.takes + 1):
        for cid in (args.lines.split(",") if args.lines else CONV_IDS):
            item = conv[cid]
            for voice in item["voices"]:
                run(f"{cid}__{voice}__t{take}", strip_cues(item["text"]), 0,
                    [Segment(0, rtext[voice], refs[voice])])

    # dialogue: speaker 0 = hannah (the being), 1 = james (the person); rolling context
    dlg = lines["dialogue"]
    spk_of = {"hannah": 0, "james": 1}
    for take in range(1, 0 if args.no_dialogue else args.takes + 1):
        ctx = [Segment(0, rtext["hannah"], refs["hannah"]), Segment(1, rtext["james"], refs["james"])]
        turns = []
        for n, turn in enumerate(dlg["turns"]):
            text = strip_cues(turn["text"])
            spk = spk_of[turn["speaker"]]
            cid = f"{dlg['id']}__turn{n}__t{take}"
            audio = run(cid, text, spk, ctx, save=turn["speaker"] == "hannah")
            clips[cid]["speaker"] = turn["speaker"]
            # the being's own turn re-enters context as its codes (no re-encode), like a live session
            ctx = ctx + [Segment(spk, text, audio=audio, codes=gen.last_codes)]
            turns.append(audio)
        gap = np.zeros(int(SR * 0.35), np.float32)
        write_wav(out / f"{dlg['id']}__t{take}.wav",
                  np.concatenate([x for i, a in enumerate(turns) for x in ((gap, a) if i else (a,))]))

    vram_end = None
    if sampler:
        sampler.stop()
        try:  # steady state: what sits beside the mind between utterances
            q = subprocess.run(["nvidia-smi", "--query-compute-apps=pid,used_memory", "--format=csv,noheader,nounits"],
                               capture_output=True, text=True, timeout=5).stdout
            vram_end = next((int(m) for p_, m in (x.split(",") for x in q.splitlines()) if int(p_) == os.getpid()), None)
        except Exception:
            pass
    peak_alloc = torch.cuda.max_memory_allocated() / 2**20 if cuda else 0
    peak_reserved = torch.cuda.max_memory_reserved() / 2**20 if cuda else 0
    vals = list(clips.values())
    being = [c for k, c in clips.items() if not k.startswith("d01") or c.get("speaker") == "hannah"]

    def stat(key, rows):
        xs = [r[key] for r in rows if r[key] is not None and not np.isnan(r[key])]
        return {"median": round(float(np.median(xs)), 3), "p90": round(float(np.percentile(xs, 90)), 3),
                "max": round(float(np.max(xs)), 3)}

    summary = {
        "ttfaMs": stat("ttfaMs", vals),
        "rtf": stat("rtf", vals),
        "rtfSteady": stat("rtfSteady", vals),
        "stallMs": stat("stallMs", vals),
    }
    if not args.no_dialogue:
        summary["ttfaMsDialogueWithContext"] = stat("ttfaMs", [c for k, c in clips.items() if k.startswith("d01")])
    others = [c["othersSmPct"] for c in vals if c.get("othersSmPct") is not None]
    meta = {
        "model": args.model,
        "path": "plain-PyTorch CSM, static KV cache, per-frame step as one CUDA graph"
                + ("" if args.no_compile else " (torch.compile, inductor default mode)")
                + (f", weight-only {args.quant} LM linears (Triton GEMV)" if args.quant else "")
                + ", moshi streaming Mimi decode (chunks of 2, 2, 4, then 6 frames)",
        "torch": torch.__version__,
        "device": torch.cuda.get_device_name() if cuda else f"cpu x{torch.get_num_threads()} threads",
        "sharedGpu": "substrate llama-server resident + benchmark running; numbers are pessimistic",
        "otherProcessesSmPctPerClip": {"median": int(np.median(others)) if others else None,
                                       "min": int(min(others)) if others else None,
                                       "max": int(max(others)) if others else None},
        "loadS": round(gen.timings["load_s"], 1),
        "warmupCaptureS": round(gen.timings["capture_s"], 1),
        "startupS": round(startup_s, 1),
        "refEncodeMs": enc,
        "peakAllocatedMb": round(peak_alloc),
        "peakReservedMb": round(peak_reserved),
        "processVramMb_nvidiaSmi": sampler.proc_mb if sampler else None,
        "processVramMbSteady_nvidiaSmi": vram_end,
        "allocatedMbSteady": round(torch.cuda.memory_allocated() / 2**20) if cuda else None,
        "options": {"quant": args.quant, "kvLen": gen.kv_len, "lean": args.lean, "dtype": str(gen.dtype),
                    "mimiDtype": args.mimi_dtype or "fp32", "mimiEncDevice": str(gen.mimi_enc_device),
                    "compile": not args.no_compile, "threads": torch.get_num_threads(),
                    "loadavgEnd": os.getloadavg()},
        "profile": prof,
        "settings": {"temperature": gen.temperature, "topk": gen.topk, "dtype": "bfloat16 LM, float32 Mimi",
                     "maxFrames": gen.max_frames},
        "summary": summary,
        "clips": clips,
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(json.dumps({k: meta[k] for k in ("loadS", "warmupCaptureS", "peakAllocatedMb", "peakReservedMb",
                                           "processVramMb_nvidiaSmi", "processVramMbSteady_nvidiaSmi", "allocatedMbSteady", "otherProcessesSmPctPerClip", "profile",
                                           "summary")}, indent=2), flush=True)


if __name__ == "__main__":
    main()
