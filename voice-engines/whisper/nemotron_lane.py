"""The /stream lane on NVIDIA Nemotron Speech Streaming EN 0.6B — words as they are spoken.

Whisper has no streaming of its own: the base lane re-reads a sliding window
every cadence tick (LocalAgreement), and a hold's final re-reads the whole hold.
Nemotron is cache-aware (FastConformer RNNT): each chunk of audio is read ONCE,
against cached context, so a word lands about one chunk after it is spoken and
the final is complete ~0.2 s after the last word however long the hold
(measured 2026-10-07, docs/work/dictation-flow.md). Its transcript is verbatim —
"uh", repeats, spoken numbers — which is the dictation Founder asked for: the whole
natural flow, mis-hearings fixed in the lexicon, never smoothed by the model.

Same contract as stream_lane.stream_pump (control frames, events), so the
sidecar swaps lanes without the backend or the desk noticing. The sidecar picks
the device (server.py _live_device: the GPU when it has room, else the CPU).
Loaded by path from disk only (HF_HUB_OFFLINE).
"""

from __future__ import annotations

import os
import queue
import threading

import numpy as np

import stream_lane
from stream_vad import FixedVADIterator, SileroStream

SR = 16000
VAD_FRAME = stream_lane.VAD_FRAME
# The right attention context, in encoder frames: 6 → 560 ms chunks (the card's
# accuracy/latency middle; 1 → 160 ms, 13 → 1120 ms are the other trained rungs).
# The 80 ms rung (0) is not served: its first chunk is a single mel frame, which the
# streaming feature extractor cannot window (measured 2026-10-09).
LOOKAHEAD = max(1, int(os.environ.get("NEMOTRON_LOOKAHEAD", "6")))
PRE_ROLL = int(SR * 0.3)        # audio kept before a VAD start, so a first syllable is never clipped
UTTERANCE_MAX = SR * 60 * 10    # a single utterance is bounded (a leaned-on key cannot grow forever)


class Model:
    """The loaded model + processor, shared by every utterance (one decode thread at a time)."""

    def __init__(self, model_dir: str, device: str, threads: int):
        import torch
        from transformers import AutoModelForRNNT, AutoProcessor

        if device == "cpu":
            torch.set_num_threads(threads)
        self.torch = torch
        self.proc = AutoProcessor.from_pretrained(model_dir)
        self.proc.set_num_lookahead_tokens(LOOKAHEAD)
        dtype = torch.float16 if device == "cuda" else torch.float32
        self.model = AutoModelForRNNT.from_pretrained(model_dir, dtype=dtype).to(device).eval()
        self.device, self.dtype = device, dtype
        # generate() keeps streaming state on the model object: one stream at a time.
        self.lock = threading.Lock()
        fe = self.proc.feature_extractor
        self.hop, self.n_fft = fe.hop_length, fe.n_fft
        self.first_n = self.proc.num_samples_first_audio_chunk
        self.per_n = self.proc.num_samples_per_audio_chunk
        # One throwaway utterance so the first sitting does not pay the lazy init.
        u = Utterance(self, lambda _t: None)
        u.push(np.zeros(SR, dtype=np.float32))
        u.finish()

    def features(self, audio, first: bool):
        x = self.proc(audio, sampling_rate=SR, is_streaming=True, is_first_audio_chunk=first,
                      return_tensors="pt")
        return x.to(self.device, dtype=self.dtype)


class _Streamer:
    """generate()'s streamer: the token ids as they are decided → the text so far."""

    def __init__(self, tokenizer, on_text):
        self.tokenizer, self.on_text = tokenizer, on_text
        self.ids: list[int] = []
        self.text = ""

    def put(self, value):
        ids = value.reshape(-1).tolist()
        if not ids:
            return
        self.ids.extend(ids)
        text = self.tokenizer.decode(self.ids, skip_special_tokens=True).strip()
        if text != self.text:
            self.text = text
            self.on_text(text)

    def end(self):
        pass


class Utterance:
    """One cache-aware stream: push PCM as it arrives, read the text so far, finish once."""

    def __init__(self, m: Model, on_partial):
        self.m = m
        self.audio = np.zeros(0, dtype=np.float32)
        self.chunks: queue.Queue = queue.Queue()
        self.next_start = None       # sample index of the next chunk (None until the first is sent)
        self.mel = 0
        self.thread = None
        self.streamer = _Streamer(m.proc.tokenizer, on_partial)
        self.error = None

    def _run(self, first_inputs):
        def gen():
            while (item := self.chunks.get()) is not None:
                yield item
        try:
            with self.m.lock, self.m.torch.inference_mode():
                self.m.model.generate(**{**first_inputs, "input_features": gen(), "streamer": self.streamer})
        except Exception as e:   # a decode hiccup ends this utterance, never the lane
            self.error = e

    def _feed(self) -> None:
        m = self.m
        if self.thread is None:
            if len(self.audio) < m.first_n:
                return
            first = m.features(self.audio[: m.first_n], first=True)
            self.mel = m.proc.num_mel_frames_first_audio_chunk
            self.chunks.put(first.input_features[:, : self.mel, :])
            self.next_start = self.mel * m.hop - m.n_fft // 2
            self.thread = threading.Thread(target=self._run, args=(first,), daemon=True,
                                           name="nemotron-utterance")
            self.thread.start()
        while self.next_start + m.per_n <= len(self.audio):
            end = self.next_start + m.per_n
            self.chunks.put(m.features(self.audio[self.next_start:end], first=False).input_features)
            self.mel += m.proc.num_mel_frames_per_audio_chunk
            self.next_start = self.mel * m.hop - m.n_fft // 2

    def push(self, samples: np.ndarray) -> None:
        if len(self.audio) < UTTERANCE_MAX:
            self.audio = np.append(self.audio, samples)
        self._feed()

    def finish(self) -> str:
        """The last word gets its full lookahead (silence padding), the stream closes, the text is whole."""
        if len(self.audio) == 0:
            return ""
        self.audio = np.append(self.audio, np.zeros(self.m.first_n + 2 * self.m.per_n, dtype=np.float32))
        self._feed()
        self.chunks.put(None)
        self.thread.join()
        return "" if self.error else self.streamer.text

    def abandon(self) -> None:
        if self.thread is not None:
            self.chunks.put(None)
            self.thread.join()


def stream_pump(m: Model, min_silence_ms: int, frames_q, emit, stop_flag) -> None:
    """The ONE decode thread of a sitting — stream_lane.stream_pump's contract, Nemotron inside.
    Open mic: Silero VAD opens and closes each utterance. Hold (push to talk): the key does."""
    vad = FixedVADIterator(SileroStream(), min_silence_duration_ms=min_silence_ms)
    hold = False
    utt: Utterance | None = None
    recent = np.zeros(0, dtype=np.float32)    # pre-roll for the next VAD start
    pending = np.zeros(0, dtype=np.float32)   # samples not yet a whole VAD window

    def partial(text):
        emit({"type": "partial", "text": text})

    def close(final: bool) -> None:
        nonlocal utt
        if utt is None:
            return
        text = utt.finish() if final else (utt.abandon() or "")
        utt = None
        emit({"type": "speech_stopped"})
        if text:
            emit({"type": "utterance", "text": text})

    try:
        while not stop_flag.is_set():
            try:
                item = frames_q.get(timeout=0.05)
            except queue.Empty:
                continue
            if item is stream_lane.STOP:
                return
            if item is stream_lane.RESET:
                if utt is not None:
                    utt.abandon()
                    utt = None
                vad.reset_states()
                pending = recent = np.zeros(0, dtype=np.float32)
                emit({"type": "reset_done"})
                continue
            if item is stream_lane.HOLD_ON or item is stream_lane.HOLD_OFF:
                close(final=True)
                hold = item is stream_lane.HOLD_ON
                vad.reset_states()
                pending = recent = np.zeros(0, dtype=np.float32)
                continue
            if item is stream_lane.FLUSH:
                close(final=True)
                continue
            samples = np.frombuffer(item, dtype=np.int16).astype(np.float32) / 32768.0
            if len(samples) == 0:
                continue
            if hold:
                # Under a held key every sample is wanted: no VAD, one hold = one utterance.
                if utt is None:
                    utt = Utterance(m, partial)
                    emit({"type": "speech_started"})
                utt.push(samples)
                continue
            pending = np.append(pending, samples)
            while len(pending) >= VAD_FRAME:
                window, pending = pending[:VAD_FRAME], pending[VAD_FRAME:]
                event = vad(window)
                if utt is not None:
                    utt.push(window)
                else:
                    recent = np.append(recent, window)[-PRE_ROLL:]
                if event and "start" in event and utt is None:
                    utt = Utterance(m, partial)
                    emit({"type": "speech_started"})
                    utt.push(recent)
                    recent = np.zeros(0, dtype=np.float32)
                if event and "end" in event and "start" not in event:
                    close(final=True)
    finally:
        # A sitting that ends mid-utterance must not leave its decode waiting on
        # chunks that never come — the one model serves the next sitting.
        if utt is not None:
            utt.abandon()
