"""Zonos v0.1 TTS sidecar — local HTTP server.

Loads the Zonos model once at startup, serves synthesis requests as streamed
raw PCM. The JS adapter (backend/services/voice/providers/zonos.js) reads
the response headers for format metadata.

Endpoints:
    GET  /health      → { ok, model, device, sample_rate, languages }
    POST /synthesize  → streamed raw PCM
        body: { text, language?, emotion?, emotion_intensity?, speed?,
                ref_audio_b64?, ref_text? }
        resp headers: X-Audio-Format, X-Audio-Sample-Rate, X-Audio-Channels
        resp body: chunked raw PCM bytes (s16le mono)

Reference: https://github.com/Zyphra/Zonos
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = REPO_ROOT / "_models" / "zonos"
CONFIG_PATH = MODEL_DIR / "config.json"
WEIGHTS_PATH = MODEL_DIR / "model.safetensors"

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Zonos Sidecar", version="0.1.0")

# Idle contract (engine-manager reaps on it): every real request marks
# activity; /health polls and the shutdown call itself must not keep an
# idle engine alive.
_last_activity = time.monotonic()


sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from browser_guard import assert_loopback_bind, refusal  # noqa: E402  (audit 2026-10-28 M-06)

@app.middleware("http")
async def _track_activity(request, call_next):
    # Marked on arrival AND completion: idle counts from the end of the last
    # real request, so a long synthesis can never be mistaken for idleness.
    why = refusal(request.headers)  # a web page never reaches a sidecar (browser_guard.py)
    if why:
        return JSONResponse({"error": "forbidden", "detail": why}, status_code=403)
    global _last_activity
    tracked = request.url.path not in ("/health", "/shutdown")
    if tracked:
        _last_activity = time.monotonic()
    response = await call_next(request)
    if tracked:
        _last_activity = time.monotonic()
    return response

_state: dict = {"model": None, "device": None, "sample_rate": None, "ready": False}


def _resolve_device() -> str:
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _load_model() -> None:
    if not CONFIG_PATH.exists() or not WEIGHTS_PATH.exists():
        raise RuntimeError(
            f"Zonos weights not found at {MODEL_DIR} "
            f"(need config.json + model.safetensors). "
            "Run: uv run voice-engines/_downloader/download.py zonos"
        )
    import torch
    from zonos.model import Zonos

    device = _resolve_device()
    print(f"[zonos] loading model from {MODEL_DIR} on {device}", file=sys.stderr, flush=True)
    t0 = time.time()
    # from_local already casts to bfloat16; autocast() is not available in this version
    model = Zonos.from_local(str(CONFIG_PATH), str(WEIGHTS_PATH), device=device)
    elapsed = time.time() - t0
    sr = int(model.autoencoder.sampling_rate)
    _state.update(model=model, device=device, sample_rate=sr, ready=True)
    print(f"[zonos] ready in {elapsed:.1f}s — sample_rate={sr}", file=sys.stderr, flush=True)


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    language: str = "en-us"
    emotion: str | None = None
    emotion_intensity: float | None = Field(None, ge=0.0, le=1.0)
    speed: float | None = Field(None, ge=0.5, le=2.0)
    ref_audio_b64: str | None = None
    ref_text: str | None = None


# Zonos emotion vector slots in the order make_cond_dict expects:
#   [Happiness, Sadness, Disgust, Fear, Surprise, Anger, Other, Neutral]
_EMOTION_SLOTS = ['happiness', 'sadness', 'disgust', 'fear', 'surprise', 'anger', 'other', 'neutral']
_NEUTRAL_EMOTION = [0.3077, 0.0256, 0.0256, 0.0256, 0.0256, 0.0256, 0.2564, 0.3077]
# Zonos speaking_rate is in phonemes/min (range ~5-35, 15 = normal).
_BASE_PHONEMES_PER_MIN = 15.0


def _build_emotion_vector(emotion: str | None, intensity: float | None) -> list[float]:
    """Build the 8-element emotion vector make_cond_dict expects."""
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


def _speed_to_phonemes_per_min(speed_multiplier: float | None) -> float:
    """Translate JS-layer speed multiplier (1.0 = normal) to Zonos phonemes/min."""
    if speed_multiplier is None:
        return _BASE_PHONEMES_PER_MIN
    mult = max(0.5, min(2.5, float(speed_multiplier)))
    return max(5.0, min(35.0, _BASE_PHONEMES_PER_MIN * mult))


def _load_wav_tensor(raw: bytes):
    """Parse 16-bit PCM WAV via the stdlib — no codec stack.

    torchaudio.load in this venv routes to torchcodec, which is not (and
    should not be) installed here. The app layer normalizes every witness
    seed to plain 16-bit PCM WAV before upload (audio-normalize.js), so a
    stdlib parse is the whole contract. Anything else is a clear 400.
    """
    import wave
    import torch

    with wave.open(io.BytesIO(raw)) as w:
        sr = w.getframerate()
        channels = w.getnchannels()
        width = w.getsampwidth()
        frames = w.readframes(w.getnframes())
    if width != 2:
        raise ValueError(f"seed WAV must be 16-bit PCM (got {width * 8}-bit)")
    data = torch.frombuffer(bytearray(frames), dtype=torch.int16).float() / 32768.0
    return data.view(-1, channels).t().contiguous(), sr  # (channels, samples)


def _ensure_spk_clone_model():
    """Build the speaker-embedding model ourselves, CPU-first.

    Zonos's make_speaker_embedding lazily constructs SpeakerEmbeddingLDA()
    inside a `with torch.device(cuda)` context — and torchaudio's
    MelSpectrogram cannot be constructed there (melscale_fbanks mixes
    context-device tensors with CPU ones), so every clone request died with
    […]. Constructing on CPU and
    moving the finished module sidesteps it without patching vendored code.
    """
    import torch
    from zonos.speaker_cloning import SpeakerEmbeddingLDA

    model = _state["model"]
    if model.spk_clone_model is None:
        m = SpeakerEmbeddingLDA(device="cpu")
        device = _state["device"]
        m.to(device)
        # device attrs are plain strings the forward path uses to move inputs
        # (and to place the lazily-built resampler) — retarget them too.
        m.device = device
        m.model.device = device
        model.spk_clone_model = m


def _make_speaker_embedding(ref_audio_b64: str):
    import torchaudio

    raw = base64.b64decode(ref_audio_b64)
    wav, sr = _load_wav_tensor(raw)
    if sr != 24000:
        # functional.resample is pure tensor math — no decoder backend needed
        wav = torchaudio.functional.resample(wav, sr, 24000)
        sr = 24000
    if wav.dim() == 2 and wav.shape[0] > 1:
        wav = wav.mean(dim=0, keepdim=True)
    _ensure_spk_clone_model()
    # The parsed tensor is born on CPU; the model lives on CUDA and
    # make_speaker_embedding does NOT move its input — mixing devices makes
    # every clone request 400 ([…]).
    wav = wav.to(_state["device"])
    return _state["model"].make_speaker_embedding(wav, sr)


def _generate_pcm(req: SynthesizeRequest) -> tuple[bytes, int]:
    """Generate audio for a request, returning (pcm_s16le_bytes, sample_rate)."""
    import torch
    from zonos.conditioning import make_cond_dict

    model = _state["model"]
    device = _state["device"]

    cond_kwargs = {
        "text": req.text,
        "language": req.language,
        "emotion": _build_emotion_vector(req.emotion, req.emotion_intensity),
        "speaking_rate": _speed_to_phonemes_per_min(req.speed),
    }

    if req.ref_audio_b64:
        try:
            cond_kwargs["speaker"] = _make_speaker_embedding(req.ref_audio_b64)
        except Exception as e:
            import traceback
            traceback.print_exc(file=sys.stderr)
            raise HTTPException(status_code=400, detail=f"reference audio decode failed: {e}")

    cond = model.prepare_conditioning(make_cond_dict(**cond_kwargs))
    codes = model.generate(cond)
    audio = model.autoencoder.decode(codes).cpu()  # [1, samples] float32

    if audio.dim() == 2:
        audio = audio[0]
    audio = audio.clamp(-1.0, 1.0)
    pcm = (audio * 32767.0).to(torch.int16).numpy().tobytes()
    return pcm, int(_state["sample_rate"])


@app.on_event("startup")
async def _startup() -> None:
    try:
        _load_model()
    except Exception as e:
        print(f"[zonos] FATAL: {e}", file=sys.stderr, flush=True)


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({
        "ok": _state["ready"],
        "model": "zonos-v0.1",
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

    host = os.environ.get("ZONOS_HOST", "127.0.0.1")
    port = int(os.environ.get("ZONOS_PORT", "7860"))
    assert_loopback_bind("zonos", host)
    uvicorn.run(app, host=host, port=port, log_level="info")
