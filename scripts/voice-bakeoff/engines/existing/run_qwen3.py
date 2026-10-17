"""Qwen3-TTS 12Hz 1.7B Base bake-off runner (engine id qwen3-tts).

Loads voice-engines/_models/qwen3/base (bf16) the way voice-engines/qwen3/server.py
does, but only the Base checkpoint (the VoiceDesign checkpoint in
_models/qwen3/voice-design is present and NOT used here — clone path only).

Clone mode: QWEN3_CLONE_MODE=icl (default, the model card's recommended clone:
ref audio + ref transcript from refs/transcripts.json) or =xvec (speaker
embedding only — what Neuma's sidecar sends today, x_vector_only_mode=True).
xvec writes to out/qwen3-tts-xvec/ so the two never overwrite each other.
"""

from __future__ import annotations

import json
import os
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

BASE_DIR = common.REPO / "voice-engines" / "_models" / "qwen3" / "base"
MODE = os.environ.get("QWEN3_CLONE_MODE", "icl")
assert MODE in ("icl", "xvec"), MODE


class Qwen3Runner:
    engine_id = "qwen3-tts" if MODE == "icl" else "qwen3-tts-xvec"
    meta = {
        "model": "Qwen/Qwen3-TTS-12Hz-1.7B-Base (bf16)",
        "license": "Apache-2.0",
        "clones": True,
        "voiceNote": ("cloned from refs/Hannah.wav and refs/James.wav + refs/transcripts.json (ICL mode)"
                      if MODE == "icl" else
                      "cloned from refs/Hannah.wav and refs/James.wav, speaker embedding only "
                      "(x_vector_only_mode — Neuma sidecar path)"),
        "cues": "none supported by the Base checkpoint — every {cue} removed",
        "contextAware": False,
        "settings": {"cloneMode": MODE, "language": "English", "non_streaming_mode": False,
                     "generation": "checkpoint generation_config.json defaults (do_sample, temp 0.9, "
                                   "top_k 50, top_p 1.0, repetition_penalty 1.05)"},
    }
    notes = [
        "no emotion control on the Base checkpoint: lines.json emotion/intensity ignored",
        "VoiceDesign checkpoint (instruct-by-description) is installed at _models/qwen3/voice-design "
        "but not used: comparison uses the clone path",
        "batch-only generation (qwen-tts 0.1.1 has no streaming path): no ttfbMs",
    ] + (["ICL mode (ref audio + transcript) is the model card's recommended clone; Neuma's sidecar "
          "currently uses x_vector_only_mode=True"] if MODE == "icl" else [])

    def load(self):
        import numpy as np
        import torch
        from qwen_tts import Qwen3TTSModel
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = Qwen3TTSModel.from_pretrained(str(BASE_DIR), device_map=self.device,
                                                   dtype=torch.bfloat16)
        transcripts = json.loads((self.samples / "refs" / "transcripts.json").read_text())
        self.prompts = {}
        for voice, cfg in self.voices_cfg.items():
            ref_path = self.samples / cfg["ref"]
            with wave.open(str(ref_path)) as w:
                sr, ch = w.getframerate(), w.getnchannels()
                pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
            if ch == 2:
                pcm = pcm.reshape(-1, 2).mean(axis=1)
            ref = (np.ascontiguousarray(pcm), sr)
            if MODE == "icl":
                self.prompts[voice] = self.model.create_voice_clone_prompt(
                    ref_audio=[ref], ref_text=[transcripts[ref_path.stem]], x_vector_only_mode=False)
            else:
                self.prompts[voice] = self.model.create_voice_clone_prompt(
                    ref_audio=[ref], ref_text=None, x_vector_only_mode=True)
        self.synth("Warming up.", "hannah", None, None, 0)  # not measured

    def render_text(self, raw):
        return common.strip_cues(raw)

    def synth(self, text, voice, emotion, intensity, seed):
        import numpy as np
        wavs, sr = self.model.generate_voice_clone(
            text=text, language="English", voice_clone_prompt=self.prompts[voice],
            non_streaming_mode=False)
        audio = np.concatenate([np.asarray(w, dtype=np.float32) for w in wavs])
        return np.clip(audio, -1.0, 1.0), int(sr), None


if __name__ == "__main__":
    common.run(Qwen3Runner())
