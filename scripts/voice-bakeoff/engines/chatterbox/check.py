#!/usr/bin/env python3
"""ASR sanity pass over a runner's output: catches cues read aloud, babble, dropped words, silent tails.

Transcribes every line clip / being turn in out/<engine>/ with faster-whisper
(distil-large-v3, CPU int8), compares against the script text with cues removed,
and records per-clip WER plus flags into meta.json under "asrCheck" (and a
summary line in "notes"). It never touches the WAVs.

  uv run check.py --lines ../../lines.json --samples <S> --engines chatterbox-turbo,...
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

CUE_WORDS = {"laugh", "laughs", "laughing", "chuckle", "chuckles", "sigh", "sighs", "gasp", "gasps", "breath", "breathes"}
DEFAULT_MODEL = "/workspace/repos/neuma/voice-engines/_models/_hf_cache/hub/models--Systran--faster-distil-whisper-large-v3/snapshots/c3058b475261292e64a0412df1d2681c06260fab"


def norm_words(text: str) -> list[str]:
    # {cue}, [tag] and whisper sound annotations like (laughs) / *sighs* are not words
    text = re.sub(r"\{\w+\}|\[[^\]]*\]|\([^)]*\)|\*[^*]*\*", " ", text.lower())
    text = text.replace("’", "'")
    return re.findall(r"[a-z0-9']+", text)


def edit_ops(ref: list[str], hyp: list[str]) -> int:
    d = list(range(len(hyp) + 1))
    for i in range(1, len(ref) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(hyp) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (ref[i - 1] != hyp[j - 1]))
            prev = cur
    return d[len(hyp)]


def trailing_silence_s(path: Path) -> float:
    import numpy as np
    import soundfile as sf
    w, sr = sf.read(str(path))
    f = int(sr * 0.05)
    n = len(w) // f
    rms = np.sqrt((w[: n * f].reshape(n, f) ** 2).mean(1))
    idx = np.nonzero(rms > 0.02)[0]  # files are peak-normalised to -1 dBFS
    return len(w) / sr - ((idx[-1] + 1) * 0.05 if len(idx) else 0.0)


def expected(lines: dict) -> dict[str, str]:
    out = {}
    for ln in lines["conversation"] + lines["readAloud"]:
        for v in ln["voices"]:
            for t in range(1, lines["takes"] + 1):
                out[f"{ln['id']}__{v}__t{t}"] = ln["text"]
    dlg = lines["dialogue"]
    for n, turn in enumerate(dlg["turns"]):
        if turn["speaker"] == "hannah":
            for t in range(1, lines["takes"] + 1):
                out[f"{dlg['id']}__turn{n}__t{t}"] = turn["text"]
    for t in range(1, lines["takes"] + 1):  # whole dialogue: catches trouble in the person's turns too
        out[f"{dlg['id']}__t{t}"] = " ".join(turn["text"] for turn in dlg["turns"])
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", required=True, type=Path)
    ap.add_argument("--samples", required=True, type=Path)
    ap.add_argument("--engines", required=True)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--threads", type=int, default=8)
    args = ap.parse_args()

    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=args.threads)
    lines = json.loads(args.lines.read_text())
    exp = expected(lines)

    for engine in [e.strip() for e in args.engines.split(",") if e.strip()]:
        out = args.samples / "out" / engine
        meta_path = out / "meta.json"
        meta = json.loads(meta_path.read_text())
        results, flagged = {}, []
        for key, text in exp.items():
            wav = out / f"{key}.wav"
            if not wav.exists():
                continue
            segs, _ = model.transcribe(str(wav), language="en", beam_size=5, vad_filter=False,
                                       condition_on_previous_text=False)
            hyp_text = " ".join(s.text.strip() for s in segs)
            ref, hyp = norm_words(text), norm_words(hyp_text)
            wer = edit_ops(ref, hyp) / max(1, len(ref))
            cue_read = sorted(w for w in set(hyp) - set(ref) if w in CUE_WORDS)
            flags = []
            tail = trailing_silence_s(wav)
            if tail > 1.5:
                flags.append(f"{tail:.1f}s trailing silence (no stop token)")
            if cue_read:
                flags.append(f"cue word(s) heard: {','.join(cue_read)}")
            if len(hyp) > len(ref) + 4:
                flags.append(f"{len(hyp) - len(ref)} extra words")
            if wer > 0.25:
                flags.append(f"WER {wer:.2f}")
            results[key] = {"wer": round(wer, 3), "asr": hyp_text, **({"flags": flags} if flags else {})}
            if flags:
                flagged.append(f"{key} ({'; '.join(flags)})")
            print(f"[{engine}] {key} wer={wer:.2f} {flags} :: {hyp_text}", flush=True)
        wers = sorted(r["wer"] for r in results.values())
        med = wers[len(wers) // 2] if wers else None
        meta["asrCheck"] = {"model": "faster-distil-whisper-large-v3 (cpu int8)", "medianWer": med, "clips": results}
        meta["notes"] = [n for n in meta.get("notes", []) if not n.startswith("ASR check")]
        meta["notes"].append(f"ASR check: median WER {med} over {len(results)} clips; flagged: " + ("; ".join(flagged) if flagged else "none"))
        meta_path.write_text(json.dumps(meta, indent=2) + "\n")
        print(f"[{engine}] median WER {med}; flagged {len(flagged)}", flush=True)


if __name__ == "__main__":
    main()
