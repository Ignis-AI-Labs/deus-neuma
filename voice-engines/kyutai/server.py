"""Kyutai TTS 1.6B sidecar — local HTTP server.

Loads kyutai/tts-1.6b-en_fr once at startup from the managed flat dir
`voice-engines/_models/kyutai/` (explicit local-Path overrides — never the dir
as repo id, per the S-2 spike), serves synthesis as streamed raw PCM, one 80 ms
frame per chunk. The JS adapter (providers/kyutai.js) reads format from headers.

Endpoints:
    GET  /health      → { ok, model, device, sample_rate, idle_seconds }
    POST /shutdown    → { ok, shutting_down } (deferred still-idle re-check exit)
    POST /synthesize  → streamed raw PCM (24 kHz pcm_s16le mono, per-frame chunks)
        body: { text, voice?, embedding_b64?, embedding_ref?, cfg_coef? }
        resp headers: X-Audio-Format, X-Audio-Sample-Rate, X-Audio-Channels
    POST /mint        → { embedding_b64 }
        body: { ref_audio_b64 } (24 kHz mono s16 WAV, 1..60 s, bounded)

Single-state design (NFR-8): moshi permits exactly one LM streaming state per
process, so one TTSGen with one baked-in conditioning lives for the process
lifetime and ALL generation (synthesize + mint) serializes on ONE global
asyncio.Lock. Conditioning that differs from the baked session gets a loud 409
— voice switch = engine restart at being-switch/re-forge, never mid-stream.
License allowlist is an exact set over normalized slugs: expresso/* is CC-BY-NC
→ 400 naming the license; only the 8 CC0 voice-donations/* presets (or the
operator-baked default voice) are servable.

Operator env: KYUTAI_HOST (127.0.0.1 only), KYUTAI_PORT (7866), KYUTAI_VOICE
(default voice id resolved in the managed dir), KYUTAI_CFG_COEF (2.0).

Reference: https://github.com/kyutai-labs/moshi (kyutai/tts-1.6b-en_fr)
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import concurrent.futures
import hashlib
import io
import json
import os
import re
import sys
import threading
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = REPO_ROOT / "_models" / "kyutai"
CONFIG_PATH = MODEL_DIR / "config.json"

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Kyutai Sidecar", version="0.1.0")

_MODEL_LABEL = "kyutai-tts-1.6b-en_fr"
_HF_REPO = "kyutai/tts-1.6b-en_fr"  # identifier only — never used for IO (S-2 spike)

_MAX_TEXT = 4000
_MAX_VOICE_ID = 256
_REF_AUDIO_B64_MAX_CHARS = 3_900_000   # ≈60 s of 24 kHz s16 mono WAV + header, base64
_MINT_MAX_WAV_BYTES = 2_950_000        # decoded WAV cap; the duration cap is the semantic bound
_MINT_MIN_SECONDS = 1.0
_MINT_MAX_SECONDS = 60.0
_EMBEDDING_MAX_BYTES = 4 * 1024 * 1024  # minted embeddings measure ~0.25–1.6 MB
_EMBEDDING_B64_MAX_CHARS = 5_600_000
_QUEUE_MAX_FRAMES = 8192               # 8192 × 3840 B ≈ 31 MB worst-case turn buffer
_FIRST_FRAME_TIMEOUT_S = 30
_FRAME_TIMEOUT_S = 60                  # mid-stream stall bound — observed GPU-contention generation stalls hit ~26s on this rig
_TURN_INACTIVITY_S = 120               # no frame progress for this long → the turn is wedged
_WATCHDOG_POLL_S = 5                   # watchdog wake cadence between inactivity checks
_PUMP_JOIN_TIMEOUT_S = 5
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

# Canonical CC0 preset set — mirrors core/voice/voice-presets-data.js and the
# engines.json kyutai download contract. Exact-set membership, never substring.
_ALLOWED_VOICES = frozenset({
    "voice-donations/James.wav",
    "voice-donations/Hannah.wav",
    "voice-donations/Andrea.wav",
    "voice-donations/Antoni.wav",
    "voice-donations/Lara.wav",
    "voice-donations/Moses.wav",
    "voice-donations/Glenn.wav",
    "voice-donations/Blake.wav",
})
_VOICE_SLUG_RE = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_/.-]{0,255}")

# Idle contract (engine-manager reaps on it): every real request marks
# activity; /health polls and the shutdown call itself must not keep an
# idle engine alive.
_last_activity = time.monotonic()


sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from browser_guard import assert_loopback_bind, refusal  # noqa: E402  (audit 2026-10-28 M-06)

@app.middleware("http")
async def _track_activity(request, call_next):
    # Stamped on arrival; for a StreamingResponse turn the post-call_next stamp
    # lands at stream START (headers ready), so /synthesize stamps per frame as
    # the body streams — a long synthesis can never be mistaken for idleness.
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


_state: dict = {
    "model": None, "session": None, "device": None, "sample_rate": None,
    "ready": False, "voice": None, "voice_sha256": None, "cfg_coef": None,
    "valid_cfg": frozenset(),
}

# ONE lock for all moshi state — held across a whole turn, generation AND
# stream drain, so a queued caller's first frame can never interleave (S-7).
_gen_lock = asyncio.Lock()

# Strong references for in-flight per-turn tasks — the loop only weak-refs
# tasks, so an unreferenced watchdog can be garbage-collected before it fires.
_background_tasks: set = set()


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=_MAX_TEXT)
    voice: str | None = Field(None, max_length=_MAX_VOICE_ID)
    embedding_b64: str | None = Field(None, max_length=_EMBEDDING_B64_MAX_CHARS)
    embedding_ref: str | None = Field(None, max_length=128)
    cfg_coef: float | None = Field(None, ge=1.0, le=4.0)


class MintRequest(BaseModel):
    ref_audio_b64: str = Field(..., min_length=8, max_length=_REF_AUDIO_B64_MAX_CHARS)


class _WavRejected(ValueError):
    """Seed WAV failed sidecar-side re-validation — always a 400 with the cause."""


class _Done:
    """Queue terminal: the turn finished cleanly."""


_DONE = _Done()


class _Error:
    """Queue terminal: generation fault; message carries the cause, never payload bytes."""

    def __init__(self, message: str):
        self.message = message


def _resolve_device() -> str:
    import torch
    return "cuda" if torch.cuda.is_available() else "cpu"


def _file_sha256(path: Path) -> str:  # impure
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _valid_voice_slug(voice: str) -> bool:
    return bool(_VOICE_SLUG_RE.fullmatch(voice)) and ".." not in voice.split("/")


def _resolve_default_voice(tts_model) -> tuple[str, Path]:
    """Operator-configured default (KYUTAI_VOICE) or first installed CC0 preset."""
    env_voice = os.environ.get("KYUTAI_VOICE")
    if env_voice:
        if not _valid_voice_slug(env_voice):
            raise RuntimeError(f"KYUTAI_VOICE={env_voice!r} is not a valid voice slug")
        path = MODEL_DIR / (env_voice + tts_model.voice_suffix)
        if not path.is_file():
            raise RuntimeError(f"KYUTAI_VOICE={env_voice!r} embedding not installed at {path}")
        return env_voice, path
    for voice in sorted(_ALLOWED_VOICES):
        path = MODEL_DIR / (voice + tts_model.voice_suffix)
        if path.is_file():
            return voice, path
    raise RuntimeError(
        f"no voice embedding installed under {MODEL_DIR} (expected one of "
        f"{sorted(_ALLOWED_VOICES)} or KYUTAI_VOICE). "
        "Run: uv run voice-engines/_downloader/download.py kyutai"
    )


def _load_model() -> None:  # impure
    if not CONFIG_PATH.exists():
        raise RuntimeError(
            f"Kyutai weights not found at {MODEL_DIR} (need config.json + 3 model files). "
            "Run: uv run voice-engines/_downloader/download.py kyutai"
        )
    cfg = json.loads(CONFIG_PATH.read_text())
    moshi_weights = MODEL_DIR / cfg["moshi_name"]
    mimi_weights = MODEL_DIR / cfg["mimi_name"]
    tokenizer = MODEL_DIR / cfg["tokenizer_name"]
    for path in (moshi_weights, mimi_weights, tokenizer):
        if not path.is_file():
            raise RuntimeError(
                f"Kyutai weights incomplete at {MODEL_DIR}: missing {path.name}. "
                "Run: uv run voice-engines/_downloader/download.py kyutai"
            )
    from moshi.models.loaders import CheckpointInfo
    from moshi.models.tts import TTSModel

    device = _resolve_device()
    cfg_coef = float(os.environ.get("KYUTAI_CFG_COEF", "2.0"))
    print(f"[kyutai] loading model from {MODEL_DIR} on {device}", file=sys.stderr, flush=True)
    t0 = time.time()
    ckpt = CheckpointInfo.from_hf_repo(
        _HF_REPO,
        moshi_weights=moshi_weights,
        mimi_weights=mimi_weights,
        tokenizer=tokenizer,
        config_path=CONFIG_PATH,
    )
    tts_model = TTSModel.from_checkpoint_info(ckpt, n_q=32, temp=0.6, device=device)
    if cfg_coef not in tts_model.valid_cfg_conditionings:
        raise RuntimeError(
            f"KYUTAI_CFG_COEF={cfg_coef} unsupported — valid: {sorted(tts_model.valid_cfg_conditionings)}"
        )
    voice, voice_path = _resolve_default_voice(tts_model)
    cond = tts_model.make_condition_attributes([voice_path], cfg_coef=cfg_coef)
    session = _Session(tts_model, cond)
    elapsed = time.time() - t0
    sr = int(tts_model.mimi.sample_rate)
    _state.update(
        model=tts_model, session=session, device=device, sample_rate=sr, ready=True,
        voice=voice, voice_sha256=_file_sha256(voice_path), cfg_coef=cfg_coef,
        valid_cfg=set(tts_model.valid_cfg_conditionings),
    )
    print(f"[kyutai] ready in {elapsed:.1f}s — sample_rate={sr} voice={voice!r} "
          f"cfg_coef={cfg_coef}", file=sys.stderr, flush=True)


def _prepare_script(model, script: str):
    """Tokenize text into timed entries — bench-proven flow (first turn, padding_between=1)."""
    from moshi.models.tts import script_to_entries
    return script_to_entries(
        model.tokenizer,
        model.machine.token_ids,
        model.mimi.frame_rate,
        [script],
        multi_speaker=model.multi_speaker,
        padding_between=1,
    )


class _TTSGen:
    """One conditioned generation machine — port of the bench-proven TTSGen.

    Constructed once at startup (LMGen.streaming_forever has no clean teardown);
    reset per turn via _Session.reset. should_abort is the cooperative cancel
    hook checked between 80 ms steps (client disconnect; barge-in builds on it).
    """

    def __init__(self, tts_model, attributes):
        import torch  # local: heavy import stays out of module scope (zonos pattern)
        from moshi.conditioners import dropout_all_conditions
        from moshi.models.lm import LMGen

        self.tts_model = tts_model
        self.on_frame = None
        self.should_abort = lambda: False
        self.offset = 0
        self.state = tts_model.machine.new_state([])
        if tts_model.cfg_coef != 1.0:
            if tts_model.valid_cfg_conditionings:
                raise ValueError("cfg distillation model: pass cfg_coef to make_condition_attributes")
            nulled = dropout_all_conditions(attributes)
            attributes = list(attributes) + nulled
        assert tts_model.lm.condition_provider is not None
        prepared = tts_model.lm.condition_provider.prepare(attributes)
        condition_tensors = tts_model.lm.condition_provider(prepared)

        def _on_text_logits_hook(text_logits):
            if tts_model.padding_bonus:
                text_logits[..., tts_model.machine.token_ids.pad] += tts_model.padding_bonus
            return text_logits

        def _on_audio_hook(audio_tokens):
            audio_offset = tts_model.lm.audio_offset
            delays = tts_model.lm.delays
            for q in range(audio_tokens.shape[1]):
                delay = delays[q + audio_offset]
                if self.offset < delay + tts_model.delay_steps:
                    audio_tokens[:, q] = tts_model.machine.token_ids.zero

        def _on_text_hook(text_tokens):
            tokens = text_tokens.tolist()
            out_tokens = []
            for token in tokens:
                out_token, _ = tts_model.machine.process(self.offset, self.state, token)
                out_tokens.append(out_token)
            text_tokens[:] = torch.tensor(out_tokens, dtype=torch.long, device=text_tokens.device)

        self.tts_model.lm.dep_q = tts_model.n_q
        self.lm_gen = LMGen(
            tts_model.lm,
            temp=tts_model.temp,
            temp_text=tts_model.temp,
            cfg_coef=tts_model.cfg_coef,
            condition_tensors=condition_tensors,
            on_text_logits_hook=_on_text_logits_hook,
            on_text_hook=_on_text_hook,
            on_audio_hook=_on_audio_hook,
            cfg_is_masked_until=None,
            cfg_is_no_text=True,
        )
        self.lm_gen.streaming_forever(1)

    def process_last(self):
        while (len(self.state.entries) > 0 or self.state.end_step is not None) \
                and not self.should_abort():
            self._step()
        additional_steps = self.tts_model.delay_steps + max(self.tts_model.lm.delays) + 8
        for _ in range(additional_steps):
            if self.should_abort():
                return
            self._step()

    def process(self):
        while len(self.state.entries) > self.tts_model.machine.second_stream_ahead \
                and not self.should_abort():
            self._step()

    def _step(self):
        import torch  # local: heavy import stays out of module scope (zonos pattern)
        missing = self.tts_model.lm.n_q - self.tts_model.lm.dep_q
        input_tokens = torch.full(
            (1, missing, 1),
            self.tts_model.machine.token_ids.zero,
            dtype=torch.long,
            device=self.tts_model.lm.device,
        )
        frame = self.lm_gen.step(input_tokens)
        self.offset += 1
        if frame is not None and self.on_frame is not None:
            self.on_frame(frame)

    def append_entry(self, entry):
        self.state.entries.append(entry)


class _Session:
    """One conditioned connection: _TTSGen built once, reset per turn (bench-proven)."""

    def __init__(self, tts_model, condition_attributes):
        self.model = tts_model
        self.gen = _TTSGen(tts_model, [condition_attributes])
        self._mimi_ctx = tts_model.mimi.streaming(1)
        self._mimi_ctx.__enter__()

    def reset(self, on_frame, should_abort) -> None:
        self.gen.offset = 0
        self.gen.state = self.model.machine.new_state([])
        self.gen.on_frame = on_frame
        self.gen.should_abort = should_abort
        self.gen.lm_gen.reset_streaming()
        self.model.mimi.reset_streaming()


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


def _pump_turn(session, text: str, queue, cancel, loop) -> None:  # impure
    """Worker-thread generation turn: reset, feed script, step, push s16le frames."""
    import numpy as np
    import torch

    def on_frame(frame) -> None:
        if cancel.is_set():
            return
        if not (frame != -1).all():
            return
        pcm = session.model.mimi.decode(frame[:, 1:, :]).cpu().numpy()
        pcm = np.clip(pcm[0, 0], -1.0, 1.0)
        _queue_put(loop, queue, (pcm * 32767.0).astype("<i2").tobytes(), cancel)

    try:
        with torch.no_grad():
            session.reset(on_frame, cancel.is_set)
            for entry in _prepare_script(session.model, text):
                session.gen.append_entry(entry)
            session.gen.process()
            session.gen.process_last()
        terminal = _DONE
    except Exception as e:
        terminal = _Error(f"{type(e).__name__}: {e}")
    _queue_put(loop, queue, terminal, cancel)


async def _drain_pump(pump) -> None:
    """Wait for the worker thread to exit after end/cancel; loud, never raises."""
    try:
        await asyncio.wait_for(asyncio.shield(pump), timeout=_PUMP_JOIN_TIMEOUT_S)
    except asyncio.TimeoutError:
        print(f"[kyutai] ERROR: pump thread did not join within {_PUMP_JOIN_TIMEOUT_S}s",
              file=sys.stderr, flush=True)
    except Exception as e:
        print(f"[kyutai] pump thread raised outside capture: {e}", file=sys.stderr, flush=True)


def _check_voice_id(voice: str) -> None:
    """License + slug gate on any request voice id (exact-set, fail closed)."""
    if not _valid_voice_slug(voice):
        raise HTTPException(status_code=400, detail=f"invalid voice id {voice!r} — slug charset [A-Za-z0-9_/.-], no traversal")
    if voice.startswith("expresso/"):
        raise HTTPException(status_code=400, detail=(
            f"voice {voice!r} is CC-BY-NC-4.0 (non-commercial) — refused by the sidecar "
            "license allowlist; only the 8 CC0 voice-donations/* presets or a minted "
            "embedding are served"
        ))
    if voice not in _ALLOWED_VOICES:
        raise HTTPException(status_code=400, detail=(
            f"voice {voice!r} is not in the exact-set allowlist: {sorted(_ALLOWED_VOICES)}"
        ))


def _check_conditioning(req: SynthesizeRequest) -> None:
    """Validate the request's conditioning against the baked session.

    No silent fallback: license/slug faults → 400; conditioning that differs
    from the baked session → 409 (single-state sidecar — switching is an
    engine restart at being-switch/re-forge, FR-14/NFR-8). Request-supplied
    tensor bytes are hashed for the equality check and NEVER deserialized —
    safetensors-only holds by construction on this path.
    """
    if req.voice is not None:
        _check_voice_id(req.voice)
        if req.voice != _state["voice"]:
            raise HTTPException(status_code=409, detail=(
                f"voice switch to {req.voice!r} requires an engine restart — baked voice "
                f"is {_state['voice']!r} (single moshi streaming state, NFR-8)"
            ))
    if req.embedding_b64 is not None:
        try:
            raw = base64.b64decode(req.embedding_b64, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(status_code=400, detail="embedding_b64 is not valid base64")
        if len(raw) > _EMBEDDING_MAX_BYTES:
            raise HTTPException(status_code=400, detail=f"embedding {len(raw)} B exceeds {_EMBEDDING_MAX_BYTES} B cap")
        if hashlib.sha256(raw).hexdigest() != _state["voice_sha256"]:
            raise HTTPException(status_code=409, detail=(
                "inline embedding differs from the baked conditioning — re-forge restarts "
                "the engine with the minted voice (NFR-8)"
            ))
    if req.embedding_ref is not None:
        ref = req.embedding_ref
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", ref) or ".." in ref:
            raise HTTPException(status_code=400, detail=f"invalid embedding_ref {ref!r} — fixed filename only")
        if not (MODEL_DIR / ref).is_file():
            raise HTTPException(status_code=409, detail=f"embedding_ref {ref!r} is not installed in the managed model dir")
        if _file_sha256(MODEL_DIR / ref) != _state["voice_sha256"]:
            raise HTTPException(status_code=409, detail=(
                f"embedding_ref {ref!r} differs from the baked conditioning — re-forge "
                "restarts the engine (NFR-8)"
            ))
    if req.cfg_coef is not None:
        if req.cfg_coef not in _state["valid_cfg"]:
            raise HTTPException(status_code=400, detail=(
                f"cfg_coef {req.cfg_coef} unsupported — valid: {sorted(_state['valid_cfg'])}"
            ))
        if req.cfg_coef != _state["cfg_coef"]:
            raise HTTPException(status_code=409, detail=(
                f"cfg_coef is baked at conditioning time ({_state['cfg_coef']}) — changing "
                "it requires an engine restart (NFR-8)"
            ))


def _parse_seed_wav(raw: bytes, expected_rate: int, frame_size: int):
    """Stdlib WAV parse + full re-validation — the sidecar is the last code before torch."""
    import numpy as np
    import wave
    try:
        with wave.open(io.BytesIO(raw)) as w:
            rate, channels, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
            frames = w.readframes(w.getnframes())
    except (wave.Error, EOFError) as e:
        raise _WavRejected(f"not a PCM RIFF/WAVE container: {e}")
    if width != 2:
        raise _WavRejected(f"seed WAV must be 16-bit PCM (got {width * 8}-bit)")
    if channels != 1:
        raise _WavRejected(f"seed WAV must be mono (got {channels} channels)")
    if rate != expected_rate:
        raise _WavRejected(f"seed WAV must be {expected_rate} Hz (got {rate} Hz)")
    seconds = len(frames) / 2 / rate
    if seconds < _MINT_MIN_SECONDS:
        raise _WavRejected(f"seed audio too short: {seconds:.2f}s < {_MINT_MIN_SECONDS:.0f}s")
    if seconds > _MINT_MAX_SECONDS:
        raise _WavRejected(f"seed audio exceeds {_MINT_MAX_SECONDS:.0f}s cap: {seconds:.2f}s")
    pcm = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    pad = (-len(pcm)) % frame_size  # mimi streaming encode demands frame-aligned input
    if pad:
        pcm = np.pad(pcm, (0, pad))
    return np.ascontiguousarray(pcm)


def _check_embedding_bytes(payload: bytes) -> None:
    """Bound + shape-check the minted output before it leaves the sidecar.

    Parses with safetensors only — torch.load/pickle never run in this process,
    on request bytes or produced bytes alike.
    """
    import torch
    from safetensors.torch import load
    if len(payload) > _EMBEDDING_MAX_BYTES:
        raise RuntimeError(f"mint output {len(payload)} B exceeds {_EMBEDDING_MAX_BYTES} B bound")
    tensors = load(payload)
    if set(tensors.keys()) != {"speaker_wavs"}:
        raise RuntimeError(f"mint output must carry exactly 'speaker_wavs', got {sorted(tensors.keys())}")
    t = tensors["speaker_wavs"]
    if t.dtype != torch.float32 or t.dim() != 3 or t.shape[0] != 1 or t.shape[2] < 1:
        raise RuntimeError(f"mint output bad shape/dtype: {tuple(t.shape)} {t.dtype}")


def _mint_embedding(raw: bytes) -> bytes:  # impure
    """WAV bytes → safetensors speaker embedding (worker thread, gen lock held)."""
    import torch
    from safetensors.torch import save

    model = _state["session"].model
    wav = _parse_seed_wav(raw, int(model.mimi.sample_rate), int(model.mimi.frame_size))
    with torch.no_grad():
        model.mimi.reset_streaming()  # clean conv state — encode then re-arm for synthesis
        wav_t = torch.from_numpy(wav)[None, None].to(_state["device"])
        latent = model.mimi.encode_to_latent(wav_t, quantize=True)
        model.mimi.reset_streaming()
    payload = save({"speaker_wavs": latent[0].unsqueeze(0).cpu().float().contiguous()})
    _check_embedding_bytes(payload)
    return payload


@app.on_event("startup")
async def _startup() -> None:
    try:
        _load_model()
    except Exception as e:
        print(f"[kyutai] FATAL: {e}", file=sys.stderr, flush=True)


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({
        "ok": _state["ready"],
        "model": _MODEL_LABEL,
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
    _check_conditioning(req)

    # The lock spans the whole turn — generation AND stream drain — so a queued
    # caller's first frame can never interleave with the current turn (S-7/NFR-8).
    await _gen_lock.acquire()
    queue: asyncio.Queue = asyncio.Queue(maxsize=_QUEUE_MAX_FRAMES)
    cancel = threading.Event()
    loop = asyncio.get_running_loop()
    pump = loop.run_in_executor(None, _pump_turn, _state["session"], req.text, queue, cancel, loop)

    # Turn teardown funnels through `turn_done` into ONE supervisor task.
    # Witnessed 2026-07-19: a client disconnect made the server close the
    # response generator, and awaiting the pump drain inside that generator's
    # finally is illegal under GeneratorExit — the teardown died before
    # releasing the lock and one cut client bricked the sidecar permanently.
    # A generator's finally here may only do SYNCHRONOUS work; the supervisor
    # (a plain task, where awaiting is always legal) owns cancel/drain/release.
    turn_done = asyncio.Event()
    last_progress = time.monotonic()  # stamped per yielded frame — see frames()

    async def _watchdog() -> None:
        # INACTIVITY cap, not a total-turn cap: a healthy slow drain (a
        # realtime client playing the take) stamps progress every frame and
        # never trips this — the lock must span the FULL drain (S-7/NFR-8).
        # Only a turn with no progress for the whole window is wedged.
        while True:
            try:
                await asyncio.wait_for(turn_done.wait(), timeout=_WATCHDOG_POLL_S)
                return  # turn ended normally — disarmed
            except asyncio.TimeoutError:
                if time.monotonic() - last_progress >= _TURN_INACTIVITY_S:
                    print(f"[kyutai] ERROR: turn inactive for {_TURN_INACTIVITY_S}s — forcing release",
                          file=sys.stderr, flush=True)
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

    try:
        try:
            first = await asyncio.wait_for(queue.get(), timeout=_FIRST_FRAME_TIMEOUT_S)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=500, detail=f"no audio frame within {_FIRST_FRAME_TIMEOUT_S}s")
        if isinstance(first, _Error):
            raise HTTPException(status_code=500, detail=first.message)
    except BaseException:
        # Any pre-response exit — timeout, generation error, or a disconnect
        # cancelling this await. The supervisor tears the turn down; the
        # handler coroutine may legally await it here, so the error path
        # returns only after the lock is actually free.
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
                    # Mid-stream: the 200 is already committed — log the cause and
                    # terminate the body (explicit terminator frames are B-16/FR-7).
                    print(f"[kyutai] mid-stream generation error: {item.message}",
                          file=sys.stderr, flush=True)
                    break
                # Per-frame stamps: idle_seconds stays truthful THROUGH a long
                # take (the middleware's post-call_next mark fires at stream
                # start for StreamingResponse), and the inactivity watchdog
                # sees this turn making progress however slow the client is.
                _last_activity = time.monotonic()
                last_progress = time.monotonic()
                yield item
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=_FRAME_TIMEOUT_S)
                except asyncio.TimeoutError:
                    # Pump wedged or the server stopped iterating mid-turn —
                    # break so the finally ends the turn via the supervisor.
                    print(f"[kyutai] ERROR: no frame for {_FRAME_TIMEOUT_S}s mid-stream — terminating turn",
                          file=sys.stderr, flush=True)
                    break
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


@app.post("/mint")
async def mint(req: MintRequest) -> JSONResponse:
    if not _state["ready"]:
        raise HTTPException(status_code=503, detail="model not loaded")
    try:
        raw = base64.b64decode(req.ref_audio_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="ref_audio_b64 is not valid base64")
    if len(raw) > _MINT_MAX_WAV_BYTES:
        raise HTTPException(status_code=400, detail=f"decoded WAV {len(raw)} B exceeds {_MINT_MAX_WAV_BYTES} B cap")
    loop = asyncio.get_running_loop()
    async with _gen_lock:  # mimi streaming state is shared with synthesis — same lock
        try:
            payload = await loop.run_in_executor(None, _mint_embedding, raw)
        except _WavRejected as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    return JSONResponse({"embedding_b64": base64.b64encode(payload).decode("ascii")})


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("KYUTAI_HOST", "127.0.0.1")
    port = int(os.environ.get("KYUTAI_PORT", "7866"))
    if host not in _LOOPBACK_HOSTS:
        # An unauthenticated /mint + /synthesize on a non-loopback address is a
        # LAN-facing voice-cloning service. Refuse, don't warn (guard 9).
        print(f"[kyutai] FATAL: refusing non-loopback bind KYUTAI_HOST={host!r}",
              file=sys.stderr, flush=True)
        raise SystemExit(2)
    uvicorn.run(app, host=host, port=port, log_level="info")
