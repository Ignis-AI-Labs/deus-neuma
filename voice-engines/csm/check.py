"""Quality check: whisper WER + duration sanity for spike WAVs vs the slow (bake-off) path.

Runs in the whisper sidecar's venv (faster-whisper, large-v3 CT2 weights, CPU int8):

  ../whisper/.venv/bin/python check.py --spike csm-1b --slow csm-1b
  ../whisper/.venv/bin/python check.py --spike misotts-8b --slow misotts-8b

--spike: dir under voice-engines/_samples/one-voice-spike/; --slow: dir under bakeoff-r2/out/.
Only clip ids present in BOTH are compared. Writes <spike dir>/asr.json.
"""

import argparse
import json
import re
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SPIKE = REPO / "voice-engines" / "_samples" / "one-voice-spike"
SLOW = REPO / "voice-engines" / "_samples" / "bakeoff-r2" / "out"
LINES = REPO / "scripts" / "voice-bakeoff" / "lines.json"
WHISPER = REPO / "voice-engines" / "_models" / "whisper"


def norm(t: str) -> list[str]:
    t = re.sub(r"\{[a-z]+\}", " ", t.lower())
    t = t.replace("-", " ")
    return re.sub(r"[^a-z0-9' ]+", " ", t).split()


def wer(ref: list[str], hyp: list[str]) -> float:
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
    return d[-1] / max(len(ref), 1)


def texts() -> dict[str, str]:
    lines = json.loads(LINES.read_text())
    t = {i["id"]: i["text"] for i in lines["conversation"] + lines["readAloud"]}
    dlg = lines["dialogue"]
    for n, turn in enumerate(dlg["turns"]):
        t[f"{dlg['id']}__turn{n}"] = turn["text"]
    t[dlg["id"]] = " ".join(x["text"] for x in dlg["turns"])
    return t


def analyse(model, path: Path, ref: str) -> dict:
    from faster_whisper import decode_audio

    audio = decode_audio(str(path), sampling_rate=16000)
    segs, _ = model.transcribe(audio, language="en", beam_size=5, vad_filter=False,
                               condition_on_previous_text=False)
    hyp = " ".join(s.text.strip() for s in segs)
    dur = len(audio) / 16000
    w = 1600
    rms = np.array([np.sqrt(np.mean(audio[i:i + w] ** 2)) for i in range(0, len(audio) - w + 1, w)])
    idx = np.flatnonzero(rms > 0.01)
    gap = float(np.max(np.diff(idx)) - 1) * 0.1 if idx.size > 1 else 0.0
    nref = len(norm(ref))
    return {"durS": round(dur, 2), "wer": round(wer(norm(ref), norm(hyp)), 3), "secPerWord": round(dur / max(nref, 1), 3),
            "longestGapS": round(gap, 1), "asr": hyp}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spike", required=True)
    ap.add_argument("--slow", required=True)
    args = ap.parse_args()
    from faster_whisper import WhisperModel

    model = WhisperModel(str(WHISPER), device="cpu", compute_type="int8", cpu_threads=8)
    tx = texts()
    sdir, odir = SPIKE / args.spike, SLOW / args.slow
    ids = sorted(p.stem for p in sdir.glob("*.wav") if (odir / p.name).exists())
    rows = {}
    for cid in ids:
        base = re.sub(r"__t\d+$", "", cid)
        key = base if base in tx else base.split("__")[0]
        ref = tx[key]
        rows[cid] = {"fast": analyse(model, sdir / f"{cid}.wav", ref), "slow": analyse(model, odir / f"{cid}.wav", ref)}
        f, s = rows[cid]["fast"], rows[cid]["slow"]
        print(f"{cid:28s} fast WER {f['wer']:.2f} {f['durS']:5.2f}s ({f['secPerWord']:.2f} s/w, gap {f['longestGapS']:.1f})"
              f" | slow WER {s['wer']:.2f} {s['durS']:5.2f}s ({s['secPerWord']:.2f} s/w)\n    fast: {f['asr']}", flush=True)

    def agg(side):
        ws = [r[side]["wer"] for r in rows.values()]
        spw = [r[side]["secPerWord"] for r in rows.values() if not r[side] is None]
        return {"meanWer": round(float(np.mean(ws)), 3), "medianWer": round(float(np.median(ws)), 3),
                "clipsWerOver0.2": int(sum(w > 0.2 for w in ws)), "medianSecPerWord": round(float(np.median(spw)), 3),
                "clipsWithGapOver1.2s": int(sum(r[side]["longestGapS"] >= 1.2 for r in rows.values()))}

    summary = {"n": len(rows), "fast": agg("fast"), "slow": agg("slow"),
               "whisper": "faster-whisper large-v3 (voice-engines/_models/whisper), CPU int8, beam 5"}
    (sdir / "asr.json").write_text(json.dumps({"summary": summary, "clips": rows}, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
