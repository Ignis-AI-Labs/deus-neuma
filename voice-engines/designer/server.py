"""Voice designer sidecar — words in, a voice out (the forge's DESCRIBE door).

ONE VOICE (docs/work/one-voice.md): "Describe one" turns a written description
into a clip and its words; that clip then becomes a candidate like any other,
and the csm / Nano engines clone it. The designer is OpenBMB VoxCPM2 voice
design ("(description)text", no reference audio) — the engine that made the
cleanest designed clips in the bake-off (scripts/voice-bakeoff/design-refs.py).
It runs in its OWN venv (its torch/transformers pins conflict with csm's) and
only on demand: the backend launches it when someone describes a voice, and
the engine manager reaps it after the idle TTL.

Endpoints (loopback only — every request from a non-loopback peer gets 403):
    GET  /health    {ok, model, phase: loading|ready|failed, idle_seconds,
                     sample_rate, device, error}
    POST /design    {description, seed?, seconds?} -> {wav_b64, words, sample_rate,
                     seconds, seed, model, gen_ms}. `words` are exactly the words
                     spoken in the clip (the designer reads a fixed passage), so
                     no transcription is needed. `seconds` picks the passage: the
                     short one when <= 8, else the long one (default; measured
                     11-12.5 s of voice).
    POST /shutdown  the idle contract every voice sidecar keeps (speak-protocol.md)

Weights: DESIGNER_MODEL_DIR, else voice-engines/_models/designer (a snapshot of
openbmb/VoxCPM2, Apache-2.0).
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
import sys
import threading
import time
import wave
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

REPO_VOICE = Path(__file__).resolve().parent.parent
MODEL_DIR = Path(os.environ.get("DESIGNER_MODEL_DIR") or REPO_VOICE / "_models" / "designer")
MODEL_NAME = "voxcpm2"
PEAK_DBFS = -1.0
DESCRIPTION_MAX = 500
LOOPBACK_BINDS = frozenset({"127.0.0.1", "localhost", "::1"})
LOOPBACK_PEERS = frozenset({"127.0.0.1", "::1", "::ffff:127.0.0.1"})
UNTRACKED = frozenset({"/health", "/shutdown"})

# The words the designed voice speaks: natural, conversational, no tags (VoxCPM2
# has no laugh token). The long one gives csm 11-12.5 s of voice to clone (measured).
PASSAGE_SHORT = ("Hey, it's good to hear from you. I was just thinking about you, actually. "
                 "How has your day been so far?")
PASSAGE_LONG = ("Oh, hey! Honestly, I'm glad you called. I was just sitting here thinking about "
                "last weekend, that whole afternoon by the lake. Anyway, how are you, really? "
                "You sounded a little tired yesterday, and I wanted to check on you.")

app = FastAPI(title="Voice designer sidecar", version="0.1.0")
_state: dict = {"model": None, "sr": 24000, "device": None, "phase": "loading", "error": None}
_last_activity = time.monotonic()
_lock = asyncio.Lock()


def log(*parts) -> None:
    print("[designer]", *parts, file=sys.stderr, flush=True)


def error(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse({"error": code, "detail": detail}, status_code=status)


sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from browser_guard import guard  # noqa: E402  (audits 2026-10-28/29 M-06)


@app.middleware("http")
async def _guard_and_track(request: Request, call_next):
    # Loopback is the only gate on /design and /shutdown; refuse anything else
    # before it runs, even if the bind were ever widened.
    if (request.client.host if request.client else None) not in LOOPBACK_PEERS:
        return error(403, "forbidden", "the designer answers loopback callers only")
    answer = guard(request.headers, request.url.path, request.url.query)  # browser_guard.py: page, key
    if answer:
        return JSONResponse(answer[1], status_code=answer[0])
    global _last_activity
    tracked = request.url.path not in UNTRACKED
    if tracked:
        _last_activity = time.monotonic()
    response = await call_next(request)
    if tracked:
        _last_activity = time.monotonic()
    return response


def _load() -> None:
    try:
        if not (MODEL_DIR / "config.json").exists():
            raise RuntimeError(f"VoxCPM2 weights not found at {MODEL_DIR} — download openbmb/VoxCPM2 there")
        import torch
        from voxcpm import VoxCPM

        t0 = time.time()
        model = VoxCPM.from_pretrained(str(MODEL_DIR), load_denoiser=False, optimize=False)
        _state.update(model=model, sr=int(model.tts_model.sample_rate),
                      device="cuda" if torch.cuda.is_available() else "cpu", phase="ready")
        log(f"ready in {time.time() - t0:.1f}s on {_state['device']} ({_state['sr']} Hz)")
    except Exception as e:  # the phase says it plainly instead of an endless "loading"
        _state.update(phase="failed", error=str(e))
        log(f"FATAL: {e}")


@app.on_event("startup")
async def _startup() -> None:
    threading.Thread(target=_load, daemon=True).start()


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({
        "ok": _state["phase"] == "ready",
        "model": MODEL_NAME,
        "phase": _state["phase"],
        "idle_seconds": round(time.monotonic() - _last_activity, 1),
        "sample_rate": _state["sr"],
        "device": _state["device"],
        "error": _state["error"],
    })


@app.post("/shutdown")
async def shutdown() -> JSONResponse:
    # The engine manager reaps idle sidecars; a real request that raced in after
    # its idle check abandons the exit, so a reap never cuts a design short.
    def _exit_if_still_idle() -> None:
        if time.monotonic() - _last_activity < 0.5:
            return
        os._exit(0)
    asyncio.get_running_loop().call_later(0.3, _exit_if_still_idle)
    return JSONResponse({"ok": True, "shutting_down": True})


def _seed_all(seed: int) -> None:
    import random

    import numpy as np
    import torch

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def _wav_bytes(audio, sr: int) -> tuple[bytes, float]:
    """Mono 16-bit WAV, peak-normalised to -1 dBFS (loudness never decides a pick)."""
    import numpy as np

    a = np.asarray(audio, dtype=np.float32).reshape(-1)
    peak = float(np.max(np.abs(a))) if a.size else 0.0
    if peak > 1e-9:
        a = a * (10 ** (PEAK_DBFS / 20) / peak)
    pcm = (np.clip(a, -1.0, 1.0) * 32767.0).round().astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return buf.getvalue(), len(a) / sr


def _design(description: str, text: str, seed: int) -> tuple[bytes, float]:
    _seed_all(seed)
    audio = _state["model"].generate(text=f"({description}){text}", cfg_value=2.0, inference_timesteps=10)
    return _wav_bytes(audio, _state["sr"])


@app.post("/design")
async def design(request: Request) -> JSONResponse:
    if _state["phase"] != "ready":
        return JSONResponse({"error": "not_ready", "detail": _state["error"] or "the model is loading",
                             "phase": _state["phase"]}, status_code=503)
    try:
        body = await request.json()
    except Exception:
        return error(400, "bad_request", "send JSON {description, seed?, seconds?}")
    description = body.get("description") if isinstance(body, dict) else None
    if not isinstance(description, str) or not description.strip():
        return error(400, "bad_request", "description is required")
    description = " ".join(description.split())
    if len(description) > DESCRIPTION_MAX:
        return error(413, "too_long", f"a description is at most {DESCRIPTION_MAX} characters")
    seed = body.get("seed", 1)
    if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0:
        return error(400, "bad_request", "seed is a non-negative integer")
    seconds = body.get("seconds")
    text = PASSAGE_SHORT if isinstance(seconds, (int, float)) and seconds <= 8 else PASSAGE_LONG
    # The designer's own parentheses frame the description; strip any the caller sent.
    description = description.replace("(", " ").replace(")", " ").strip()

    async with _lock:
        t0 = time.perf_counter()
        try:
            wav, secs = await asyncio.to_thread(_design, description, text, seed)
        except Exception as e:
            return error(500, "internal", f"design failed: {e}")
        gen_ms = round((time.perf_counter() - t0) * 1000)
    log(f"designed {secs:.1f}s of voice in {gen_ms} ms (seed {seed})")
    return JSONResponse({
        "wav_b64": base64.b64encode(wav).decode("ascii"),
        "words": text,
        "sample_rate": _state["sr"],
        "seconds": round(secs, 2),
        "seed": seed,
        "model": MODEL_NAME,
        "gen_ms": gen_ms,
    })


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("DESIGNER_HOST", "127.0.0.1")
    port = int(os.environ.get("DESIGNER_PORT", "7870"))
    # FAIL-CLOSED: the routes are unauthenticated; the loopback bind is the boundary.
    if host not in LOOPBACK_BINDS:
        log(f"FATAL: refusing non-loopback bind DESIGNER_HOST={host!r}")
        sys.exit(2)
    uvicorn.run(app, host=host, port=port, log_level="info")
