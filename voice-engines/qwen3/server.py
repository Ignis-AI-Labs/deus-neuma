"""Qwen3-TTS 1.7B sidecar — local HTTP server (clone + voice-design, batch).

Loads BOTH Qwen3-TTS-12Hz-1.7B checkpoints once at startup from the managed
flat dirs `voice-engines/_models/qwen3/{base,voice-design}/` (hardlinked from
the pinned HF snapshots: Base fd4b2543…, VoiceDesign 5ecdb673…), serves
synthesis as full-generation audio chunked into uniform 80 ms raw PCM frames.
The JS adapter (providers/qwen3.js, B-21) reads format from headers. qwen-tts
0.1.1 exposes no streaming path — batch-only, honestly labeled streaming:false.

Endpoints:
    GET  /health      → { ok, model, device, sample_rate, idle_seconds, busy }
    POST /shutdown    → { ok, shutting_down } (deferred still-idle re-check exit)
    POST /synthesize  → audio/raw 24 kHz pcm_s16le mono (full gen → 80 ms chunks)
        clone mode:  { text, ref_audio_b64 | ref_path, seed?, language? }
        design mode: { text, description, seed, language? }
        mode branch: design carries a description and NO ref; clone requires a
        ref. Both ref+description and neither are 400.
        resp headers: X-Audio-Format, X-Audio-Sample-Rate, X-Audio-Channels

Lifecycle (the kyutai disconnect saga, batch-shaped — threat model item 5):
ONE supervisor task per turn owns cancel/drain/release via a `turn_done`
event; the response generator's `finally` is SYNCHRONOUS-ONLY (awaiting inside
it is illegal under GeneratorExit — witnessed 2026-07-19); a pre-response
BaseException guard sets the event and awaits the supervisor; ONE global
asyncio.Lock spans generation AND drain; the watchdog is strongly referenced
and BATCH-shaped: (a) GENERATION phase — length-scaled timeout
`base + per_char × len(speech text)` (never the description — generation time
tracks output audio length); (b) DRAIN phase — per-chunk progress stamps,
inactivity ≥120 s trips, never a total-turn cap. A wedged generation cannot be
thread-killed in Python: the supervisor sets cancel, bounded-joins loudly, and
releases the lock — the abandoned worker's late frames are dropped on cancel.

Guards: safetensors-only weights (torch.load/pickle never run here); bounded
inputs (text/description caps, integer seed, server-side WAV re-validation
with duration cap); exact-set voice allowlist (400 naming the cause; the Base
clone model exposes no preset voices, so any voice id 400s fail-closed);
loopback bind only (non-loopback → FATAL); boolean log markers, bounded error
bodies that never echo payloads. Ref audio reaches the model ONLY as an
in-process (ndarray, sr) tuple — never as a user-supplied path/URL/base64
string through qwen-tts's convenience loader (which would fetch URLs → SSRF).

Operator env: QWEN3_HOST (127.0.0.1 only), QWEN3_PORT (7867),
QWEN3_REF_ROOT (ref_path allowlist root, default voice-engines/_samples),
QWEN3_GEN_BASE_S / QWEN3_GEN_PER_CHAR_S (watchdog curve, measured on rig).

Reference: https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base (qwen-tts 0.1.1)
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import concurrent.futures
import io
import json
import os
import sys
import threading
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MODEL_ROOT = REPO_ROOT / "_models" / "qwen3"
BASE_DIR = MODEL_ROOT / "base"
DESIGN_DIR = MODEL_ROOT / "voice-design"
DEFAULT_REF_ROOT = REPO_ROOT / "_samples"

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Qwen3-TTS Sidecar", version="0.1.0")

_MODEL_LABEL = "qwen3-tts-12hz-1.7b"

_MAX_TEXT = 4000
_MAX_DESCRIPTION = 2000
_MAX_LANGUAGE = 64
_SEED_MAX = 2**31 - 1
_REF_B64_MAX_CHARS = 3_900_000        # ≈60 s of 24 kHz s16 mono WAV + header, base64
_REF_MAX_WAV_BYTES = 2_950_000        # decoded WAV cap; the duration cap is the semantic bound
_REF_MIN_SECONDS = 1.0
_REF_MAX_SECONDS = 60.0
_WAV_MIN_RATE = 8000
_WAV_MAX_RATE = 48000
_FRAME_S = 0.08                       # 80 ms uniform PCM chunks (1920 samples @24k)
_QUEUE_MAX_FRAMES = 8192              # 8192 × 3840 B ≈ 31 MB worst-case turn buffer
_TURN_INACTIVITY_S = 120              # DRAIN phase: no chunk progress → wedged
_WATCHDOG_POLL_S = 5
_PUMP_JOIN_TIMEOUT_S = 5
_ERROR_SLICE = 200                    # bounded error bodies, never echo payloads
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

# Batch-shaped GENERATION bound: base + per_char × len(SPEECH text). Defaults
# measured on this rig with llama-server co-resident (see B20_SIDECAR_RUNS.md);
# operator-tunable for slower rigs.
_GEN_BASE_S = float(os.environ.get("QWEN3_GEN_BASE_S", "30"))
_GEN_PER_CHAR_S = float(os.environ.get("QWEN3_GEN_PER_CHAR_S", "0.15"))

# Idle contract (engine-manager reaps on it): every real request marks
# activity; /health polls and the shutdown call itself must not keep an
# idle engine alive.
_last_activity = time.monotonic()


@app.middleware("http")
async def _track_activity(request, call_next):
    # Stamped on arrival; the post-call_next stamp lands at stream START for a
    # StreamingResponse, so /synthesize stamps per chunk as the body streams.
    global _last_activity
    tracked = request.url.path not in ("/health", "/shutdown")
    if tracked:
        _last_activity = time.monotonic()
    response = await call_next(request)
    if tracked:
        _last_activity = time.monotonic()
    return response


_state: dict = {
    "base": None, "design": None, "device": None, "sample_rate": None,
    "ready": False, "speakers": frozenset(),
}

# ONE lock for all generation — held across a whole turn, the blocking batch
# generation AND the chunk drain, so turns can never interleave on the GPU.
_gen_lock = asyncio.Lock()

# Strong references for in-flight per-turn tasks — the loop only weak-refs
# tasks, so an unreferenced watchdog can be garbage-collected before it fires.
_background_tasks: set = set()


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=_MAX_TEXT)
    ref_audio_b64: str | None = Field(None, max_length=_REF_B64_MAX_CHARS)
    ref_path: str | None = Field(None, max_length=256)
    description: str | None = Field(None, max_length=_MAX_DESCRIPTION)
    seed: int | None = Field(None, ge=0, le=_SEED_MAX)
    language: str | None = Field(None, max_length=_MAX_LANGUAGE)
    voice: str | None = Field(None, max_length=256)


class _WavRejected(ValueError):
    """Ref WAV failed sidecar-side re-validation — always a 400 with the cause."""


class _Done:
    """Queue terminal: the turn finished cleanly."""


_DONE = _Done()


class _Error:
    """Queue terminal: generation fault; message carries the cause, never payload bytes."""

    def __init__(self, message: str):
        self.message = message


def _resolve_mode(req: SynthesizeRequest) -> str:
    """Mode branch: clone requires the ref; design carries description + seed, NO ref."""
    has_ref = req.ref_audio_b64 is not None or req.ref_path is not None
    if req.description is not None:
        if has_ref:
            raise HTTPException(status_code=400, detail=(
                "design mode carries a description and NO ref — ref_audio_b64/ref_path "
                "are clone-mode only"))
        if req.seed is None:
            raise HTTPException(status_code=400, detail="design mode requires an integer seed")
        return "design"
    if not has_ref:
        raise HTTPException(status_code=400, detail=(
            "clone mode requires ref_audio_b64 or ref_path (or pass description + seed "
            "for design mode)"))
    return "clone"


def _check_voice_id(voice: str) -> None:
    """Exact-set allowlist against the model's own preset speakers (fail closed)."""
    speakers = _state["speakers"]
    if voice.lower() not in speakers:
        allowed = sorted(speakers) if speakers else (
            "none — the Base clone model serves no preset voices; "
            "clone conditioning rides the ref audio")
        raise HTTPException(status_code=400, detail=(
            f"voice id {voice[:64]!r} is not in this model's exact preset-speaker "
            f"set ({allowed})"))


def _decode_ref_wav(raw: bytes):
    """Stdlib WAV parse + full re-validation — the sidecar is the last code before torch."""
    import numpy as np
    import wave
    if len(raw) > _REF_MAX_WAV_BYTES:
        raise _WavRejected(f"decoded WAV {len(raw)} B exceeds {_REF_MAX_WAV_BYTES} B cap")
    try:
        with wave.open(io.BytesIO(raw)) as w:
            rate, channels, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
            frames = w.readframes(w.getnframes())
    except (wave.Error, EOFError) as e:
        raise _WavRejected(f"not a PCM RIFF/WAVE container: {e}")
    if width != 2:
        raise _WavRejected(f"ref WAV must be 16-bit PCM (got {width * 8}-bit)")
    if channels not in (1, 2):
        raise _WavRejected(f"ref WAV must be mono or stereo (got {channels} channels)")
    if not (_WAV_MIN_RATE <= rate <= _WAV_MAX_RATE):
        raise _WavRejected(f"ref WAV rate {rate} Hz outside {_WAV_MIN_RATE}..{_WAV_MAX_RATE} Hz")
    seconds = len(frames) / 2 / channels / rate
    if seconds < _REF_MIN_SECONDS:
        raise _WavRejected(f"ref audio too short: {seconds:.2f}s < {_REF_MIN_SECONDS:.0f}s")
    if seconds > _REF_MAX_SECONDS:
        raise _WavRejected(f"ref audio exceeds {_REF_MAX_SECONDS:.0f}s cap: {seconds:.2f}s")
    pcm = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels == 2:
        pcm = pcm.reshape(-1, 2).mean(axis=1)
    return np.ascontiguousarray(pcm), rate


def _load_ref(req: SynthesizeRequest):
    """Request ref → validated (ndarray, sr) tuple. Never a string into qwen-tts."""
    if req.ref_audio_b64 is not None:
        try:
            raw = base64.b64decode(req.ref_audio_b64, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(status_code=400, detail="ref_audio_b64 is not valid base64")
        return _decode_ref_wav(raw)
    ref_root = Path(os.environ.get("QWEN3_REF_ROOT", str(DEFAULT_REF_ROOT))).resolve()
    try:
        path = (ref_root / req.ref_path).resolve()
        path.relative_to(ref_root)
    except (ValueError, OSError):
        raise HTTPException(status_code=400, detail=(
            "ref_path escapes the allowlisted ref root — fixed relative filename only"))
    if path.suffix.lower() != ".wav" or not path.is_file():
        raise HTTPException(status_code=400, detail=(
            f"ref_path {req.ref_path[:64]!r} is not an installed .wav under the ref root"))
    return _decode_ref_wav(path.read_bytes())


def _load_model() -> None:  # impure
    for name, d in (("base", BASE_DIR), ("voice-design", DESIGN_DIR)):
        if not (d / "model.safetensors").is_file():
            raise RuntimeError(
                f"Qwen3 {name} weights not found at {d} (need model.safetensors). "
                "Run: uv run voice-engines/_downloader/download.py qwen3")
    import torch
    from qwen_tts import Qwen3TTSModel

    device = "cuda" if torch.cuda.is_available() else "cpu"
    t0 = time.time()
    print(f"[qwen3] loading base + voice-design from {MODEL_ROOT} on {device}",
          file=sys.stderr, flush=True)
    base = Qwen3TTSModel.from_pretrained(str(BASE_DIR), device_map=device, dtype=torch.bfloat16)
    print(f"[qwen3] base ready (+{time.time() - t0:.1f}s); loading voice-design",
          file=sys.stderr, flush=True)
    design = Qwen3TTSModel.from_pretrained(str(DESIGN_DIR), device_map=device, dtype=torch.bfloat16)
    tk_cfg = json.loads((BASE_DIR / "speech_tokenizer" / "config.json").read_text())
    sr = int(tk_cfg["output_sample_rate"])
    speakers = frozenset(base.get_supported_speakers() or ())
    _state.update(base=base, design=design, device=device, sample_rate=sr,
                  ready=True, speakers=speakers)
    print(f"[qwen3] ready in {time.time() - t0:.1f}s — sample_rate={sr} "
          f"preset_speakers={sorted(speakers) or 'none'}", file=sys.stderr, flush=True)


def _queue_put(loop, queue, item, cancel) -> bool:
    """Thread-side bounded enqueue with backpressure; False when the turn cancelled."""
    while not cancel.is_set():
        future = asyncio.run_coroutine_threadsafe(queue.put(item), loop)
        try:
            future.result(timeout=0.5)
            return True
        except concurrent.futures.TimeoutError:
            future.cancel()
    return False


def _pump_turn(mode, text, description, seed, language, ref, queue, cancel, loop) -> None:  # impure
    """Worker-thread batch generation: full audio → uniform 80 ms s16le chunks."""
    import numpy as np
    import torch

    try:
        if seed is not None:
            # Determinism hook: generation is serialized by _gen_lock, so the
            # global RNG state cannot interleave between turns.
            torch.manual_seed(seed)
            if _state["device"] == "cuda":
                torch.cuda.manual_seed_all(seed)
        if mode == "clone":
            model = _state["base"]
            prompt = model.create_voice_clone_prompt(
                ref_audio=[ref], ref_text=None, x_vector_only_mode=True)
            wavs, sr = model.generate_voice_clone(
                text=text, language=language or "English",
                voice_clone_prompt=prompt, non_streaming_mode=False)
        else:
            wavs, sr = _state["design"].generate_voice_design(
                text=text, instruct=description, language=language or "English",
                non_streaming_mode=False)
        if cancel.is_set():
            return
        audio = np.clip(np.concatenate([np.asarray(w, dtype=np.float32) for w in wavs]),
                        -1.0, 1.0)
        pcm = (audio * 32767.0).astype("<i2").tobytes()
        frame_bytes = int(sr * _FRAME_S) * 2
        for off in range(0, len(pcm), frame_bytes):
            if not _queue_put(loop, queue, pcm[off:off + frame_bytes], cancel):
                return
        terminal = _DONE
    except Exception as e:
        terminal = _Error(f"{type(e).__name__}: {e}"[:_ERROR_SLICE])
    _queue_put(loop, queue, terminal, cancel)


async def _drain_pump(pump) -> None:
    """Bounded wait for the worker thread after end/cancel; loud, never raises.

    A wedged batch generation cannot be thread-killed: on join timeout the
    lock is released anyway and the abandoned worker's late frames drop on the
    cancel flag. This is the batch-shaped answer to the saga's drain.
    """
    try:
        await asyncio.wait_for(asyncio.shield(pump), timeout=_PUMP_JOIN_TIMEOUT_S)
    except asyncio.TimeoutError:
        print(f"[qwen3] ERROR: generation worker did not join within "
              f"{_PUMP_JOIN_TIMEOUT_S}s — abandoning wedged worker, releasing lock",
              file=sys.stderr, flush=True)
    except Exception as e:
        print(f"[qwen3] worker raised outside capture: {e}", file=sys.stderr, flush=True)


@app.on_event("startup")
async def _startup() -> None:
    try:
        _load_model()
    except Exception as e:
        print(f"[qwen3] FATAL: {e}", file=sys.stderr, flush=True)


@app.get("/health")
async def health() -> JSONResponse:
    busy = _gen_lock.locked()
    return JSONResponse({
        "ok": _state["ready"],
        "model": _MODEL_LABEL,
        "device": _state["device"],
        "sample_rate": _state["sample_rate"],
        # IN-FLIGHT truth: idle held at 0 while a turn runs, so the reaper can
        # never kill the sidecar mid-generation (threat model item 5c).
        "idle_seconds": 0 if busy else round(time.monotonic() - _last_activity, 1),
        "busy": busy,
    })


@app.post("/shutdown")
async def shutdown() -> JSONResponse:
    # Unauthenticated by design: loopback-only bind (see __main__). A real
    # request racing in after the reaper's idle check aborts the exit.
    def _exit_if_still_idle() -> None:
        if _gen_lock.locked() or time.monotonic() - _last_activity < 0.5:
            return
        os._exit(0)
    asyncio.get_running_loop().call_later(0.3, _exit_if_still_idle)
    return JSONResponse({"ok": True, "shutting_down": True})


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest) -> StreamingResponse:
    if not _state["ready"]:
        raise HTTPException(status_code=503, detail="model not loaded")
    mode = _resolve_mode(req)
    if req.voice is not None:
        _check_voice_id(req.voice)
    try:
        ref = _load_ref(req) if mode == "clone" else None
    except _WavRejected as e:
        raise HTTPException(status_code=400, detail=str(e))
    print(f"[qwen3] turn start mode={mode} text_chars={len(req.text)} "
          f"hasRef={ref is not None} hasSeed={req.seed is not None}",
          file=sys.stderr, flush=True)

    # The lock spans the whole turn — generation AND drain (S-7 analog).
    await _gen_lock.acquire()
    queue: asyncio.Queue = asyncio.Queue(maxsize=_QUEUE_MAX_FRAMES)
    cancel = threading.Event()
    loop = asyncio.get_running_loop()
    pump = loop.run_in_executor(
        None, _pump_turn, mode, req.text, req.description, req.seed,
        req.language, ref, queue, cancel, loop)

    # Turn teardown funnels through `turn_done` into ONE supervisor task.
    # Witnessed 2026-07-19 on kyutai: awaiting the drain inside the response
    # generator's finally is illegal under GeneratorExit — one cut client
    # bricked the sidecar. The generator's finally here is SYNCHRONOUS-ONLY;
    # the supervisor (a plain task, where awaiting is always legal) alone
    # owns cancel/drain/release.
    turn_done = asyncio.Event()
    last_progress = time.monotonic()
    # GENERATION-phase deadline from the SPEECH text length, never the
    # description: generation time tracks output audio length (item 5a).
    gen_deadline = last_progress + _GEN_BASE_S + _GEN_PER_CHAR_S * len(req.text)

    async def _watchdog() -> None:
        # BATCH-shaped trips: (a) GENERATION phase (no chunk yet) — the
        # blocking generate call is bounded by the length-scaled deadline;
        # (b) DRAIN phase — INACTIVITY cap, not a total-turn cap: a healthy
        # slow drain stamps progress per chunk and never trips this.
        generated = False
        while True:
            try:
                await asyncio.wait_for(turn_done.wait(), timeout=_WATCHDOG_POLL_S)
                return  # turn ended normally — disarmed
            except asyncio.TimeoutError:
                now = time.monotonic()
                if not generated and queue.empty() and now >= gen_deadline:
                    print(f"[qwen3] ERROR: generation exceeded length-scaled deadline "
                          f"({gen_deadline - last_progress:.0f}s for {len(req.text)} chars) "
                          "— wedged, forcing release", file=sys.stderr, flush=True)
                    turn_done.set()
                elif not queue.empty():
                    generated = True
                if generated and now - last_progress >= _TURN_INACTIVITY_S:
                    print(f"[qwen3] ERROR: drain inactive for {_TURN_INACTIVITY_S}s "
                          "— forcing release", file=sys.stderr, flush=True)
                    turn_done.set()

    async def _supervise() -> None:
        await turn_done.wait()
        watchdog.cancel()
        cancel.set()
        await _drain_pump(pump)
        if _gen_lock.locked():
            _gen_lock.release()

    watchdog = asyncio.create_task(_watchdog())
    supervisor = asyncio.create_task(_supervise())
    for _t in (watchdog, supervisor):
        _background_tasks.add(_t)
        _t.add_done_callback(_background_tasks.discard)

    async def _await_chunk():
        # Poll-bounded wait so a watchdog-tripped turn always wakes this path.
        while True:
            try:
                return await asyncio.wait_for(queue.get(), timeout=_WATCHDOG_POLL_S)
            except asyncio.TimeoutError:
                if turn_done.is_set():
                    raise HTTPException(status_code=500, detail=(
                        "turn terminated by the batch watchdog (wedged generation "
                        "or stalled drain)"))

    try:
        first = await _await_chunk()
        if isinstance(first, _Error):
            raise HTTPException(status_code=500, detail=first.message)
    except BaseException:
        # Any pre-response exit — generation error, watchdog trip, or a
        # disconnect cancelling this await. The handler coroutine may legally
        # await here, so the error path returns only after the lock is free.
        turn_done.set()
        await supervisor
        raise

    async def frames():
        global _last_activity
        nonlocal last_progress
        item = first
        try:
            while item is not _DONE:
                if isinstance(item, _Error):
                    # Mid-stream: the 200 is already committed — log the cause
                    # and terminate the body (bounded, never echoes payload).
                    print(f"[qwen3] mid-stream generation error: {item.message}",
                          file=sys.stderr, flush=True)
                    break
                # Per-chunk stamps: idle_seconds stays truthful THROUGH a long
                # drain, and the drain-phase inactivity watchdog sees progress.
                _last_activity = time.monotonic()
                last_progress = time.monotonic()
                yield item
                item = await _await_chunk()
        finally:
            # SYNCHRONOUS ONLY — awaiting inside a generator closed by the
            # server is illegal under GeneratorExit (see the turn comment).
            _last_activity = time.monotonic()
            turn_done.set()

    return StreamingResponse(
        frames(),
        media_type="audio/raw",
        headers={
            "X-Audio-Format": "pcm_s16le",
            "X-Audio-Sample-Rate": str(_state["sample_rate"]),
            "X-Audio-Channels": "1",
            "Cache-Control": "no-store",
        },
    )


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("QWEN3_HOST", "127.0.0.1")
    port = int(os.environ.get("QWEN3_PORT", "7867"))
    if host not in _LOOPBACK_HOSTS:
        # An unauthenticated /synthesize on a non-loopback address is a
        # LAN-facing voice-cloning service. Refuse, don't warn (guard 9).
        print(f"[qwen3] FATAL: refusing non-loopback bind QWEN3_HOST={host!r}",
              file=sys.stderr, flush=True)
        raise SystemExit(2)
    uvicorn.run(app, host=host, port=port, log_level="info")
