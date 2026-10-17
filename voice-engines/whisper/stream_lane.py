"""The /stream lane's decode machinery — built once at startup, from disk only.

Silero VAD endpointing (stream_vad.py, ONNX, no torch) wraps the canonical ufal
whisper_online.py LocalAgreement-2 processor (vendored beside this file, MIT).
The streaming model is a faster-whisper CTranslate2 export loaded BY PATH on
CPU int8 (model_files.py resolves the pinned directory) — never by a model
name, which faster-whisper would resolve against the Hugging Face Hub at first
use. That lazy network load, plus torch.hub's GitHub check for the VAD, is what
hung the live lane on a machine whose Python HTTP to the Hub never returns.

`stream_pump` is the ONE decode thread of a sitting (threat-model control #3):
every VAD step and ASR decode is serialized there. PCM never leaves it.
"""

from __future__ import annotations

import io
import queue
import time

import numpy as np

VAD_FRAME = 512           # silero window at 16 kHz (32 ms)
# A hold longer than this stops being kept whole and falls back to the
# incremental line. 30 s is whisper's own encoder window — past it a single
# pass buys nothing, and the bound keeps a leaned-on key from growing forever.
HOLD_AUDIO_MAX = 16000 * 30

STOP = ("stop",)
FLUSH = ("flush",)
RESET = ("reset",)
# PUSH TO TALK (Design note, 2026-08-01. Under a held key the KEY owns the endpoint,
# so the VAD must not be consulted at all — see stream_pump for why nothing
# less than a full bypass is correct.
HOLD_ON = ("hold_on",)
HOLD_OFF = ("hold_off",)
CONTROL_FRAMES = {"flush": FLUSH, "reset": RESET, "hold_on": HOLD_ON, "hold_off": HOLD_OFF}


def build_processor(model_dir: str, cpu_threads: int, cadence_s: float, min_silence_ms: int,
                    device: str = "cpu", compute_type: str = "int8"):
    """The streaming pipeline over a local model directory. The sidecar builds it on CPU int8
    — the streaming lane never touches the GPU (rig law); device/compute_type exist for the
    measurement in stream_bench.py only."""
    from faster_whisper import WhisperModel
    from whisper_online import FasterWhisperASR, OnlineASRProcessor, VACOnlineASRProcessor

    from stream_vad import FixedVADIterator, SileroStream

    class CpuInt8ASR(FasterWhisperASR):
        def load_model(self, modelsize=None, cache_dir=None, model_dir=None):
            return WhisperModel(model_dir, device=device, compute_type=compute_type, cpu_threads=cpu_threads)

        def transcribe(self, audio, init_prompt=""):
            """THE HALLUCINATION GATE (2026-08-01). Founder, in a live sitting: […]. Whisper emits stock caption
            phrases on silence; conditioning on previous text turns one into a failure loop
            (faster-whisper's own docstring), and the temperature ladder re-samples a failed
            window into a confident invention. Overridden in this subclass, never by editing
            the vendored ufal file; the base call is otherwise reproduced faithfully."""
            segments, _info = self.model.transcribe(
                audio,
                language=self.original_language,
                initial_prompt=init_prompt,
                beam_size=5,
                word_timestamps=True,
                condition_on_previous_text=False,   # the loop killer
                temperature=0,                       # one deterministic pass
                vad_filter=True,                     # drop non-speech before the decoder
                # Library defaults, stated: a silent window needs BOTH a high no-speech
                # probability and a poor average logprob to be discarded.
                no_speech_threshold=0.6,
                log_prob_threshold=-1.0,
                compression_ratio_threshold=2.4,
                hallucination_silence_threshold=2.0,
                **self.transcribe_kargs,
            )
            return list(segments)

        def ts_words(self, segments):
            """Word extraction with the no-speech gate at the library's 0.6, not the
            vendored 0.9 — that lax a gate lets a confident hallucination through."""
            out = []
            for segment in segments:
                if segment.no_speech_prob > 0.6:
                    continue
                for word in segment.words:
                    out.append((word.start, word.end, word.word))
            return out

    class StreamVAC(VACOnlineASRProcessor):
        # The canonical class builds its VAD through torch.hub (network); this one
        # takes the local ONNX VAD, with the sitting's endpointing budget.
        def __init__(self, online_chunk_size, *a, min_silence_ms, **kw):
            self.online_chunk_size = online_chunk_size
            self.online = OnlineASRProcessor(*a, **kw)
            self.vac = FixedVADIterator(SileroStream(), min_silence_duration_ms=min_silence_ms)
            self.logfile = self.online.logfile
            self.init()

    # Transcript chatter (every partial hypothesis) is being-class data: it goes
    # to the sitting, never to the engine log (control #5).
    asr = CpuInt8ASR(lan="en", model_dir=str(model_dir), logfile=io.StringIO())
    proc = StreamVAC(cadence_s, asr, logfile=io.StringIO(), min_silence_ms=min_silence_ms)
    # One throwaway decode so the first sitting does not pay CTranslate2's lazy init.
    asr.transcribe(np.zeros(16000, dtype=np.float32))
    return proc


def utterance_text(proc) -> str:
    """Committed LocalAgreement words + the unconfirmed tail — the whole in-flight line."""
    online = proc.online
    committed = online.asr.sep.join(w for _, _, w in online.commited)
    tail = online.to_flush(online.transcript_buffer.complete())[2]
    return (committed + tail).strip()


def decode_whole(proc, audio) -> str:
    """One clean pass over a complete hold — the authoritative transcript. "" on a decode
    hiccup, so the caller falls back to the incremental line instead of an empty hold."""
    try:
        segments = proc.online.asr.transcribe(audio)
        words = proc.online.asr.ts_words(segments)
        return proc.online.asr.sep.join(w for _, _, w in words).strip()
    except Exception:
        return ""


def stream_pump(proc, frames_q, emit, stop_flag, cadence_s) -> None:
    """The ONE decode thread — every VAD step and ASR decode for the sitting is
    serialized here, so decode concurrency is 1 by construction."""
    pending = np.array([], dtype=np.float32)
    last_decode = 0.0
    last_status = proc.status
    # HOLD MODE — push-to-talk. The VAD is bypassed ENTIRELY: on a VAD 'start' the
    # controller calls online.init() (whisper_online.py:679), which clears
    # `commited`, so a mid-sentence pause under a held key would ERASE the first
    # half. One hold, one line, ended by the release and nothing else.
    hold = False
    speaking = False   # audio has arrived since the last flush (hold mode)
    # The hold's audio, kept whole so the release decodes it in ONE pass —
    # incremental commits freeze punctuation from partial windows ([…]). Partials stay incremental (display only).
    hold_audio = np.array([], dtype=np.float32)
    while not stop_flag.is_set():
        try:
            item = frames_q.get(timeout=0.05)
        except queue.Empty:
            item = None
        if item is STOP:
            return
        if item is RESET:
            # Barge-in: drop all buffered audio + decode state. reset_done rides the
            # same FIFO, so it lands strictly after every pre-reset output.
            proc.init()
            pending = np.array([], dtype=np.float32)
            last_status = proc.status
            last_decode = time.monotonic()
            emit({"type": "reset_done"})
            continue
        if item is HOLD_ON or item is HOLD_OFF:
            hold = item is HOLD_ON
            proc.init()
            pending = np.array([], dtype=np.float32)
            last_status = proc.status
            speaking = False
            continue
        if item is FLUSH:
            text = ""
            if hold and len(hold_audio) > 0:
                text = decode_whole(proc, hold_audio)
            if not text:
                # DECODE THE TAIL FIRST, or the audio since the last cadence tick is
                # thrown away unheard by init() below (measured 2026-08-01: 4 of 5
                # instant releases lost the final word).
                if len(proc.online.audio_buffer) > 0:
                    proc.online.process_iter()
                text = utterance_text(proc)
            hold_audio = np.array([], dtype=np.float32)
            proc.init()
            pending = np.array([], dtype=np.float32)
            last_status = proc.status
            if speaking:
                emit({"type": "speech_stopped"})
            speaking = False
            if text:
                emit({"type": "utterance", "text": text})
            continue
        if item is not None:
            samples = np.frombuffer(item, dtype=np.int16).astype(np.float32) / 32768.0
            if hold:
                # Straight past the VAD to the decoder: frames only arrive while the
                # key is down, so every sample here is wanted.
                if len(samples) > 0:
                    proc.online.insert_audio_chunk(samples)
                    if len(hold_audio) < HOLD_AUDIO_MAX:
                        hold_audio = np.append(hold_audio, samples)
                    if not speaking:
                        speaking = True
                        emit({"type": "speech_started"})
            else:
                pending = np.append(pending, samples)
                while len(pending) >= VAD_FRAME:
                    proc.insert_audio_chunk(pending[:VAD_FRAME])
                    pending = pending[VAD_FRAME:]

        if hold:
            # Partials while the key is held, and NOTHING final — only the release ends it.
            if speaking and time.monotonic() - last_decode >= cadence_s:
                last_decode = time.monotonic()
                proc.online.process_iter()
                text = utterance_text(proc)
                if text:
                    emit({"type": "partial", "text": text})
            continue

        if proc.status != last_status:
            if proc.status == "voice":
                emit({"type": "speech_started"})
            elif proc.status == "nonvoice" and last_status == "voice":
                emit({"type": "speech_stopped"})
            last_status = proc.status

        finalized = proc.is_currently_final
        if finalized or (proc.status == "voice" and time.monotonic() - last_decode >= cadence_s):
            last_decode = time.monotonic()
            if finalized and len(proc.online.audio_buffer) > 0:
                # finish() only flushes the hypothesis buffer — decode the tail the
                # cadence did not reach, or the utterance flushes EMPTY.
                proc.online.process_iter()
            proc.process_iter()
            text = utterance_text(proc)
            if finalized:
                if text:
                    emit({"type": "utterance", "text": text})
                # CLEAR WHAT WAS JUST SAID: finish() never empties `commited`; without
                # init() a later flush re-emits the same words and the being answers
                # one sentence twice (measured 2026-08-01).
                proc.init()
                pending = np.array([], dtype=np.float32)
                last_status = proc.status
            elif text:
                emit({"type": "partial", "text": text})
