"""Zonos v0.1 transformer bake-off runner — mirrors voice-engines/zonos/server.py.

Loads voice-engines/_models/zonos/{config.json,model.safetensors}; clones from
refs/<Voice>.wav exactly as the sidecar does (stdlib WAV parse -> resample to
24 kHz -> CPU-built SpeakerEmbeddingLDA moved to the device); emotion vector
built the sidecar's way from a label + intensity.
"""

from __future__ import annotations

import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

MODEL_DIR = common.REPO / "voice-engines" / "_models" / "zonos"

# lines.json label -> Neuma emotion vocabulary (core/runtime/emotion-detector.js)
# -> Zonos slot via ZONOS_EMOTION in backend/services/voice/providers/zonos.js.
# 'surprised' / 'neutral' are already Zonos vocabulary and pass through.
LABEL_TO_NEUMA = {
    "warm": "empathic", "tender": "empathic", "reassuring": "empathic",
    "amused": "joyful", "excited": "joyful", "delighted": "joyful",
    "thoughtful": "contemplative", "earnest": "contemplative", "hesitant": "contemplative",
    "intimate": "serene", "shy": "serene", "quiet": "serene",
    "firm": "defiant", "curious": "curious", "sad": "melancholic",
    "surprised": "surprise", "neutral": "neutral",
}
ZONOS_EMOTION = {  # verbatim from providers/zonos.js
    "joyful": "happiness", "empathic": "happiness", "passionate": "happiness",
    "melancholic": "sadness", "defiant": "anger", "curious": "surprise",
    "serene": "neutral", "contemplative": "neutral",
}

# verbatim from server.py
_EMOTION_SLOTS = ['happiness', 'sadness', 'disgust', 'fear', 'surprise', 'anger', 'other', 'neutral']
_NEUTRAL_EMOTION = [0.3077, 0.0256, 0.0256, 0.0256, 0.0256, 0.0256, 0.2564, 0.3077]


def zonos_label(label):
    neuma = LABEL_TO_NEUMA.get(label, label)
    return ZONOS_EMOTION.get(neuma, neuma)


def build_emotion_vector(emotion, intensity):
    if not emotion or emotion.lower() == 'neutral':
        return list(_NEUTRAL_EMOTION)
    label = emotion.lower()
    if label not in _EMOTION_SLOTS:
        return list(_NEUTRAL_EMOTION)
    intensity = 0.7 if intensity is None else max(0.0, min(1.0, float(intensity)))
    vec = [0.0256] * 8
    vec[_EMOTION_SLOTS.index(label)] = intensity
    vec[_EMOTION_SLOTS.index('neutral')] = max(0.0256, 1.0 - intensity)
    return vec


class ZonosRunner:
    engine_id = "zonos"
    meta = {
        "model": "Zyphra/Zonos-v0.1-transformer",
        "license": "Apache-2.0",
        "clones": True,
        "voiceNote": "cloned from refs/Hannah.wav and refs/James.wav (speaker embedding, sidecar path)",
        "cues": "none supported — every {cue} removed",
        "contextAware": False,
        "settings": {"language": "en-us", "speaking_rate": 15.0, "cfg_scale": 2.0,
                     "sampling": {"min_p": 0.1}, "pitch_std": 20.0, "fmax": 22050.0,
                     "emotion": "8-slot vector: chosen slot = intensity, neutral = 1 - intensity "
                                "(server.py _build_emotion_vector); neutral label -> Zonos default vector",
                     "emotionMap": {k: zonos_label(k) for k in LABEL_TO_NEUMA}},
    }
    notes = [
        "settings are exactly the Neuma sidecar's (make_cond_dict defaults + emotion vector); "
        "emotion label mapped lines.json -> Neuma vocabulary -> Zonos slot via providers/zonos.js",
        "native 44.1 kHz output kept",
    ]

    def load(self):
        import torch
        from zonos.model import Zonos
        from zonos.speaker_cloning import SpeakerEmbeddingLDA
        import torchaudio
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = Zonos.from_local(str(MODEL_DIR / "config.json"),
                                      str(MODEL_DIR / "model.safetensors"), device=self.device)
        self.sr = int(self.model.autoencoder.sampling_rate)
        m = SpeakerEmbeddingLDA(device="cpu")
        m.to(self.device)
        m.device = self.device
        m.model.device = self.device
        self.model.spk_clone_model = m
        self.speakers = {}
        for voice, cfg in self.voices_cfg.items():
            with wave.open(str(self.samples / cfg["ref"])) as w:
                sr, ch = w.getframerate(), w.getnchannels()
                frames = w.readframes(w.getnframes())
            data = torch.frombuffer(bytearray(frames), dtype=torch.int16).float() / 32768.0
            wav = data.view(-1, ch).t().contiguous()
            if sr != 24000:
                wav = torchaudio.functional.resample(wav, sr, 24000)
            if wav.shape[0] > 1:
                wav = wav.mean(dim=0, keepdim=True)
            self.speakers[voice] = self.model.make_speaker_embedding(wav.to(self.device), 24000)
        # warm-up (compile / cuda graphs), not measured
        self.synth("Warming up the model.", "hannah", "neutral", None, 0)

    def render_text(self, raw):
        return common.strip_cues(raw)

    def synth(self, text, voice, emotion, intensity, seed):
        import numpy as np
        from zonos.conditioning import make_cond_dict
        cond = self.model.prepare_conditioning(make_cond_dict(
            text=text, language="en-us", speaker=self.speakers[voice],
            emotion=build_emotion_vector(zonos_label(emotion), intensity),
            speaking_rate=15.0))
        codes = self.model.generate(cond, progress_bar=False)
        audio = self.model.autoencoder.decode(codes).float().cpu().numpy()
        return np.clip(audio.reshape(-1), -1.0, 1.0), self.sr, None


if __name__ == "__main__":
    common.run(ZonosRunner())
