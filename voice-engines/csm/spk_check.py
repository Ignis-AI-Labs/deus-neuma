"""Speaker-similarity check: is a shrunk / CPU configuration still the same voice?

Cosine between voice-encoder embeddings of each output clip and its reference clip (Hannah / James), the
same proxy the Chatterbox Nano spike used (Chatterbox's VoiceEncoder, MIT, weights ve.safetensors from the
repo-local HF cache). Runs in the chatterbox-nano venv (it has chatterbox + librosa), CPU only:

  ../chatterbox-nano/.venv/bin/python spk_check.py csm-1b-small/ladder/a-bf16 csm-1b-small/ladder/g-...

Each arg is a dir under voice-engines/_samples/one-voice-spike/ (bakeoff-r2/out/<x> also accepted with
"slow:<x>"). Clips are matched to their voice by name (__hannah__ / __james__). Prints mean / min per dir.
"""

import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SPIKE = REPO / "voice-engines" / "_samples" / "one-voice-spike"
SLOW = REPO / "voice-engines" / "_samples" / "bakeoff-r2" / "out"
REFS = REPO / "voice-engines" / "_samples" / "bakeoff-r2" / "refs"
VE = next((REPO / "voice-engines" / "_models" / "_hf_cache" / "hub" / "models--ResembleAI--chatterbox-nano"
           / "snapshots").glob("*/ve.safetensors"))


def main():
    import librosa
    import torch
    from chatterbox.models.voice_encoder import VoiceEncoder
    from safetensors.torch import load_file

    torch.set_num_threads(8)
    ve = VoiceEncoder()
    ve.load_state_dict(load_file(str(VE)))
    ve.eval()

    def emb(path):
        w, _ = librosa.load(str(path), sr=16000)
        return ve.embeds_from_wavs([w], sample_rate=16000).mean(0)

    refs = {v: emb(REFS / f"{v.capitalize()}.wav") for v in ("hannah", "james")}
    out = {}
    for arg in sys.argv[1:]:
        d = SLOW / arg[5:] if arg.startswith("slow:") else SPIKE / arg
        rows = {}
        for p in sorted(d.glob("*.wav")):
            v = next((v for v in refs if f"__{v}__" in p.name), None)
            if v is None:
                continue
            e, r = emb(p), refs[v]
            rows[p.stem] = round(float(np.dot(e, r) / (np.linalg.norm(e) * np.linalg.norm(r))), 4)
        xs = list(rows.values())
        out[arg] = {"n": len(xs), "mean": round(float(np.mean(xs)), 4), "min": round(float(np.min(xs)), 4),
                    "clips": rows}
        print(f"{arg:50s} n={len(xs):2d} spkSim mean {out[arg]['mean']:.4f} min {out[arg]['min']:.4f}", flush=True)
    if len(sys.argv) > 1 and sys.argv[1].startswith("csm-1b-small/"):  # results live beside the spike clips
        (SPIKE / sys.argv[1] / "spk.json").write_text(json.dumps(out, indent=2) + "\n")


if __name__ == "__main__":
    main()
