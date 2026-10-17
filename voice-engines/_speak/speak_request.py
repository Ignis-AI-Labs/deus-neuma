"""Speak protocol request parsing: JSON bodies of /speak and /warm -> validated, decoded records.

Everything a request can get wrong without looking at the sidecar's caches is refused here (400 /
413); refs are only checked for SHAPE — whether the sidecar holds them is the generation worker's
call (409 unknown_ref), because only it sees the caches at the moment it runs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np

from speak_audio import CLIP_MAX_S, CLIP_MIN_S, SpeakError, clip_ref_of, decode_b64, decode_wav

TEXT_MAX = 1000
WORDS_MAX = 2000
CONTEXT_MAX_SEGMENTS = 6
CONTEXT_MAX_S = 45.0
MAX_AUDIO_MS_CAP = 120_000
SPEAKERS = frozenset({"being", "person"})
CLIP_REF_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
UTT_REF_RE = re.compile(r"^utt:[0-9a-f]{32}$")


@dataclass(frozen=True)
class VoiceIn:
    ref: str                       # sha256:<hex> of the clip bytes
    words: str
    wav: bytes | None = None       # set when the caller sent clip_b64
    audio: np.ndarray | None = None  # float32 mono 24 kHz, decoded from wav
    seconds: float = 0.0


@dataclass(frozen=True)
class ContextIn:
    speaker: str                   # 'being' | 'person'
    words: str
    ref: str | None = None         # an X-Utterance-Ref this sidecar issued
    audio: np.ndarray | None = None
    seconds: float = 0.0


@dataclass(frozen=True)
class SpeakIn:
    text: str
    voice: VoiceIn
    context: tuple[ContextIn, ...]
    max_audio_ms: float | None


def _bad(detail: str) -> SpeakError:
    return SpeakError(400, "bad_request", detail)


def _exactly_one(obj: dict, a: str, b: str, where: str) -> str:
    has_a, has_b = obj.get(a) is not None, obj.get(b) is not None
    if has_a == has_b:
        raise _bad(f"{where} needs exactly one of {a} or {b}")
    return a if has_a else b


def _words(value: object, where: str, allow_empty: bool) -> str:
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise _bad(f"{where}.words must be a{'' if allow_empty else ' non-empty'} string")
    if len(value) > WORDS_MAX:
        raise SpeakError(413, "too_long", f"{where}.words is over {WORDS_MAX} characters")
    return value


def parse_voice(voice: object) -> VoiceIn:
    if not isinstance(voice, dict):
        raise _bad("voice must be an object {clip_b64 | clip_ref, words}")
    words = _words(voice.get("words"), "voice", allow_empty=False)
    if _exactly_one(voice, "clip_b64", "clip_ref", "voice") == "clip_ref":
        ref = voice["clip_ref"]
        if not isinstance(ref, str) or not CLIP_REF_RE.match(ref):
            raise _bad("voice.clip_ref must be sha256:<64 lowercase hex>")
        return VoiceIn(ref=ref, words=words)
    wav = decode_b64(voice["clip_b64"], "voice.clip_b64")
    audio, seconds = decode_wav(wav, "voice.clip_b64")
    if seconds > CLIP_MAX_S:
        raise SpeakError(413, "too_long", f"the voice clip is {seconds:.1f} s; the most is {CLIP_MAX_S:.0f} s")
    if seconds < CLIP_MIN_S:
        raise _bad(f"the voice clip is {seconds:.1f} s; at least {CLIP_MIN_S:.0f} s is needed to clone a voice")
    return VoiceIn(ref=clip_ref_of(wav), words=words, wav=wav, audio=audio, seconds=seconds)


def _parse_segment(seg: object, i: int) -> ContextIn:
    where = f"context[{i}]"
    if not isinstance(seg, dict):
        raise _bad(f"{where} must be an object")
    speaker = seg.get("speaker")
    if speaker not in SPEAKERS:
        raise _bad(f"{where}.speaker must be 'being' or 'person'")
    words = _words(seg.get("words"), where, allow_empty=True)
    if _exactly_one(seg, "audio_b64", "ref", where) == "ref":
        ref = seg["ref"]
        if not isinstance(ref, str) or not UTT_REF_RE.match(ref):
            raise _bad(f"{where}.ref must be utt:<32 lowercase hex>")
        return ContextIn(speaker=speaker, words=words, ref=ref)
    audio, seconds = decode_wav(decode_b64(seg["audio_b64"], f"{where}.audio_b64"), f"{where}.audio_b64")
    return ContextIn(speaker=speaker, words=words, audio=audio, seconds=seconds)


def parse_speak(body: object) -> SpeakIn:
    """Validate and decode a /speak body (CPU only: base64 + WAV decode + resample)."""
    if not isinstance(body, dict):
        raise _bad("the body must be a JSON object")
    text = body.get("text")
    if not isinstance(text, str) or not text.strip():
        raise _bad("text must be a non-empty string")
    if len(text) > TEXT_MAX:
        raise SpeakError(413, "too_long", f"text is {len(text)} characters; the most is {TEXT_MAX}")
    context = body.get("context") or []
    if not isinstance(context, list):
        raise _bad("context must be a list")
    if len(context) > CONTEXT_MAX_SEGMENTS:
        raise _bad(f"context holds {len(context)} segments; the most is {CONTEXT_MAX_SEGMENTS}")
    segs = tuple(_parse_segment(s, i) for i, s in enumerate(context))
    if sum(s.seconds for s in segs) > CONTEXT_MAX_S:
        raise SpeakError(413, "too_long", f"context audio is over {CONTEXT_MAX_S:.0f} s")
    cap = body.get("max_audio_ms")
    if cap is not None and (isinstance(cap, bool) or not isinstance(cap, (int, float))
                            or not 0 < cap <= MAX_AUDIO_MS_CAP):
        raise _bad(f"max_audio_ms must be a number in (0, {MAX_AUDIO_MS_CAP}]")
    return SpeakIn(text=text.strip(), voice=parse_voice(body.get("voice")), context=segs,
                   max_audio_ms=float(cap) if cap is not None else None)


def parse_warm(body: object) -> VoiceIn | None:
    """A /warm body: {} (just confirm ready) or {voice: {...}}."""
    if body is None or body == {}:
        return None
    if not isinstance(body, dict):
        raise _bad("the body must be a JSON object")
    return parse_voice(body["voice"]) if body.get("voice") is not None else None
