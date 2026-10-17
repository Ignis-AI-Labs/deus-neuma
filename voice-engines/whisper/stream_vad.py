"""Silero VAD for the /stream lane — from a file on disk, no torch, no network.

The lane used to build its VAD with `torch.hub.load('snakers4/silero-vad')`,
which asks GitHub to validate the repo on every load — on a machine where that
call hangs, the first /stream connect hung with it and no speech frame ever
arrived. This module replaces it:

* The model is the Silero VAD ONNX that ships INSIDE the faster-whisper wheel
  (`faster_whisper/assets/silero_vad_v6.onnx`) — the same file the /transcribe
  path already uses for `vad_filter`. The wheel is sha256-pinned by uv.lock, so
  there is nothing to download and nothing to fetch at first use. Its sha256 is
  checked here too: a faster-whisper upgrade that swaps the VAD is a failed
  load with a plain reason, never a silent behaviour change.
* `SileroStream` keeps the ONNX recurrent state (h, c) and the 64-sample
  context between 512-sample windows — the streaming form of
  `faster_whisper.vad.SileroVADModel` (MIT), which only runs whole clips.
* `FixedVADIterator` is the numpy port of the vendored
  `silero_vad_iterator.py` (snakers4/silero-vad utils_vad.py VADIterator + the
  ufal FixedVADIterator, both MIT): same thresholds, same start/end padding,
  same merge rule — without importing torch (~0.5 GB of RAM the lane no longer
  carries).
"""

from __future__ import annotations

import hashlib
import os

import numpy as np

VAD_SHA256 = "4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2"
_WINDOW = 512     # samples at 16 kHz (32 ms) — the model's fixed window
_CONTEXT = 64     # samples of the previous window the model sees


def bundled_vad_path() -> str:
    from faster_whisper.utils import get_assets_path

    return os.path.join(get_assets_path(), "silero_vad_v6.onnx")


def _sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


class SileroStream:
    """One stream's Silero VAD: window in, speech probability out."""

    def __init__(self, path: str | None = None):
        import onnxruntime

        path = path or bundled_vad_path()
        if not os.path.isfile(path):
            raise FileNotFoundError(f"Silero VAD model missing: {path}")
        got = _sha256(path)
        if got != VAD_SHA256:
            raise RuntimeError(f"Silero VAD at {path} has sha256 {got}, expected {VAD_SHA256}")
        opts = onnxruntime.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        opts.enable_cpu_mem_arena = False
        opts.log_severity_level = 4
        self.session = onnxruntime.InferenceSession(
            path, providers=["CPUExecutionProvider"], sess_options=opts,
        )
        self.reset_states()

    def reset_states(self) -> None:
        self._h = np.zeros((1, 1, 128), dtype=np.float32)
        self._c = np.zeros((1, 1, 128), dtype=np.float32)
        self._context = np.zeros(_CONTEXT, dtype=np.float32)

    def __call__(self, window: np.ndarray) -> float:
        window = np.asarray(window, dtype=np.float32)
        x = np.concatenate([self._context, window])[None, :]
        prob, self._h, self._c = self.session.run(None, {"input": x, "h": self._h, "c": self._c})
        self._context = window[-_CONTEXT:]
        return float(np.asarray(prob).reshape(-1)[0])


class VADIterator:
    """Stream imitation over 512-sample windows (silero utils_vad.py, MIT)."""

    def __init__(self, model, threshold: float = 0.5, sampling_rate: int = 16000,
                 min_silence_duration_ms: int = 500, speech_pad_ms: int = 100):
        self.model = model
        self.threshold = threshold
        self.sampling_rate = sampling_rate
        self.min_silence_samples = sampling_rate * min_silence_duration_ms / 1000
        self.speech_pad_samples = sampling_rate * speech_pad_ms / 1000
        self.reset_states()

    def reset_states(self) -> None:
        self.model.reset_states()
        self.triggered = False
        self.temp_end = 0
        self.current_sample = 0

    def _step(self, window: np.ndarray):
        n = len(window)
        self.current_sample += n
        prob = self.model(window)
        if prob >= self.threshold and self.temp_end:
            self.temp_end = 0
        if prob >= self.threshold and not self.triggered:
            self.triggered = True
            return {"start": int(max(0, self.current_sample - self.speech_pad_samples - n))}
        if prob < self.threshold - 0.15 and self.triggered:
            if not self.temp_end:
                self.temp_end = self.current_sample
            if self.current_sample - self.temp_end < self.min_silence_samples:
                return None
            speech_end = self.temp_end + self.speech_pad_samples - n
            self.temp_end = 0
            self.triggered = False
            return {"end": int(speech_end)}
        return None


class FixedVADIterator(VADIterator):
    """Any audio length in; at most one merged start/end out (ufal, MIT)."""

    def reset_states(self) -> None:
        super().reset_states()
        self.buffer = np.array([], dtype=np.float32)

    def __call__(self, x):
        self.buffer = np.append(self.buffer, x)
        ret = None
        while len(self.buffer) >= _WINDOW:
            r = self._step(self.buffer[:_WINDOW])
            self.buffer = self.buffer[_WINDOW:]
            if ret is None:
                ret = r
            elif r is not None:
                if "end" in r:
                    ret["end"] = r["end"]
                if "start" in r and "end" in ret:
                    del ret["end"]
        return ret if ret != {} else None
