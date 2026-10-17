"""Kyutai TTS 1.6B (kyutai/tts-1.6b-en_fr) bake-off runner.

Loads the managed flat dir voice-engines/_models/kyutai exactly as
voice-engines/kyutai/server.py does (CheckpointInfo with explicit local paths,
n_q=32, temp=0.6, cfg_coef=2.0 baked into the condition attributes). Voices are
the pre-computed CC0 voice-donations embeddings for Hannah and James — the same
donors as refs/. Uses moshi's own TTSModel.generate (upstream tts_pytorch.py
flow) with an on_frame mimi decode, so TTFB = first decoded 80 ms frame.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

MODEL_DIR = common.REPO / "voice-engines" / "_models" / "kyutai"
CONFIG_PATH = MODEL_DIR / "config.json"
HF_REPO = "kyutai/tts-1.6b-en_fr"  # identifier only, never used for IO
CFG_COEF = float(os.environ.get("KYUTAI_CFG_COEF", "2.0"))
VOICES = {"hannah": "voice-donations/Hannah.wav", "james": "voice-donations/James.wav"}


class KyutaiRunner:
    engine_id = "kyutai"
    meta = {
        "model": "kyutai/tts-1.6b-en_fr (dsm_tts_1e68beda@240)",
        "license": "CC-BY-4.0 (weights); voices CC0 voice-donations",
        "clones": False,
        "voiceNote": "pre-computed embeddings voice-donations/Hannah.wav and James.wav "
                     "(same donors as refs/, so effectively a clone of the same speakers)",
        "cues": "none supported — every {cue} removed",
        "contextAware": False,
        "settings": {"n_q": 32, "temp": 0.6, "cfg_coef": CFG_COEF, "padding_between": 1},
    }
    notes = [
        "no emotion control: lines.json emotion/intensity ignored",
        "ttfbMs = first decoded mimi frame (script is given whole, audio streams out frame by frame)",
    ]

    def load(self):
        import torch
        from moshi.models.loaders import CheckpointInfo
        from moshi.models.tts import TTSModel
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        cfg = json.loads(CONFIG_PATH.read_text())
        ckpt = CheckpointInfo.from_hf_repo(
            HF_REPO,
            moshi_weights=MODEL_DIR / cfg["moshi_name"],
            mimi_weights=MODEL_DIR / cfg["mimi_name"],
            tokenizer=MODEL_DIR / cfg["tokenizer_name"],
            config_path=CONFIG_PATH,
        )
        self.tts = TTSModel.from_checkpoint_info(ckpt, n_q=32, temp=0.6, device=self.device)
        self.sr = int(self.tts.mimi.sample_rate)
        self.conds = {
            v: self.tts.make_condition_attributes(
                [MODEL_DIR / (slug + self.tts.voice_suffix)], cfg_coef=CFG_COEF)
            for v, slug in VOICES.items()
        }
        self.synth("Warming up.", "hannah", None, None, 0)  # not measured

    def render_text(self, raw):
        return common.strip_cues(raw)

    def synth(self, text, voice, emotion, intensity, seed):
        import numpy as np
        import torch
        pcms = []
        state = {"ttfb": None}
        t0 = time.perf_counter()

        def on_frame(frame):
            if (frame != -1).all():
                pcm = self.tts.mimi.decode(frame[:, 1:, :]).cpu().numpy()
                if state["ttfb"] is None:
                    state["ttfb"] = (time.perf_counter() - t0) * 1000.0
                pcms.append(np.clip(pcm[0, 0], -1.0, 1.0))

        entries = self.tts.prepare_script([text], padding_between=1)
        with torch.no_grad(), self.tts.mimi.streaming(1):
            self.tts.generate([entries], [self.conds[voice]], on_frame=on_frame)
        return np.concatenate(pcms), self.sr, state["ttfb"]


if __name__ == "__main__":
    common.run(KyutaiRunner())
