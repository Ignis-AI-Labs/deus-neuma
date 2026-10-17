"""Sesame CSM sidecar — the STANDARD (csm-1b) and HIGH (misotts-8b) voice tiers, speaking the speak protocol.

Contract: docs/architecture/voice/speak-protocol.md (served by voice-engines/_speak/speak_app.py).
Engine: csm_stream.CsmStream, used as is — this file only adapts it:
  * the voice clip is the first context segment (speaker 0, with its words); `being` segments are
    speaker 0, `person` segments speaker 1, oldest first; the reply is speaker 0;
  * a `ref` segment re-enters as the Mimi codes kept for that utterance (no re-encode);
  * when clip + context + reply overflow the 2048-position window, the OLDEST context segments drop
    (never the clip) and X-Context-Used says how many stayed; clip + text alone overflowing is 413;
  * CsmStream's per-audio codes cache is unbounded by design (a bench process is short-lived); a
    long-lived sidecar swaps it for a bounded LRU.

Operator env:
    CSM_HOST (127.0.0.1 only) / CSM_PORT (7868)
    CSM_MODEL  csm-1b (default, bf16) | misotts-8b (weight-only int8, as bench.py --quant int8)
    CSM_PROFILE  full (default) | lean — two memory profiles of the SAME voice (csm-1b only):
               lean = int8 backbone + decoder, 1024-position window, Mimi bf16 with its encoder on the
               CPU, weight prep on the CPU, expandable CUDA segments: ~2.5 GB instead of ~5.7 GB, for
               8 GB cards beside a small mind (bench.py --quant int8 --lean --kv-len 1024
               --mimi-dtype bf16 --mimi-enc-device cpu). The shorter window bounds clip + context +
               reply to 1024 positions (~80 s of audio and text together).
    TORCHINDUCTOR_CACHE_DIR  defaults under voice-engines/_models/csm/ so the first-ever compile
                             (minutes) is paid once per machine, not once per launch
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODELS_ROOT = HERE.parent / "_models"
MODEL = os.environ.get("CSM_MODEL", "csm-1b")
PROFILE = os.environ.get("CSM_PROFILE", "full")
# CsmStream options per (model, profile) — the measured configurations (docs/work/one-voice.md)
PROFILES = {
    ("csm-1b", "full"): {},
    ("csm-1b", "lean"): {"quant": "int8", "lean": True, "kv_len": 1024, "mimi_dtype": "bf16",
                         "mimi_enc_device": "cpu"},
    ("misotts-8b", "full"): {"quant": "int8"},
}
# must be set before torch is imported (csm_stream imports it)
os.environ.setdefault("TORCHINDUCTOR_CACHE_DIR", str(MODELS_ROOT / "csm" / "torchinductor"))
if PROFILE == "lean":  # the lean footprint was measured with growable segments (no reserved slack)
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
sys.path.insert(0, str(HERE.parent / "_speak"))

from csm_stream import MODELS, Segment, CsmStream  # noqa: E402
from speak_app import create_app, serve  # noqa: E402
from speak_audio import BoundedLRU, SpeakError  # noqa: E402

MAX_FRAMES = 1000           # 80 s: the generator's history buffer; the 2048 window binds first
FRAME_MS = 80
MIN_REPLY_FRAMES = 25       # 2 s: below this the voice clip + text leave no room to speak at all
CODES_LRU = 32              # encoded context audio (the person's mic turns) kept on the GPU
SPEAKER = {"being": 0, "person": 1}


def reply_frames(text: str, max_audio_ms: float | None) -> int:
    """Pure: positions to keep free for the reply. ~1.2 frames per character (~15 chars/s speech at
    12.5 frames/s, with margin), capped by the caller's max_audio_ms and the generator's buffer."""
    est = math.ceil(len(text) * 1.2) + 12
    cap = MAX_FRAMES if max_audio_ms is None else min(MAX_FRAMES, int(max_audio_ms // FRAME_MS))
    return max(1, min(est, cap))


def fit_context(window: int, fixed: int, reserve: int, ctx_positions: list[int]) -> int:
    """Pure: how many of the NEWEST context segments fit beside the fixed prompt and the reply reserve."""
    keep = len(ctx_positions)
    while keep and fixed + sum(ctx_positions[len(ctx_positions) - keep:]) + reserve > window:
        keep -= 1
    return keep


class _ReportingCsm(CsmStream):
    """CsmStream that says when it moves from loading weights to compiling/capturing the frame step."""

    def __init__(self, set_phase, *args, **kw):
        self._set_phase = set_phase
        super().__init__(*args, **kw)

    def _build_graph(self, compile: bool):
        self._set_phase("compiling")
        super()._build_graph(compile)


class CsmEngine:
    device = "cuda"
    context = True

    def __init__(self, model: str, profile: str):
        self.model = model
        self.profile = profile
        self.gen: CsmStream | None = None

    def load(self, set_phase) -> None:
        if self.model not in MODELS:
            raise ValueError(f"CSM_MODEL={self.model!r} is not one of {sorted(MODELS)}")
        if (self.model, self.profile) not in PROFILES:
            raise ValueError(f"CSM_PROFILE={self.profile!r} is not offered for {self.model}")
        opts = PROFILES[(self.model, self.profile)]
        gen = _ReportingCsm(set_phase, self.model, compile=True, max_frames=MAX_FRAMES, **opts)
        gen._codes_cache = BoundedLRU(CODES_LRU)
        self.gen = gen
        gen.generate("Okay, let's get started.", 0, [], max_audio_ms=1600)  # first prefill + decode paid here

    def prepare_voice(self, voice):
        return self.gen.encode(voice.audio)  # (32, T) Mimi codes of the clip

    def _positions(self, words: str, speaker: int, codes) -> int:
        return self.gen._text_frames(words, speaker)[0].size(0) + codes.size(1) + 1  # +1: the EOS frame

    def plan(self, text, voice_codes, voice_words, context, max_audio_ms):
        g = self.gen
        # an issued utterance that produced no frames has no codes: it contributes nothing to re-enter
        segs = [Segment(SPEAKER[seg.speaker], seg.words, codes=memo if memo is not None else g.encode(seg.audio))
                for seg, memo in context if memo is not None or seg.audio is not None]
        fixed = self._positions(voice_words, 0, voice_codes) + g._text_frames(text, 0)[0].size(0)
        if fixed + MIN_REPLY_FRAMES > g.kv_len:
            raise SpeakError(413, "too_long", f"the voice clip and the text alone need {fixed} of the "
                                              f"{g.kv_len} positions; shorten one of them")
        reserve = reply_frames(text, max_audio_ms)
        keep = fit_context(g.kv_len, fixed, reserve, [self._positions(s.text, s.speaker, s.codes) for s in segs])
        prompt = [Segment(0, voice_words, codes=voice_codes), *segs[len(segs) - keep:]]
        return (text, prompt, max_audio_ms), keep

    def stream(self, plan):
        text, prompt, max_audio_ms = plan
        return self.gen.generate_stream(text, 0, prompt, max_audio_ms=max_audio_ms)

    def memo(self):
        return self.gen.last_codes


app = create_app(CsmEngine(MODEL, PROFILE), title="CSM sidecar")

if __name__ == "__main__":
    serve(app, env_prefix="CSM", default_port=7868)
