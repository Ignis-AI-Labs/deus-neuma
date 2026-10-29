"""The speak protocol, implemented once: a FastAPI app factory every voice sidecar serves.

Contract: docs/architecture/voice/speak-protocol.md. A sidecar supplies an ENGINE object and calls

    app = create_app(engine, title="CSM sidecar")
    serve(app, env_prefix="CSM", default_port=7868)

Engine (duck-typed; every method is called on the ONE generation thread, so the model is never
touched by two threads):
    model: str, device: str, context: bool       -- reported by /health (+ profile: str, optional)
    load(set_phase)                              -- blocking; may call set_phase("compiling")
    prepare_voice(voice: VoiceIn) -> state       -- per-voice conditioning, kept in an LRU by ref
    plan(text, voice_state, voice_words, context: list[(ContextIn, memo|None)], max_audio_ms)
        -> (plan, used)                          -- raise SpeakError(413) when even voice + text overflow
    stream(plan) -> Iterator[np.ndarray]         -- float32 mono 24 kHz chunks; closing it stops generation
    memo() -> object                             -- what a later context `ref` re-enters (read after a full stream)

Choices this module makes (the protocol leaves them to the sidecar):
  * One generation at a time, QUEUED in arrival order (asyncio.Lock is FIFO), never 409: a caller
    racing a barge-in just waits its turn. A waiter whose client disconnects leaves the queue
    without running.
  * X-Utterance-Ref is a random 128-bit handle (`utt:<32 hex>`): it must go out in the headers,
    before the PCM it names exists, so it cannot be a hash of that PCM.
  * Client disconnect -> the generator is closed at the next chunk boundary and the lock passes on.
  * Every stream passes through speak_guard.RunawayGuard: audio is capped by the text's length and a
    sustained silence after the line's expected end stops it. The decision comes after the headers,
    so it cannot be a header (and uvicorn's HTTP/1.1 sends no trailers): it is logged
    (`truncated: cap|silence`), and the cut utterance's ref is not stored (a later context ref -> 409).
"""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import sys
from pathlib import Path
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from speak_audio import SR, BoundedLRU, SpeakError, to_pcm16
from speak_guard import RunawayGuard
from speak_request import parse_speak, parse_warm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from browser_guard import guard  # noqa: E402  (audits 2026-10-28/29 M-06)

LOOPBACK_BINDS = frozenset({"127.0.0.1", "localhost", "::1"})
LOOPBACK_PEERS = frozenset({"127.0.0.1", "::1", "::ffff:127.0.0.1"})
VOICE_LRU = 16
UTTERANCE_LRU = 64
UNTRACKED_PATHS = frozenset({"/health", "/shutdown"})


def log(*parts) -> None:
    print("[speak]", *parts, file=sys.stderr, flush=True)


class Runtime:
    """Mutable sidecar state: phase, the generation lock + thread, the LRUs, the idle clock."""

    def __init__(self, engine):
        self.engine = engine
        self.phase = "loading"
        self.error: str | None = None
        self.lock = asyncio.Lock()
        self.worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="speak-gen")
        self.voices = BoundedLRU(VOICE_LRU)
        self.utterances = BoundedLRU(UTTERANCE_LRU)
        self.last_activity = time.monotonic()
        self.busy = 0
        self.loop: asyncio.AbstractEventLoop | None = None

    def touch(self) -> None:
        self.last_activity = time.monotonic()

    def idle_seconds(self) -> float:
        return 0.0 if self.busy else round(time.monotonic() - self.last_activity, 1)

    def set_phase(self, phase: str) -> None:
        self.phase = phase
        log(f"phase -> {phase}")

    def load(self) -> None:  # impure — runs on the generation thread
        t0 = time.perf_counter()
        try:
            self.engine.load(self.set_phase)
            self.set_phase("ready")
            log(f"{self.engine.model} ready in {time.perf_counter() - t0:.1f}s on {self.engine.device}")
        except BaseException as e:  # a dead load is said plainly, never an endless 'loading'
            self.error = f"{type(e).__name__}: {e}"
            self.set_phase("failed")
            traceback.print_exc()

    def require_ready(self) -> None:
        if self.phase != "ready":
            raise SpeakError(503, "not_ready", f"the model is {self.phase}", phase=self.phase,
                             **({"reason": self.error} if self.error else {}))

    def voice_state(self, voice):  # generation thread
        if voice.ref in self.voices:
            return self.voices[voice.ref]
        if voice.wav is None:
            raise SpeakError(409, "unknown_ref", "this sidecar does not hold that voice clip; resend it as clip_b64",
                             ref=voice.ref)
        state = self.engine.prepare_voice(voice)
        self.voices[voice.ref] = state
        return state

    def context_memo(self, seg):  # generation thread
        if seg.ref is None:
            return None
        if seg.ref not in self.utterances:
            raise SpeakError(409, "unknown_ref", "this sidecar does not hold that utterance; resend it as audio_b64",
                             ref=seg.ref)
        return self.utterances[seg.ref]

    def job_ended(self) -> None:  # generation thread -> loop: the lock passes on
        self.loop.call_soon_threadsafe(self._release)

    def _release(self) -> None:
        self.busy -= 1
        self.touch()
        self.lock.release()


async def _acquire(rt: Runtime, request: Request) -> bool:
    """Wait for the generation lock in arrival order; give up (without running) if the client leaves."""
    task = asyncio.ensure_future(rt.lock.acquire())
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=0.2)
            if done:
                rt.busy += 1
                return True
            if await request.is_disconnected():
                break
    finally:
        if not task.done():
            task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        return False
    rt.lock.release()  # it was granted in the instant the client left
    return False


def _speak_job(rt: Runtime, req, put, cancel: threading.Event) -> None:
    """Generation thread: prepare -> ('ready', headers) | ('error', SpeakError); then PCM, then 'end'."""
    eng = rt.engine
    try:
        try:
            voice = rt.voice_state(req.voice)
            ctx = [(seg, rt.context_memo(seg)) for seg in req.context]
            plan, used = eng.plan(req.text, voice, req.voice.words, ctx, req.max_audio_ms)
        except SpeakError as e:
            put(("error", e))
            return
        except Exception as e:
            traceback.print_exc()
            put(("error", SpeakError(500, "internal", f"{type(e).__name__}: {e}")))
            return
        utt = "utt:" + secrets.token_hex(16)
        put(("ready", {"X-Utterance-Ref": utt, "X-Voice-Ref": req.voice.ref, "X-Context-Used": str(used)}))
        t0, first, samples = time.perf_counter(), None, 0
        gen = eng.stream(plan)
        guard = RunawayGuard(gen, req.text)
        complete = False
        try:
            for pcm in guard:
                if first is None:
                    first = time.perf_counter() - t0
                samples += pcm.size
                put(("pcm", to_pcm16(pcm)))
                if cancel.is_set():
                    break
            else:
                complete = not cancel.is_set()
        finally:
            gen.close()
        total = time.perf_counter() - t0
        audio_s = samples / SR
        log(f"utterance {utt} {'done' if complete else 'ABORTED'}: first audio "
            f"{(first or 0) * 1000:.0f} ms, {audio_s:.2f} s audio in {total:.2f} s"
            + (f" (RTF {total / audio_s:.2f})" if audio_s else "") + f", context used {used}"
            + (f", truncated: {guard.truncated} (generated {guard.generated_s:.2f} s, cap "
               f"{guard.cap / SR:.2f} s)" if guard.truncated else ""))
        if complete:
            # a guard-truncated utterance ends cleanly (its words were spoken) but is never stored as a
            # ref: the engine was stopped early, so its memo is not this utterance's
            if guard.truncated is None:
                rt.utterances[utt] = eng.memo()
            put(("end", None))
    except BaseException as e:
        traceback.print_exc()
        put(("fail", e))
    finally:
        rt.job_ended()


class _SpeakResponse(StreamingResponse):
    """A StreamingResponse that signals the generation thread however the response ends — including
    a client that disconnected before the body was ever iterated."""

    def __init__(self, *args, on_close, **kw):
        super().__init__(*args, **kw)
        self._on_close = on_close

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            self._on_close()


async def _pcm_body(q: asyncio.Queue):
    while True:
        kind, val = await q.get()
        if kind == "pcm":
            yield val
        elif kind == "end":
            return
        else:  # headers are gone: abort the connection so the client sees a read error, never a short sentence
            raise RuntimeError("generation failed mid-stream") from val


class _Guard:
    """Pure-ASGI front door (BaseHTTPMiddleware would hide client disconnects from streams): refuses
    non-loopback peers before anything runs, and marks activity on arrival and on the response's END."""

    def __init__(self, app, rt: Runtime):
        self.app = app
        self.rt = rt

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        # browser_guard.py: a web page never reaches a sidecar, and only the backend holding the key does
        answer = guard(scope.get("headers") or [], scope.get("path", ""), (scope.get("query_string") or b"").decode("latin-1"))
        if scope["type"] == "websocket" and answer:
            return await send({"type": "websocket.close", "code": 1008})
        if answer:
            return await JSONResponse(answer[1], status_code=answer[0])(scope, receive, send)
        peer = (scope.get("client") or (None,))[0]
        if peer not in LOOPBACK_PEERS:
            return await JSONResponse({"error": "forbidden", "detail": "this sidecar answers loopback only"},
                                      status_code=403)(scope, receive, send)
        tracked = scope["path"] not in UNTRACKED_PATHS
        if tracked:
            self.rt.touch()
        try:
            await self.app(scope, receive, send)
        finally:
            if tracked:
                self.rt.touch()


async def _json_body(request: Request):
    raw = await request.body()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except ValueError:
        raise SpeakError(400, "bad_request", "the body is not valid JSON") from None


def create_app(engine, *, title: str) -> FastAPI:
    rt = Runtime(engine)

    @asynccontextmanager
    async def lifespan(_app):
        rt.loop = asyncio.get_running_loop()
        rt.loop.run_in_executor(rt.worker, rt.load)
        yield

    app = FastAPI(title=title, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.runtime = rt

    @app.exception_handler(SpeakError)
    async def _refusal(_req, e: SpeakError):
        return JSONResponse(e.body(), status_code=e.status)

    @app.exception_handler(Exception)
    async def _internal(_req, e: Exception):
        return JSONResponse({"error": "internal", "detail": f"{type(e).__name__}: {e}"}, status_code=500)

    @app.get("/health")
    async def health():
        return {"ok": rt.phase == "ready", "model": engine.model, "profile": getattr(engine, "profile", None),
                "phase": rt.phase, "idle_seconds": rt.idle_seconds(), "sample_rate": SR,
                "device": engine.device, "context": engine.context, "error": rt.error}

    @app.post("/speak")
    async def speak(request: Request):
        rt.require_ready()
        req = await asyncio.to_thread(parse_speak, await _json_body(request))
        if not await _acquire(rt, request):
            return Response(status_code=499)  # the client left while queued: dropped without running
        q: asyncio.Queue = asyncio.Queue()
        cancel = threading.Event()
        loop = asyncio.get_running_loop()
        loop.run_in_executor(rt.worker, _speak_job, rt, req,
                             lambda item: loop.call_soon_threadsafe(q.put_nowait, item), cancel)
        kind, val = await q.get()
        if kind != "ready":
            raise val if isinstance(val, SpeakError) else SpeakError(500, "internal", str(val))
        headers = {**val, "X-Audio-Format": "pcm_s16le", "X-Audio-Sample-Rate": str(SR),
                   "X-Audio-Channels": "1", "Cache-Control": "no-store"}
        return _SpeakResponse(_pcm_body(q), media_type="audio/raw", headers=headers, on_close=cancel.set)

    @app.post("/warm")
    async def warm(request: Request):
        rt.require_ready()
        voice = await asyncio.to_thread(parse_warm, await _json_body(request))
        if voice is None:
            return {"ok": True, "voice_ref": None, "ms": 0}
        if not await _acquire(rt, request):
            return Response(status_code=499)

        def job():
            try:
                t0 = time.perf_counter()
                rt.voice_state(voice)
                return round((time.perf_counter() - t0) * 1000)
            finally:
                rt.job_ended()

        ms = await asyncio.get_running_loop().run_in_executor(rt.worker, job)
        return {"ok": True, "voice_ref": voice.ref, "ms": ms}

    @app.post("/shutdown")
    async def shutdown():
        # Unauthenticated by design: _Guard admits loopback peers only and serve() binds loopback only.
        def exit_if_still_idle() -> None:
            # a real request that raced in after the reaper's idle check abandons the exit
            if rt.busy or rt.lock.locked() or time.monotonic() - rt.last_activity < 0.5:
                log("shutdown abandoned: a request is in flight")
                return
            os._exit(0)
        asyncio.get_running_loop().call_later(0.3, exit_if_still_idle)
        return {"ok": True, "shutting_down": True}

    return _Guard(app, rt)


def serve(app, *, env_prefix: str, default_port: int) -> None:
    """Bind the sidecar from ${PREFIX}_HOST / ${PREFIX}_PORT — loopback only, or exit 2."""
    import uvicorn

    host = os.environ.get(f"{env_prefix}_HOST", "127.0.0.1")
    port = int(os.environ.get(f"{env_prefix}_PORT", str(default_port)))
    if host not in LOOPBACK_BINDS:
        # /speak and /shutdown carry no auth; a LAN bind would be an open voice-cloning service
        log(f"FATAL: refusing non-loopback bind {env_prefix}_HOST={host!r}")
        sys.exit(2)
    uvicorn.run(app, host=host, port=port, log_level="warning")
