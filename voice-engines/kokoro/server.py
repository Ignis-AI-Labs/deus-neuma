"""Kokoro-82M TTS sidecar — local HTTP server.

Lightweight CPU-or-GPU engine with preset voice packs (no cloning). Each
voice is a small .pt file under voices/. Voice names follow a convention:
first letter = language (a=en, b=bit, j=japanese, e=spanish, f=french, h=hindi,
i=italian, p=portuguese, z=mandarin); second letter = gender (f/m).

Endpoints:
    GET  /health      → { ok, voices: [...], sample_rate, device }
    GET  /voices      → [voice_id, ...]
    POST /synthesize  → streamed raw PCM
        body: { text, voice, speed? }
        resp headers: X-Audio-Format, X-Audio-Sample-Rate, X-Audio-Channels
        resp body: chunked raw PCM bytes (f32le mono, 24kHz)

Reference: https://huggingface.co/hexgrad/Kokoro-82M
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
from pathlib import Path

# Kokoro's KPipeline resolves weights via HF Hub cache. Point HF_HOME at our
# local cache so it finds the downloaded model + voice packs without re-fetching.
REPO_ROOT = Path(__file__).resolve().parent.parent
HF_CACHE = REPO_ROOT / "_models" / "_hf_cache"
MODEL_DIR = REPO_ROOT / "_models" / "kokoro"
VOICES_PATH = MODEL_DIR / "voices"
os.environ.setdefault("HF_HOME", str(HF_CACHE))
os.environ.setdefault("HF_HUB_CACHE", str(HF_CACHE))
os.environ.setdefault("HF_HUB_OFFLINE", "1")

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Kokoro Sidecar", version="0.1.0")

# Idle contract (engine-manager reaps on it): every real request marks
# activity; /health polls and the shutdown call itself must not keep an
# idle engine alive.
_last_activity = time.monotonic()


@app.middleware("http")
async def _track_activity(request, call_next):
    # Marked on arrival AND completion: idle counts from the end of the last
    # real request, so a long synthesis can never be mistaken for idleness.
    global _last_activity
    tracked = request.url.path not in ("/health", "/shutdown")
    if tracked:
        _last_activity = time.monotonic()
    response = await call_next(request)
    if tracked:
        _last_activity = time.monotonic()
    return response

_state: dict = {
    "pipeline": None, "voices": [], "sample_rate": 24000, "device": None, "ready": False,
}


def _load_voices() -> list[str]:
    if not VOICES_PATH.exists():
        return []
    return sorted(p.stem for p in VOICES_PATH.glob("*.pt"))


def _resolve_device() -> str:
    """Same accelerator ladder every other sidecar walks (zonos/parler/kyutai).

    KModel is constructed on CPU and stays there unless moved, so without this
    Kokoro ran its whole forward pass on the CPU — measured RTF 2.17 against
    0.004 on this rig's CUDA device, ~590x slower and far past the point where
    a spoken turn can keep up with a conversation. KOKORO_DEVICE overrides for
    an operator who wants the CPU path back (a box whose GPU is spoken for).
    """
    import torch

    forced = os.environ.get("KOKORO_DEVICE")
    if forced:
        return forced
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _load_pipeline() -> None:
    if not MODEL_DIR.exists() or not (MODEL_DIR / "kokoro-v1_0.pth").exists():
        raise RuntimeError(
            f"Kokoro weights not found at {MODEL_DIR}. "
            "Run: uv run voice-engines/_downloader/download.py kokoro"
        )
    import torch
    from kokoro import KPipeline, KModel

    config_path = str(MODEL_DIR / "config.json")
    weights_path = str(MODEL_DIR / "kokoro-v1_0.pth")
    device = _resolve_device()
    print(f"[kokoro] loading model from {weights_path} on {device}", file=sys.stderr, flush=True)
    t0 = time.time()
    model = KModel(config=config_path, model=weights_path)
    if device != "cpu":
        # An accelerator that fails to take the model is a degraded rig, not a
        # dead engine — fall back to CPU and SAY SO, so /health never claims a
        # device the forward pass is not actually running on.
        try:
            model = model.to(device)
        except Exception as e:
            print(f"[kokoro] {device} unavailable ({e}) — falling back to cpu",
                  file=sys.stderr, flush=True)
            device = "cpu"
    model = model.eval()
    pipeline = KPipeline(model=model, lang_code='a', device=device)

    # Preload every voice pack from our local voices/ dir into the pipeline's
    # voice cache, keyed by short name ('af_heart') so per-request lookups
    # bypass HF Hub. Callers can still pass full paths if they want.
    voices = _load_voices()
    for v in voices:
        try:
            pipeline.voices[v] = torch.load(str(VOICES_PATH / f"{v}.pt"), weights_only=True)
        except Exception as e:
            print(f"[kokoro] could not preload voice {v}: {e}", file=sys.stderr, flush=True)

    _state.update(pipeline=pipeline, voices=voices, device=device, ready=True)
    print(f"[kokoro] ready in {time.time()-t0:.1f}s — {len(voices)} voices on {device}",
          file=sys.stderr, flush=True)


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    voice: str = "af_heart"
    speed: float | None = Field(None, ge=0.5, le=2.0)


def _lang_for_voice(voice: str) -> str:
    """Kokoro voice names encode language in the first letter."""
    if not voice:
        return "a"
    return voice[0].lower()


# Below this the sample is silence for our purposes. Measured 2026-08-01: the
# head region of a Kokoro take peaks at 9.94e-5 (-80 dBFS), so -60 dBFS clears
# it comfortably without ever reaching into speech.
_SILENCE_FLOOR = 1e-3
# Asymmetric on purpose. Leading silence is pure latency — the witness waits
# through it before hearing a word — so only enough is kept to protect the
# onset transient from clicking. Trailing silence is the seam between this
# sentence and the next, so enough is kept for the being to breathe: takes
# played back to back with both ends shaved flat run together and sound
# hurried. 150 ms sits just under the ~320 ms Kokoro leaves between sentences
# inside a single request, which reads as speech rather than as a stall.
_HEAD_GUARD_MS = 10
_TAIL_GUARD_MS = 150


def _trim_edge_silence(audio, sample_rate: int):
    """Strip the engine's own leading/trailing silence from a take.

    THE STAMMER (Design note, 2026-08-01: […]). Kokoro pads EVERY
    request with roughly 400 ms of silence at the head and 550 ms at the tail.
    A reply is spoken as a sequence of sentence requests played back to back,
    so each seam inherited both — measured ~950 ms of dead air per seam, and
    4.9 s of silence inside a 16.3 s reply (30% of it). The same words in a
    single request carry natural inter-sentence pauses of ~320 ms, so this is
    per-request padding, not prosody, and removing it restores the engine's own
    phrasing rather than inventing a new one.

    Pure over the tensor: same samples, fewer of them, nothing synthesized.
    """
    import torch

    if audio.numel() == 0:
        return audio
    loud = (audio.abs() > _SILENCE_FLOOR).nonzero()
    if loud.numel() == 0:
        return audio          # a take that is silence all through is left alone
    head = int((_HEAD_GUARD_MS / 1000.0) * sample_rate)
    tail = int((_TAIL_GUARD_MS / 1000.0) * sample_rate)
    first = max(0, int(loud[0]) - head)
    last = min(audio.numel(), int(loud[-1]) + 1 + tail)
    return audio[first:last]


def _generate_pcm(req: SynthesizeRequest) -> tuple[bytes, int]:
    """Generate audio, returning (pcm_f32le_bytes, sample_rate)."""
    import torch

    pipeline = _state["pipeline"]
    voice = req.voice if req.voice in _state["voices"] else "af_heart"

    speed = req.speed if req.speed is not None else 1.0
    audio_chunks = []
    sample_rate = 24000
    for result in pipeline(req.text, voice=voice, speed=speed):
        if result.audio is None:
            continue
        audio_chunks.append(torch.as_tensor(result.audio))
        sample_rate = getattr(result, "sample_rate", 24000) or sample_rate

    if not audio_chunks:
        raise HTTPException(status_code=500, detail="kokoro produced no audio")

    # .cpu() before .numpy(): on an accelerator the pipeline may hand back
    # device tensors, and numpy() on one raises rather than converting.
    audio = torch.cat(audio_chunks).clamp(-1.0, 1.0).detach().cpu()
    audio = _trim_edge_silence(audio, sample_rate)
    pcm = (audio.numpy().astype("float32")).tobytes()
    return pcm, int(sample_rate)


@app.on_event("startup")
async def _startup() -> None:
    try:
        _load_pipeline()
    except Exception as e:
        print(f"[kokoro] FATAL: {e}", file=sys.stderr, flush=True)


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({
        "ok": _state["ready"],
        "voices": _state["voices"],
        "sample_rate": _state["sample_rate"],
        "device": _state["device"],
        "idle_seconds": round(time.monotonic() - _last_activity, 1),
    })


@app.post("/shutdown")
async def shutdown() -> JSONResponse:
    # The engine manager reaps idle sidecars to free VRAM; the exit lands
    # after the response flushes so the caller sees the acknowledgement.
    # Unauthenticated by design: the sidecar binds loopback-only, so only
    # local processes can reach this. Never expose *_HOST beyond 127.0.0.1
    # without adding an auth gate here.
    def _exit_if_still_idle() -> None:
        # A real request that raced in after the reaper's idle check aborts
        # the exit — the reap becomes a no-op instead of a truncated stream.
        if time.monotonic() - _last_activity < 0.5:
            return
        os._exit(0)
    asyncio.get_running_loop().call_later(0.3, _exit_if_still_idle)
    return JSONResponse({"ok": True, "shutting_down": True})


@app.get("/voices")
async def voices() -> JSONResponse:
    return JSONResponse({"voices": _state["voices"]})


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest) -> StreamingResponse:
    if not _state["ready"]:
        raise HTTPException(status_code=503, detail="model not loaded")

    try:
        pcm, sr = _generate_pcm(req)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    chunk_size = 8192

    async def chunker():
        view = memoryview(pcm)
        for i in range(0, len(view), chunk_size):
            yield bytes(view[i:i + chunk_size])

    return StreamingResponse(
        chunker(),
        media_type="audio/raw",
        headers={
            "X-Audio-Format": "pcm_f32le",
            "X-Audio-Sample-Rate": str(sr),
            "X-Audio-Channels": "1",
            "Cache-Control": "no-store",
        },
    )


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("KOKORO_HOST", "127.0.0.1")
    port = int(os.environ.get("KOKORO_PORT", "7861"))
    uvicorn.run(app, host=host, port=port, log_level="info")
