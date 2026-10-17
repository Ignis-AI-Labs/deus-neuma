"""The runaway guard: no utterance runs on long after its words are spoken.

CSM sometimes keeps generating after the line is done — a short line, no context, gave 2.9-14.6 s.
Two exits, both bounded by the TEXT, never by the audio's content:

  * CAP — generated audio never exceeds audio_cap_s(text) = max(4 s, units x 0.55 s x 2.2). When the
    cap is reached, the utterance ends on the quietest 20 ms in the last 0.5 s before it (never
    mid-syllable if a quieter point exists), with a 10 ms fade.
  * SILENCE — once the audio has passed expected_s(text) = max(4 s, units x 0.80 s), a run of
    near-silence (every 20 ms frame under -50 dBFS RMS) lasting 1.2 s past that point ends the
    utterance, keeping 0.3 s of the silence as its tail. Silence BEFORE that point is a real pause
    and is never cut (the samples hold genuine lines with a 5-7 s pause mid-line).

Tuned on every csm / misotts / chatterbox-nano sample in voice-engines/_samples (bake-off rounds 1-2
and the one-voice spike, 988 takes, fed through in CSM's chunk schedule): 985 pass byte-identical;
the 3 cut are runaways, cut only after their last real word (whisper word timestamps): "Hmm." then
19 s of silence (x2), and a MisoTTS take that repeated its last question and then spoke garbage.
Slowest genuine take: 1.08 s/word overall (c09-gasp, csm-1b, a 5.3 s pause mid-line) against a
1.21 s/word cap; a genuine take with a 7.2 s pause after its first three words (csm-1b on the CPU)
resumes before its silence watch begins.

A line that ends on its own before the guard's watch point streams byte-for-byte and chunk-for-chunk
as the engine produced it; after it, held audio is released unchanged unless an exit fires. Pure
computation over float32 chunks: no model, no IO.
"""

from __future__ import annotations

import re
from collections.abc import Iterator

import numpy as np

from speak_audio import SR

GUARD_MIN_S = 4.0
SECONDS_PER_UNIT = 0.55       # a slow speaking rate: the median measured take is ~0.3 s/word
CAP_SLACK = 2.2
EXPECT_SECONDS_PER_UNIT = 0.80  # past this the line should be over; silence beyond it is a runaway
SILENCE_DB = -50.0            # RMS dBFS per frame; CSM's silent floor sits at -54..-72, speech above -35
SILENCE_RUN_S = 1.2
SILENCE_TAIL_S = 0.3
CUT_SEARCH_S = 0.5
FRAME_S = 0.02
FADE_S = 0.01

# a word, or each digit alone (a number is spoken as more words than it is written as)
_WORD_RE = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*|\d")
# scripts written without spaces: every character counts as a unit (generous — never cuts a line)
_DENSE_RE = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]")


def speech_units(text: str) -> int:
    """Pure: how many spoken units the text holds — words, plus every digit, plus every CJK/kana/
    Hangul character."""
    dense = len(_DENSE_RE.findall(text))
    return dense + len(_WORD_RE.findall(_DENSE_RE.sub(" ", text)))


def audio_cap_s(text: str) -> float:
    """Pure: the most audio an utterance of `text` may run to."""
    return max(GUARD_MIN_S, speech_units(text) * SECONDS_PER_UNIT * CAP_SLACK)


def expected_s(text: str) -> float:
    """Pure: the point after which a sustained silence means the line is over."""
    return min(audio_cap_s(text), max(GUARD_MIN_S, speech_units(text) * EXPECT_SECONDS_PER_UNIT))


def _frame_db(x: np.ndarray) -> float:
    return float(10.0 * np.log10(np.mean(np.square(x, dtype=np.float64)) + 1e-12))


def _faded(x: np.ndarray, sr: int) -> np.ndarray:
    n = min(len(x), int(FADE_S * sr))
    if n == 0:
        return x
    out = x.copy()
    out[-n:] *= np.linspace(1.0, 0.0, n, dtype=np.float32)
    return out


class RunawayGuard:
    """Iterate the engine's float32 chunks through the guard. After iteration, `truncated` is None
    (the engine ended the line itself) or the exit that fired ('cap' | 'silence'), and
    `generated_s` / `emitted_s` say how much audio the engine made and how much went out."""

    def __init__(self, chunks, text: str, sr: int = SR):
        self.chunks = chunks
        self.sr = sr
        self.cap = int(audio_cap_s(text) * sr)
        self.expect = int(expected_s(text) * sr)
        self.frame = int(FRAME_S * sr)
        # before this point chunks pass straight through; from it on, quiet runs and the last
        # CUT_SEARCH_S before the cap are held back until the guard knows they are kept
        self.watch_from = min(self.expect, self.cap - int(CUT_SEARCH_S * sr))
        self.truncated: str | None = None
        self.generated_s = 0.0
        self.emitted_s = 0.0

    def __iter__(self) -> Iterator[np.ndarray]:
        sr, frame = self.sr, self.frame
        base = 0                       # absolute sample index of buf[0]
        buf = np.zeros(0, np.float32)  # generated, not yet emitted
        scan = 0                       # absolute index of the next unanalysed frame
        quiet_since: int | None = None
        frames: list[tuple[int, float]] = []  # (start, dB) of analysed frames still in buf
        emitted = 0

        def emit(upto: int, fade: bool = False):
            nonlocal base, buf, frames, emitted
            out = buf[: upto - base]
            buf = buf[upto - base:]
            base = upto
            frames = [f for f in frames if f[0] >= base]
            emitted += out.size
            return _faded(out, sr) if fade else out

        generated = 0
        for chunk in self.chunks:
            chunk = np.asarray(chunk, dtype=np.float32).reshape(-1)
            if not buf.size and generated + chunk.size <= self.watch_from:
                generated += chunk.size
                emitted += chunk.size
                base = scan = generated
                yield chunk  # the fast path: an ordinary line never leaves it
                continue
            generated += chunk.size
            buf = np.concatenate([buf, chunk]) if buf.size else chunk
            scan = max(scan, self.watch_from)
            stop: tuple[int, str] | None = None
            while scan + frame <= generated and stop is None:
                db = _frame_db(buf[scan - base: scan + frame - base])
                frames.append((scan, db))
                if db > SILENCE_DB:
                    quiet_since = None
                elif quiet_since is None:
                    quiet_since = scan
                scan += frame
                if quiet_since is not None and scan - max(quiet_since, self.expect) >= int(SILENCE_RUN_S * sr):
                    stop = (max(base, min(scan, quiet_since + int(SILENCE_TAIL_S * sr))), "silence")
                elif scan >= self.cap:
                    window = [f for f in frames if f[0] >= max(base, self.cap - int(CUT_SEARCH_S * sr))]
                    cut = min(window, key=lambda f: f[1])[0] if window else self.cap
                    stop = (max(base, min(cut, self.cap)), "cap")
            if stop is not None:
                self.truncated = stop[1]
                out = emit(stop[0], fade=True)
                if out.size:
                    yield out
                break
            hold = self.cap - int(CUT_SEARCH_S * sr)
            release = min(quiet_since if quiet_since is not None else scan, max(hold, self.watch_from), generated)
            if release > base:
                yield emit(release)
        if self.truncated is None and buf.size:
            yield emit(base + buf.size)
        self.generated_s = generated / sr
        self.emitted_s = emitted / sr
