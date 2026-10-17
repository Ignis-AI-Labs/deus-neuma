"""Kokoro-82M bake-off runner — mirrors voice-engines/kokoro/server.py.

Run with the sidecar's own venv (see README.md in this dir). Loads the local
weights at voice-engines/_models/kokoro (kokoro-v1_0.pth + voices/*.pt), offline.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

MODEL_DIR = common.REPO / "voice-engines" / "_models" / "kokoro"
HF_CACHE = common.REPO / "voice-engines" / "_models" / "_hf_cache"
os.environ.setdefault("HF_HOME", str(HF_CACHE))
os.environ.setdefault("HF_HUB_CACHE", str(HF_CACHE))
os.environ.setdefault("HF_HUB_OFFLINE", "1")

PRESETS = {"hannah": "af_heart", "james": "am_michael"}

# Same edge trim the sidecar applies to every take (server.py _trim_edge_silence).
SILENCE_FLOOR = 1e-3
HEAD_GUARD_MS = 10
TAIL_GUARD_MS = 150


def trim_edges(audio, sr):
    import numpy as np
    loud = np.nonzero(np.abs(audio) > SILENCE_FLOOR)[0]
    if loud.size == 0:
        return audio
    first = max(0, int(loud[0]) - int(HEAD_GUARD_MS / 1000 * sr))
    last = min(audio.size, int(loud[-1]) + 1 + int(TAIL_GUARD_MS / 1000 * sr))
    return audio[first:last]


class Kokoro:
    engine_id = "kokoro"
    meta = {
        "model": "hexgrad/Kokoro-82M (kokoro-v1_0.pth)",
        "license": "Apache-2.0",
        "clones": False,
        "voiceNote": "no cloning — presets af_heart (hannah, warm American female) and "
                     "am_michael (james, calm American male)",
        "cues": "none supported — every {cue} removed",
        "contextAware": False,
        "settings": {"speed": 1.0, "lang_code": "a", "edgeTrim": "sidecar trim (10 ms head / 150 ms tail)"},
    }
    notes = [
        "no emotion control: lines.json emotion/intensity ignored",
        "ttfbMs = first chunk out of KPipeline's generator; KPipeline only splits on newlines "
        "(or >510 phonemes), so for these single-paragraph lines the first chunk is usually the "
        "whole line — Neuma gets sentence-level streaming by sending one request per sentence",
        "takes differ only by the vocoder's noise seed; t1/t2 are near-identical by design",
    ]

    def load(self):
        import torch
        from kokoro import KModel, KPipeline
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        model = KModel(config=str(MODEL_DIR / "config.json"),
                       model=str(MODEL_DIR / "kokoro-v1_0.pth")).to(self.device).eval()
        self.pipeline = KPipeline(model=model, lang_code="a", device=self.device)
        for v in set(PRESETS.values()):
            self.pipeline.voices[v] = torch.load(str(MODEL_DIR / "voices" / f"{v}.pt"),
                                                 weights_only=True)
        # warm-up (not measured)
        for _ in self.pipeline("Warming up.", voice="af_heart"):
            pass

    def render_text(self, raw):
        return common.strip_cues(raw)

    def synth(self, text, voice, emotion, intensity, seed):
        import numpy as np
        import torch
        t0 = time.perf_counter()
        ttfb = None
        chunks = []
        for result in self.pipeline(text, voice=PRESETS[voice], speed=1.0):
            if result.audio is None:
                continue
            a = torch.as_tensor(result.audio).detach().float().cpu().numpy()
            if ttfb is None:
                ttfb = (time.perf_counter() - t0) * 1000.0
            chunks.append(a)
        audio = np.clip(np.concatenate(chunks), -1.0, 1.0)
        return trim_edges(audio, 24000), 24000, ttfb


if __name__ == "__main__":
    common.run(Kokoro())
