"""Speak protocol primitives shared by every voice sidecar: errors, bounded LRUs, WAV in, PCM out.

Contract: docs/architecture/voice/speak-protocol.md. Pure helpers only — no model, no HTTP. Each
sidecar's venv carries numpy, soundfile and scipy, which is all this module needs.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import io
from collections import OrderedDict

import numpy as np

SR = 24_000
CLIP_MIN_S = 3.0
CLIP_MAX_S = 40.0
# soundfile subtypes the contract admits: RIFF PCM 16-bit or IEEE float 32-bit
WAV_SUBTYPES = frozenset({"PCM_16", "FLOAT"})


class SpeakError(Exception):
    """A refusal with its protocol status, error code and plain-sentence detail (+ extra body keys)."""

    def __init__(self, status: int, code: str, detail: str, **extra):
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail
        self.extra = extra

    def body(self) -> dict:
        return {"error": self.code, "detail": self.detail, **self.extra}


class BoundedLRU(OrderedDict):
    """A dict that keeps only the `maxlen` most recently used keys. Drop-in for a plain dict cache
    (`in`, `[]`, `[]=`, `get`), so an engine's own unbounded cache can be swapped for one."""

    def __init__(self, maxlen: int):
        super().__init__()
        self.maxlen = maxlen

    def __getitem__(self, key):
        value = super().__getitem__(key)
        self.move_to_end(key)
        return value

    def get(self, key, default=None):
        return self[key] if key in self else default

    def __setitem__(self, key, value):
        super().__setitem__(key, value)
        self.move_to_end(key)
        while len(self) > self.maxlen:
            self.popitem(last=False)


def clip_ref_of(wav: bytes) -> str:
    """The clip's name everywhere: sha256 of its exact WAV bytes (== Voice DNA v2 clip.ref)."""
    return "sha256:" + hashlib.sha256(wav).hexdigest()


def decode_b64(value: object, field: str) -> bytes:
    if not isinstance(value, str) or not value:
        raise SpeakError(400, "bad_request", f"{field} must be a non-empty base64 string")
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        raise SpeakError(400, "bad_request", f"{field} is not valid base64") from None


def decode_wav(wav: bytes, field: str) -> tuple[np.ndarray, float]:
    """WAV bytes -> (float32 mono at 24 kHz, seconds). Downmixes and resamples; refuses anything
    that is not a RIFF/WAVE file of 16-bit PCM or 32-bit float."""
    import soundfile as sf
    from scipy.signal import resample_poly

    if len(wav) < 44 or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
        raise SpeakError(400, "bad_request", f"{field} is not a WAV file")
    try:
        info = sf.info(io.BytesIO(wav))
        if info.subtype not in WAV_SUBTYPES:
            raise SpeakError(400, "bad_request", f"{field} must be 16-bit PCM or 32-bit float WAV, not {info.subtype}")
        audio, sr = sf.read(io.BytesIO(wav), dtype="float32", always_2d=True)
    except SpeakError:
        raise
    except Exception as e:  # libsndfile's own refusal of a damaged file
        raise SpeakError(400, "bad_request", f"{field} could not be read as WAV: {e}") from None
    if audio.shape[0] == 0:
        raise SpeakError(400, "bad_request", f"{field} holds no audio")
    seconds = audio.shape[0] / sr
    mono = audio.mean(axis=1)
    if sr != SR:
        g = np.gcd(sr, SR)
        mono = resample_poly(mono, SR // g, sr // g)
    return np.ascontiguousarray(mono, dtype=np.float32), seconds


def to_pcm16(pcm: np.ndarray) -> bytes:
    """float32 [-1, 1] -> pcm_s16le bytes (the one wire format the protocol streams)."""
    x = np.clip(np.asarray(pcm, dtype=np.float32).reshape(-1), -1.0, 1.0)
    return (x * 32767.0).astype("<i2").tobytes()
