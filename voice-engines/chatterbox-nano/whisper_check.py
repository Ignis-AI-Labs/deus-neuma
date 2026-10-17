#!/usr/bin/env python3
"""Whisper check for a bench run: did streaming cost words?

Runs in the whisper sidecar's venv (faster-whisper, large-v3 CT2 weights, CPU int8):

  ../whisper/.venv/bin/python whisper_check.py ort-token-t8-fp100 [more tags...]

Reads _samples/one-voice-spike/chatterbox-nano/runs/<tag>.json, transcribes every saved WAV,
and writes runs/<tag>.asr.json with per-clip WER against the script (cue tags removed).
WER helpers follow scripts/voice-bakeoff/engines/chatterbox/check.py (this repo).
"""
from __future__ import annotations

import json
import os
import re
import statistics
import sys
from pathlib import Path

os.environ["CUDA_VISIBLE_DEVICES"] = ""
HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "_samples" / "one-voice-spike" / "chatterbox-nano"
MODEL = HERE.parent / "_models" / "whisper"


def norm_words(text: str) -> list[str]:
    text = re.sub(r"\{\w+\}|\[[^\]]*\]|\([^)]*\)|\*[^*]*\*", " ", text.lower()).replace("’", "'")
    words = re.findall(r"[a-z0-9']+", text)
    return [w for w in words if w not in {"uh", "um", "hmm", "mm"}]


def edits(ref: list[str], hyp: list[str]) -> int:
    d = list(range(len(hyp) + 1))
    for i in range(1, len(ref) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(hyp) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (ref[i - 1] != hyp[j - 1]))
            prev = cur
    return d[len(hyp)]


def main() -> int:
    from faster_whisper import WhisperModel
    model = WhisperModel(str(MODEL), device="cpu", compute_type="int8", cpu_threads=int(os.environ.get("ASR_THREADS", "4")))
    for tag in sys.argv[1:]:
        run = json.loads((OUT / "runs" / f"{tag}.json").read_text())
        rows = []
        for r in run["results"]:
            if not r.get("wav"):
                continue
            segs, _ = model.transcribe(str(OUT / tag / r["wav"]), language="en", beam_size=5, vad_filter=False)
            hyp = " ".join(s.text.strip() for s in segs)
            ref_w, hyp_w = norm_words(r["text"]), norm_words(hyp)
            wer = edits(ref_w, hyp_w) / max(1, len(ref_w))
            rows.append({"wav": r["wav"], "wer": round(wer, 3), "hyp": hyp})
            print(f"{tag} {r['wav']} WER {wer:.3f} | {hyp}", flush=True)
        summary = {"tag": tag, "model": str(MODEL), "clips": len(rows),
                   "medianWer": round(statistics.median([x["wer"] for x in rows]), 3) if rows else None,
                   "meanWer": round(statistics.mean([x["wer"] for x in rows]), 3) if rows else None,
                   "clips>10%": sum(x["wer"] > 0.10 for x in rows), "rows": rows}
        (OUT / "runs" / f"{tag}.asr.json").write_text(json.dumps(summary, indent=2) + "\n")
        print("ASR", json.dumps({k: summary[k] for k in ("tag", "clips", "medianWer", "meanWer", "clips>10%")}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
