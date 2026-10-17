"""Parler TTS Mini sidecar — local HTTP server.

Text-described voice design: synthesize a voice from a prose description like
'a warm female speaker with a slight British accent and clear delivery'.
Apache-2.0. The 'design from scratch' path for the Voice Forge ceremony.

Deterministic generation via seed: same description + seed → same voice. The
seed is what gets sealed into Voice DNA when a witness chooses a designed
voice, so the voice can be re-generated exactly on any machine.

Endpoints:
    GET  /health      → { ok, model, device, sample_rate }
    POST /synthesize  → streamed raw PCM
        body: { text, description, seed?, language? }
        resp headers: X-Audio-Format, X-Audio-Sample-Rate, X-Audio-Channels
        resp body: chunked raw PCM bytes (s16le mono, ~44.1kHz)

Reference: https://github.com/huggingface/parler-tts
"""

from __future__ import annotations

import asyncio
import io
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = REPO_ROOT / "_models" / "parler"

# Point HF_HOME at our local cache so Parler finds weights without re-fetching.
# ParlerTTSForConditionalGeneration.from_pretrained accepts a local path directly.
os.environ.setdefault("HF_HOME", str(REPO_ROOT / "_models" / "_hf_cache"))
os.environ.setdefault("HF_HUB_CACHE", str(REPO_ROOT / "_models" / "_hf_cache"))
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
PARLER_REPO = "parler-tts/parler-tts-mini-v1"

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Parler Sidecar", version="0.1.0")

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
    "model": None,
    "tokenizer": None,
    "device": None,
    "sample_rate": None,
    "ready": False,
}


def _resolve_device() -> str:
    import torch
    if torch.cuda.is_available():
        return "cuda:0"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _load_model() -> None:
    # Prefer local flat-layout weights; fall back to repo id (resolved via HF cache).
    local_path = str(MODEL_DIR) if MODEL_DIR.exists() and any(MODEL_DIR.iterdir()) else PARLER_REPO
    print(f"[parler] loading model from {local_path}", file=sys.stderr, flush=True)
    import torch
    from parler_tts import ParlerTTSForConditionalGeneration
    from transformers import AutoTokenizer

    device = _resolve_device()
    t0 = time.time()
    dtype = torch.float16 if device.startswith("cuda") else torch.float32
    model = ParlerTTSForConditionalGeneration.from_pretrained(local_path, torch_dtype=dtype).to(device)
    model.eval()
    tokenizer = AutoTokenizer.from_pretrained(local_path)
    sr = int(getattr(model.config, "sampling_rate", 44100))
    _state.update(model=model, tokenizer=tokenizer, device=device, sample_rate=sr, ready=True)
    print(f"[parler] ready in {time.time()-t0:.1f}s — sample_rate={sr}, device={device}", file=sys.stderr, flush=True)


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    description: str = Field(
        ...,
        min_length=8,
        description="Prose description of the voice (e.g. 'a warm female speaker with a calm delivery')",
    )
    seed: int | None = Field(None, ge=0, le=2**32 - 1)
    language: str = "en"


def _generate_pcm(req: SynthesizeRequest) -> tuple[bytes, int]:
    """Generate audio, returning (pcm_s16le_bytes, sample_rate)."""
    import torch
    import numpy as np

    model = _state["model"]
    tokenizer = _state["tokenizer"]
    device = _state["device"]

    if req.seed is not None:
        torch.manual_seed(req.seed)

    input_ids = tokenizer(req.description, return_tensors="pt").input_ids.to(device)
    prompt_input_ids = tokenizer(req.text, return_tensors="pt").input_ids.to(device)

    with torch.no_grad():
        generation = model.generate(input_ids=input_ids, prompt_input_ids=prompt_input_ids)

    audio = generation.cpu().numpy().squeeze()
    if audio.ndim != 1:
        audio = audio.reshape(-1)
    audio = np.clip(audio, -1.0, 1.0)
    pcm = (audio * 32767.0).astype(np.int16).tobytes()
    return pcm, int(_state["sample_rate"])


@app.on_event("startup")
async def _startup() -> None:
    try:
        _load_model()
    except Exception as e:
        print(f"[parler] FATAL: {e}", file=sys.stderr, flush=True)


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({
        "ok": _state["ready"],
        "model": "parler-tts-mini-v1",
        "device": _state["device"],
        "sample_rate": _state["sample_rate"],
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
            "X-Audio-Format": "pcm_s16le",
            "X-Audio-Sample-Rate": str(sr),
            "X-Audio-Channels": "1",
            "Cache-Control": "no-store",
        },
    )


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("PARLER_HOST", "127.0.0.1")
    port = int(os.environ.get("PARLER_PORT", "7864"))
    uvicorn.run(app, host=host, port=port, log_level="info")
