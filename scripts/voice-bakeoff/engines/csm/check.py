"""Sanity check for runaway / truncated clips: ASR every WAV and compare with the script.

  HF_HOME=../../../../voice-engines/_models/_hf_cache uv run --with faster-whisper check.py \
    --lines ../../lines.json --samples ../../../../voice-engines/_samples/bakeoff-2026-09-30 --engine csm-1b
"""

import argparse
import difflib
import json
import os
import re
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
import numpy as np
import soundfile as sf


def norm(t: str) -> list[str]:
    t = re.sub(r"\{[a-z]+\}", " ", t.lower())
    return re.sub(r"[^a-z0-9' ]+", " ", t).split()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", required=True)
    ap.add_argument("--samples", required=True)
    ap.add_argument("--engine", required=True)
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()
    from faster_whisper import WhisperModel

    lines = json.loads(Path(args.lines).read_text())
    text_of = {i["id"]: i["text"] for i in lines["conversation"] + lines["readAloud"]}
    for n, t in enumerate(lines["dialogue"]["turns"]):
        text_of[f"{lines['dialogue']['id']}__turn{n}"] = t["text"]
    text_of[lines["dialogue"]["id"]] = " ".join(t["text"] for t in lines["dialogue"]["turns"])

    model = WhisperModel("Systran/faster-distil-whisper-large-v3", device=args.device,
                         compute_type="int8" if args.device == "cpu" else "float16")
    out = Path(args.samples) / "out" / args.engine
    report = {}
    for wav in sorted(out.glob("*.wav")):
        stem = wav.stem
        base = re.sub(r"__t\d+$", "", stem)
        key = base if base in text_of else base.split("__")[0]
        ref = text_of.get(key, "")
        audio, sr = sf.read(str(wav), dtype="float32")
        segs, _ = model.transcribe(audio if sr == 16000 else _rs(audio, sr), language="en", beam_size=5,
                                   vad_filter=False, condition_on_previous_text=False)
        hyp = " ".join(s.text.strip() for s in segs)
        r, h = norm(ref), norm(hyp)
        sm = difflib.SequenceMatcher(a=r, b=h)
        match = sum(b.size for b in sm.get_matching_blocks())
        recall = match / max(len(r), 1)
        extra = max(len(h) - match, 0)
        dur = len(audio) / sr
        w = int(sr * 0.1)
        rms = np.array([np.sqrt(np.mean(audio[i:i + w] ** 2)) for i in range(0, len(audio) - w + 1, w)])
        voiced = rms > 0.01  # WAVs are peak-normalised to -1 dBFS, so this is ~-40 dB re peak
        idx = np.flatnonzero(voiced)
        gap = 0.0
        if idx.size > 1:
            gap = float(np.max(np.diff(idx)) - 1) * 0.1
        flag = ""
        if gap >= 1.2:
            flag += f" LONG-GAP({gap:.1f}s)"
        if recall < 0.8:
            flag += " MISSING-WORDS"
        if extra >= 4:
            flag += " EXTRA-WORDS"
        report[stem] = {"durS": round(dur, 2), "recall": round(recall, 2), "extraWords": extra, "longestGapS": round(gap, 1), "asr": hyp}
        print(f"{stem:38s} {dur:6.2f}s recall={recall:.2f} extra={extra:2d}{flag}\n    asr: {hyp}", flush=True)
    Path(f"/tmp/csmdl/asr-{args.engine}.json").write_text(json.dumps(report, indent=2) + "\n")


def _rs(a, sr):
    from scipy.signal import resample_poly
    g = np.gcd(sr, 16000)
    return resample_poly(a, 16000 // g, sr // g).astype(np.float32)


if __name__ == "__main__":
    main()
