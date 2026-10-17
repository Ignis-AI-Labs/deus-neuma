"""Chatterbox Nano sidecar — the LIGHT voice tier, CPU only, speaking the speak protocol.

Contract: docs/architecture/voice/speak-protocol.md (served by voice-engines/_speak/speak_app.py).
Engine: nano_stream.NanoStream at the spike's best measured config (README of the spike:
docs/work/one-voice.md; final.sh "best": ONNX int8 LM, pipelined T3, 1 mean-flow step, prompt 100,
window 50, first chunk 20 tokens, 2 flat chunks) — those are NanoStream's defaults.

Context is accepted, validated and ignored (Nano conditions on the voice clip only).

Operator env:
    CHATTERBOX_NANO_HOST (127.0.0.1 only) / CHATTERBOX_NANO_PORT (7869)
    NANO_THREADS  total CPU threads (default 8 — the measured desktop config; 4 ~ a laptop)
    NANO_CPUS     optional CPU list to pin to, e.g. "0-7" (the bench pinned the P-cores)
"""

from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "_speak"))
# torch (OpenMP) and ORT share the cores between LM steps; parked waiters, not spinning ones (sweep.sh)
os.environ.setdefault("OMP_WAIT_POLICY", "PASSIVE")

import nano_stream  # noqa: E402  (hides CUDA and points HF_HOME at the repo cache before torch loads)
from speak_app import create_app, serve  # noqa: E402
from speak_audio import BoundedLRU  # noqa: E402

THREADS = int(os.environ.get("NANO_THREADS", "8"))
CPUS = os.environ.get("NANO_CPUS")
# NanoStream keeps one prepared voice per reference path; the speak runtime keeps its own LRU by clip
# ref, so the engine's map only needs the voice being spoken right now (re-seated before each stream)
ENGINE_VOICES = 4
WARM_TEXT = "Hello there, this is a short warm-up sentence."


def _parse_cpus(spec: str) -> set[int]:
    cpus: set[int] = set()
    for part in spec.split(","):
        a, _, b = part.strip().partition("-")
        cpus.update(range(int(a), int(b or a) + 1))
    return cpus


class NanoEngine:
    model = "chatterbox-nano"
    device = "cpu"
    context = False

    def __init__(self):
        self.eng: nano_stream.NanoStream | None = None

    def load(self, set_phase) -> None:
        if CPUS:
            os.sched_setaffinity(0, _parse_cpus(CPUS))
        eng = nano_stream.NanoStream(threads=THREADS)
        eng.voices = BoundedLRU(ENGINE_VOICES)  # upstream's map grows per path forever
        self.eng = eng
        # warm-up on the model's built-in voice (conds.pt): first-run kernel setup is paid here,
        # not by the first real utterance
        conds = eng.model.conds
        cond_emb = eng.t3.prepare_conditioning(conds.t3)
        _, past = eng.lm.prefill(cond_emb)
        key = str(Path("builtin").resolve())
        eng.voices[key] = nano_stream.Voice(conds=conds, prefix_len=cond_emb.size(1), past=past)
        t0 = time.perf_counter()
        for _ in eng.stream(WARM_TEXT, key, seed=0):
            pass
        print(f"[nano] warm-up {time.perf_counter() - t0:.1f}s, {THREADS} threads", file=sys.stderr, flush=True)

    def prepare_voice(self, voice):
        """NanoStream.voice() takes a path: the clip becomes a 0600 file in a private 0700 temp dir for
        exactly as long as upstream reads it, then file and dir are removed."""
        with tempfile.TemporaryDirectory(prefix="nano-voice-") as tmp:
            path = Path(tmp) / (voice.ref.split(":", 1)[1] + ".wav")
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(voice.wav)
            key = str(path.resolve())
            return key, self.eng.voice(key)

    def plan(self, text, voice_state, _voice_words, _context, max_audio_ms):
        return (nano_stream.translate_cues(text), voice_state, max_audio_ms), 0

    def stream(self, plan):
        text, (key, v), max_audio_ms = plan
        self.eng.voices[key] = v  # the voice file is gone; the prepared voice is all upstream needs
        cap = None if max_audio_ms is None else int(max_audio_ms * nano_stream.SR / 1000)
        sent = 0
        gen = self.eng.stream(text, key)
        try:
            for pcm in gen:
                if cap is not None and sent + pcm.size >= cap:
                    yield pcm[: cap - sent]
                    return
                sent += pcm.size
                yield pcm
        finally:
            gen.close()  # stops the T3 sampling thread too

    def memo(self):
        return None


app = create_app(NanoEngine(), title="Chatterbox Nano sidecar")

if __name__ == "__main__":
    serve(app, env_prefix="CHATTERBOX_NANO", default_port=7869)
