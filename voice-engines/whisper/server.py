"""Whisper STT sidecar — local HTTP server + live PCM streaming lane.

The one speech-to-text engine in the manifest (every sibling sidecar speaks).
The models it serves load FROM DISK AT STARTUP — never from the
network at first use (WP6, 2026-10-01: the live lane used to load its model by
name and its VAD through torch.hub at the first /stream connect; both reach
for the internet, and on a machine where Python HTTP to the Hub hangs the
sitting hung with them — /stream accepted, no speech frame ever came back, and
shutdown stuck […]).

* POST /transcribe — the forge's words and the dictation fallback: the live
  model (Nemotron) whenever it serves /stream — ONE model on the GPU, never two.
  WHISPER_TRANSCRIBE=whisper (or the base lane) loads the "transcribe" model,
  Whisper large-v3, instead (GPU fp16 when there is one, else CPU int8).
* WS /stream — the live sitting and hold-to-talk dictation: NVIDIA Nemotron
  Speech Streaming (the "live" files in engines.json, nemotron_lane.py) on the
  GPU when it has 2 GB free, else the CPU (NEMOTRON_DEVICE=cpu|cuda forces;
  WHISPER_FORCE_CPU=1 keeps it off the GPU), Silero VAD from the local ONNX
  (stream_vad.py). WHISPER_STREAM_ENGINE=base falls back to the "stream" whisper
  model (stream_lane.py, CPU int8). Override the whisper models with
  WHISPER_MODEL_DIR / WHISPER_STREAM_MODEL_DIR (a local CTranslate2 export,
  never a model name).

Every pinned file is checked at startup (model_files.py). A missing one makes
/health say so — {ok:false, phase:"failed", error:[…]} —
and the engine manager stops waiting, instead of a sitting that never answers.
HF_HUB_OFFLINE is forced: nothing in this process may touch the network.

Endpoints:
    GET  /health      → { ok, phase: loading|ready|failed, error?, model, streamModel, streamDevice, device, idle_seconds }
    POST /transcribe  → { text, language, durationSeconds }  (body: any ffmpeg-readable audio)
    POST /shutdown    → exits once idle
    WS   /stream      → 16 kHz s16le mono PCM in (binary, or JSON {"pcm": "<b64>"}); control
        frames flush / reset / hold_on / hold_off; out: ready, speech_started, speech_stopped,
        partial {text}, utterance {text}, reset_done (strictly after every pre-reset output).
        ONE client at a time (a second is closed with 1013): the pump thread IS the decode
        semaphore (threat-model control #3). PCM is never logged or written to disk.

Reference: https://github.com/SYSTRAN/faster-whisper
           https://github.com/ufal/whisper_streaming (whisper_online.py, MIT)
"""

from __future__ import annotations

import os

# Before any Hugging Face import reads them: this process never downloads.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

import asyncio  # noqa: E402
import base64  # noqa: E402
import ctypes  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import queue  # noqa: E402
import sys  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
from pathlib import Path  # noqa: E402

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

import model_files  # noqa: E402
import stream_lane  # noqa: E402

app = FastAPI(title="Whisper Sidecar", version="0.2.0")

STREAM_MIN_SILENCE_MS = int(os.environ.get("WHISPER_STREAM_MIN_SILENCE_MS", "400"))
STREAM_CADENCE_S = float(os.environ.get("WHISPER_STREAM_CADENCE_S", "0.3"))
STREAM_CPU_THREADS = int(os.environ.get("WHISPER_STREAM_CPU_THREADS", "16"))
_PCM_QUEUE_MAX = 256      # WS messages buffered ahead of decode before flood

# Idle contract (engine-manager reaps on it): every real request marks activity;
# /health polls and the shutdown call itself must not keep an idle engine alive.
_last_activity = time.monotonic()

_state: dict = {
    "phase": "loading", "error": None,
    "model": None, "label": None, "device": None,
    "stream_proc": None, "stream_label": None, "stream_kind": None, "stream_device": None,
}
_loaded = threading.Event()   # set once loading ended, either way

# One /stream client, ever (threat-model control #3).
_stream_slot = threading.Lock()


@app.middleware("http")
async def _track_activity(request, call_next):
    # Marked on arrival AND completion: idle counts from the end of the last real request.
    global _last_activity
    tracked = request.url.path not in ("/health", "/shutdown")
    if tracked:
        _last_activity = time.monotonic()
    response = await call_next(request)
    if tracked:
        _last_activity = time.monotonic()
    return response


def _log(msg: str) -> None:
    print(f"[whisper] {msg}", file=sys.stderr, flush=True)


# CTranslate2's CUDA path dlopens cuBLAS/cuDNN at inference time. The system linker
# cannot see the pip-packaged copies in this venv, so preload them with RTLD_GLOBAL.
def _preload_cuda_libs() -> bool:
    try:
        import nvidia.cublas.lib
        import nvidia.cudnn.lib

        for pkg in (nvidia.cublas.lib, nvidia.cudnn.lib):   # namespace packages: __path__ only
            lib_dir = Path(next(iter(pkg.__path__)))
            for so in sorted(lib_dir.glob("*.so*")):
                ctypes.CDLL(str(so), mode=ctypes.RTLD_GLOBAL)
        return True
    except Exception as e:
        _log(f"CUDA libs unavailable ({e}) — will fall back to CPU")
        return False


def _load_transcribe_model() -> None:
    from faster_whisper import WhisperModel

    directory, label = model_files.resolve("transcribe", "WHISPER_MODEL_DIR")
    # WHISPER_FORCE_CPU=1 skips the CUDA attempt entirely — the test lanes (and any
    # GPU-less box) set it so boot can never touch the GPU.
    attempts = (
        [] if os.environ.get("WHISPER_FORCE_CPU") == "1"
        else ([("cuda", "float16")] if _preload_cuda_libs() else [])
    ) + [("cpu", "int8")]
    last_err: Exception | None = None
    for device, compute_type in attempts:
        try:
            t0 = time.time()
            # num_workers=2: a release's FINAL decode runs beside a still-running
            # preview instead of queueing behind it (one worker serialized them).
            model = WhisperModel(str(directory), device=device, compute_type=compute_type, num_workers=2)
            _state.update(model=model, label=label, device=device)
            _log(f"transcribe model {label} ready in {time.time()-t0:.1f}s on {device} ({compute_type})")
            return
        except Exception as e:
            last_err = e
            _log(f"{device} load failed: {e}")
    raise RuntimeError(f"no device could load the transcribe model: {last_err}")


# The live lane takes the GPU only when there is room for it: fp16 weights are ~1.2 GB,
# and the being's model shares the card — under this much free it stays on the CPU.
LIVE_GPU_MIN_FREE = 2 * 1024**3


def _live_device() -> str:
    """NEMOTRON_DEVICE=cpu|cuda forces; auto (default) = the GPU when present and roomy."""
    want = os.environ.get("NEMOTRON_DEVICE", "auto")
    if want in ("cpu", "cuda"):
        return want
    if os.environ.get("WHISPER_FORCE_CPU") == "1":
        return "cpu"
    try:
        import torch

        if not torch.cuda.is_available():
            return "cpu"
        free, _total = torch.cuda.mem_get_info()
        if free < LIVE_GPU_MIN_FREE:
            _log(f"live lane stays on cpu: {free / 1024**3:.1f} GB free on the GPU")
            return "cpu"
        return "cuda"
    except Exception as e:
        _log(f"live lane stays on cpu: {e}")
        return "cpu"


def _load_stream_lane() -> None:
    t0 = time.time()
    # Nemotron streams the live lane whenever the manifest pins it (2026-10-07); the base
    # whisper lane stays for WHISPER_STREAM_ENGINE=base or a manifest without it.
    live = any(f.get("use") == "live" for f in model_files.pinned_files())
    if live and os.environ.get("WHISPER_STREAM_ENGINE") != "base":
        import nemotron_lane

        directory, label = model_files.resolve("live", "NEMOTRON_MODEL_DIR")
        device = _live_device()
        model = nemotron_lane.Model(str(directory), device, STREAM_CPU_THREADS)
        _state.update(stream_proc=model, stream_label=label, stream_kind="nemotron", stream_device=device)
        _log(f"stream model {label} + Silero VAD ready in {time.time()-t0:.1f}s on {device}")
        return
    directory, label = model_files.resolve("stream", "WHISPER_STREAM_MODEL_DIR")
    proc = stream_lane.build_processor(
        directory, STREAM_CPU_THREADS, STREAM_CADENCE_S, STREAM_MIN_SILENCE_MS,
    )
    _state.update(stream_proc=proc, stream_label=label, stream_kind="whisper", stream_device="cpu")
    _log(f"stream model {label} + Silero VAD ready in {time.time()-t0:.1f}s on cpu (int8)")


def _load_all() -> None:
    try:
        _load_stream_lane()
        # ONE MODEL (Design note, 2026-10-09: […]). With Nemotron live, it serves /transcribe
        # too and large-v3 is never loaded; WHISPER_TRANSCRIBE=whisper brings it back
        # (other languages — Nemotron is English only).
        if _state["stream_kind"] == "nemotron" and os.environ.get("WHISPER_TRANSCRIBE") != "whisper":
            _state.update(label=_state["stream_label"], device=_state["stream_device"])
        else:
            _load_transcribe_model()
        _state["phase"] = "ready"
    except Exception as e:
        _state.update(phase="failed", error=str(e)[:500])
        _log(f"FATAL: {e}")
        # Stay long enough for the manager to read the reason off /health, then go:
        # a failed sidecar must never linger holding its port (or RAM) as an orphan.
        linger = float(os.environ.get("WHISPER_FAILED_LINGER_S", "30"))
        timer = threading.Timer(linger, lambda: os._exit(1))
        timer.daemon = True
        timer.start()
    finally:
        _loaded.set()


@app.on_event("startup")
async def _startup() -> None:
    # A daemon thread: /health answers "loading" meanwhile, and a stuck load can
    # never hold the process open at exit.
    threading.Thread(target=_load_all, name="whisper-load", daemon=True).start()


@app.get("/health")
async def health() -> JSONResponse:
    body = {
        "ok": _state["phase"] == "ready",
        "phase": _state["phase"],
        "model": _state["label"],
        "streamModel": _state["stream_label"],
        "streamDevice": _state["stream_device"],
        "device": _state["device"],
        "idle_seconds": round(time.monotonic() - _last_activity, 1),
    }
    if _state["error"]:
        body["error"] = _state["error"]
    return JSONResponse(body)


@app.post("/shutdown")
async def shutdown() -> JSONResponse:
    # The exit lands after the response flushes. Unauthenticated by design: the
    # sidecar binds loopback-only (see __main__) — never expose it beyond 127.0.0.1
    # without adding an auth gate here.
    def _exit_if_still_idle() -> None:
        # A real request that raced in after the reaper's idle check aborts the exit.
        if time.monotonic() - _last_activity < 0.5:
            return
        os._exit(0)
    asyncio.get_running_loop().call_later(0.3, _exit_if_still_idle)
    return JSONResponse({"ok": True, "shutting_down": True})


@app.post("/transcribe")
async def transcribe(request: Request) -> JSONResponse:
    if _state["phase"] != "ready":
        raise HTTPException(status_code=503, detail=_state["error"] or "model not loaded")
    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio body")

    # DECODE BIAS (?hotwords=): the caller's domain vocabulary (core/text/lexicon.js)
    # folded into the decoder prompt, so "neuma" is heard rather than repaired.
    # Bounded: an unbounded string would displace the audio's own context.
    hotwords = (request.query_params.get("hotwords") or "").strip()[:1000] or None
    # ?preview=1 — a live read while the key is still held: greedy decode, so the
    # words keep pace with the voice. The release's final pass keeps the beam.
    preview = request.query_params.get("preview") == "1"

    try:
        if _state["model"] is None:   # Nemotron serves both lanes (no hotword prompt there)
            text, seconds = await asyncio.to_thread(_live_decode, audio)
            return JSONResponse({"text": text, "language": "en", "durationSeconds": round(seconds, 2)})
        text, info = await asyncio.to_thread(_dictation_decode, io.BytesIO(audio), hotwords, preview)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"transcription failed: {e}")
    return JSONResponse({
        "text": text, "language": info.language, "durationSeconds": round(info.duration, 2),
    })


def _live_decode(audio: bytes) -> tuple[str, float]:
    """A whole recording through the live model — read once, as fast as it decodes."""
    import nemotron_lane
    from faster_whisper.audio import decode_audio   # PyAV: any container the desk sends

    samples = decode_audio(io.BytesIO(audio), sampling_rate=16000)
    utterance = nemotron_lane.Utterance(_state["stream_proc"], lambda _text: None)
    utterance.push(samples)
    return utterance.finish(), len(samples) / 16000


def _dictation_decode(audio, hotwords: str | None = None, preview: bool = False) -> tuple[str, object]:
    """The transcribe model's decode (POST /transcribe)."""
    segments, info = _state["model"].transcribe(
        audio,
        # Gentler VAD than the library default: a long dictation's quiet ending
        # was being cut out entirely (Design note, 2026-08-28.
        vad_filter=True,
        vad_parameters={"threshold": 0.35, "speech_pad_ms": 800},
        beam_size=1 if preview else 5,
        hotwords=hotwords,
        # Conditioning on previous text gets long audio […]
        # (faster-whisper's docstring) — whole stretches silently skipped.
        condition_on_previous_text=False,
    )
    # segments is lazy — drain it here, in the calling worker thread.
    return " ".join(s.text.strip() for s in segments).strip(), info


async def _stream_ready(timeout_s: float = 300.0) -> bool:
    """Wait (without a thread) for the startup load to finish; True when the lane is up."""
    deadline = time.monotonic() + timeout_s
    while not _loaded.is_set() and time.monotonic() < deadline:
        await asyncio.sleep(0.1)
    return _state["stream_proc"] is not None


@app.websocket("/stream")
async def stream_ws(websocket: WebSocket):
    global _last_activity
    if not _stream_slot.acquire(blocking=False):
        await websocket.accept()
        await websocket.close(code=1013, reason="one /stream client at a time")
        return
    frames_q: queue.Queue = queue.Queue(maxsize=_PCM_QUEUE_MAX)
    stop_flag = threading.Event()
    loop = asyncio.get_running_loop()
    pump = None

    def emit(event: dict) -> None:
        # Text and event kinds only — PCM never crosses this boundary.
        asyncio.run_coroutine_threadsafe(websocket.send_text(json.dumps(event)), loop)

    try:
        await websocket.accept()
        if not await _stream_ready():
            await websocket.send_text(json.dumps({
                "type": "error", "code": "stream_model_unavailable",
                "message": (_state["error"] or "stream model still loading")[:200],
            }))
            await websocket.close(code=1011)
            return
        if _state["stream_kind"] == "nemotron":
            import nemotron_lane

            target = nemotron_lane.stream_pump
            args = (_state["stream_proc"], STREAM_MIN_SILENCE_MS, frames_q, emit, stop_flag)
        else:
            target = stream_lane.stream_pump
            args = (_state["stream_proc"], frames_q, emit, stop_flag, STREAM_CADENCE_S)
        pump = threading.Thread(target=target, args=args, name="whisper-stream-pump", daemon=True)
        pump.start()
        await websocket.send_text(json.dumps({
            "type": "ready", "model": _state["stream_label"], "minSilenceMs": STREAM_MIN_SILENCE_MS,
        }))
        while True:
            msg = await websocket.receive()
            _last_activity = time.monotonic()  # a live sitting is never idle
            if msg["type"] == "websocket.disconnect":
                break
            data = msg.get("bytes")
            if data is None and msg.get("text") is not None:
                try:
                    ctrl = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue
                if not isinstance(ctrl, dict):
                    continue
                kind = ctrl.get("type")
                if kind in stream_lane.CONTROL_FRAMES:
                    # Through the SAME FIFO as the PCM: a control frame never overtakes audio.
                    frames_q.put(stream_lane.CONTROL_FRAMES[kind])
                    continue
                pcm_b64 = ctrl.get("pcm")
                if isinstance(pcm_b64, str):
                    try:
                        data = base64.b64decode(pcm_b64)
                    except ValueError:
                        continue
            if data:
                try:
                    frames_q.put_nowait(data)
                except queue.Full:
                    await websocket.send_text(json.dumps({
                        "type": "error", "code": "flood",
                        "message": "PCM arrived faster than realtime decode",
                    }))
                    break
    except WebSocketDisconnect:
        pass
    finally:
        stop_flag.set()
        if pump is not None:
            # Off the event loop: a decode in flight must not stall every other request.
            await asyncio.to_thread(pump.join, 5)
        _stream_slot.release()


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("WHISPER_HOST", "127.0.0.1")
    port = int(os.environ.get("WHISPER_PORT", "7865"))
    # FAIL-CLOSED (threat-model control #2): every sidecar route is unauthenticated —
    # the loopback bind IS the auth boundary, and /stream carries live voice PCM.
    if host not in ("127.0.0.1", "localhost", "::1", "[::1]"):
        _log(f"FATAL: refusing non-loopback bind WHISPER_HOST={host!r} — sidecar routes are unauthenticated")
        sys.exit(2)
    # A bounded graceful shutdown: SIGTERM never waits on an open sitting forever.
    uvicorn.run(app, host=host, port=port, log_level="info", timeout_graceful_shutdown=3)
