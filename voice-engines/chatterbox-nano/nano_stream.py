#!/usr/bin/env python3
"""Chatterbox Nano, streamed on the CPU — the one-voice LIGHT tier spike.

    from nano_stream import generate_stream
    for pcm in generate_stream("Hey, you're back.", "ref.wav"):   # float32 mono 24 kHz chunks
        play(pcm)

Upstream (resemble-ai/chatterbox @5de7a54, MIT) has no streaming API: T3 (GPT-2
small) samples every speech token, then S3Gen (mean-flow mel decoder + HiFT
vocoder) decodes the whole utterance once. This module adds (defaults = the
best measured config; see bench.py / final.sh):

  * voice prefix cache — the conditioning prefix (speaker vector + up to 375
    reference speech tokens) is prefilled ONCE per voice; each utterance only
    prefills its text tokens.
  * token streaming — tokens are decoded in chunks (20, 20, 40, 80, 100...) as
    they are sampled. Each chunk re-runs the flow decoder on [last 100 prompt
    tokens + last 50 emitted tokens + new tokens] with ONE fixed noise tensor
    per utterance, keeps only the new frames (minus the 3-token lookahead), and
    vocodes them with HiFT's mel/source cache and a crossfade over the overlap.
    This is the CosyVoice2 token2wav streaming scheme (FunAudioLLM/CosyVoice,
    cosyvoice/cli/model.py, Apache-2.0; re-implemented here, not copied; S3Gen
    is itself "modified from CosyVoice" upstream). Differences: a raised-cosine
    complementary crossfade instead of np.hamming, and the decoder runs 1
    mean-flow step instead of upstream's 2 (A/B in the spike notes).
  * pipelining — T3 samples on a second thread while the decoder works.
  * an ONNX Runtime language model for the per-token loop
    (KitsuMate/chatterbox-nano-v2-onnx, MIT: GPT-2 with ORT fused attention,
    INT8 weight-only in layers 4-11); everything else stays PyTorch.
  * clause chunking ("clause") and the stock path ("whole") for comparison.

No GPU, ever: CUDA is hidden before torch is imported. No Perth watermark is
applied to streamed chunks (upstream watermarks whole clips; ~10 ms per clip).
"""
from __future__ import annotations

import copy
import os
import queue
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

os.environ["CUDA_VISIBLE_DEVICES"] = ""
_HERE = Path(__file__).resolve().parent
# the shell may carry another HF_HOME; the voice weights live in the repo-local cache
os.environ["HF_HOME"] = os.environ.get("NANO_HF_HOME", str(_HERE.parent / "_models" / "_hf_cache"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("TQDM_DISABLE", "1")

import numpy as np  # noqa: E402
import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402

SR = 24000
MEL_PER_TOKEN = 2          # 25 Hz tokens -> 50 Hz mel
SAMPLES_PER_MEL = 480      # HiFT: 24 kHz / 50 Hz
MEL_CACHE = 8              # mel frames of vocoder overlap (CosyVoice2 value)
SRC_CACHE = MEL_CACHE * SAMPLES_PER_MEL
# Crossfade over the vocoder overlap. CosyVoice2 uses np.hamming(2*SRC_CACHE), whose halves do not
# sum to 1 (0.08 floor -> ~8% level bump at both ends of the fade); a power-complementary-in-amplitude
# raised cosine (fade_in + fade_out == 1 everywhere) avoids that. NANO_HAMMING=1 restores CosyVoice's.
if os.environ.get("NANO_HAMMING") == "1":
    WINDOW = np.hamming(2 * SRC_CACHE).astype(np.float32)
else:
    _fi = (0.5 - 0.5 * np.cos(np.pi * np.arange(SRC_CACHE) / SRC_CACHE)).astype(np.float32)
    WINDOW = np.concatenate([_fi, 1.0 - _fi])   # [:h] fade-in for the new chunk, [h:] fade-out for the cached tail
LOOKAHEAD = 3              # flow pre_lookahead_len (tokens)
SPEECH_VOCAB = 6561
START_SPEECH, STOP_SPEECH, SIL = 6561, 6562, 4299
ORT_DIR = _HERE / "_onnx" / "v2" / "onnx"

TAGS = {"laugh": "[laugh]", "chuckle": "[chuckle]", "sigh": "[sigh]", "gasp": "[gasp]"}


def translate_cues(text: str) -> str:
    """lines.json {cue} -> Nano's native [cue] tokens; cues without a token are dropped."""
    out = re.sub(r"\{(\w+)\}", lambda m: TAGS.get(m.group(1), ""), text)
    return " ".join(out.split())


def split_clauses(text: str, first_max_words: int = 6) -> list[str]:
    """Sentences, and the first sentence further cut at its first comma/dash if long."""
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    if not sents:
        return [text]
    first = sents[0]
    if len(first.split()) > first_max_words:
        m = re.search(r"[,;—-]\s", first)
        if m and len(first[: m.start()].split()) >= 2:
            sents = [first[: m.start() + 1].strip(), first[m.end():].strip()] + sents[1:]
    return sents


# ---------------------------------------------------------------- language-model backends

class TorchLM:
    """GPT-2 small from the upstream T3, KV cache from transformers."""

    name = "torch"

    def __init__(self, t3):
        self.t3 = t3

    @torch.inference_mode()
    def prefill(self, embeds: torch.Tensor, past=None):
        out = self.t3.tfmr(inputs_embeds=embeds, past_key_values=past, use_cache=True)
        return self.t3.speech_head(out[0][:, -1:])[:, -1].float(), out.past_key_values

    def step(self, token: torch.Tensor, past):
        return self.prefill(self.t3.speech_emb(token), past)

    @staticmethod
    def fork(past):
        return copy.deepcopy(past)


class OrtLM:
    """GPT-2 small as an ONNX Runtime graph (KitsuMate v2 int8_mixed by default).

    The graph takes inputs_embeds, so the PyTorch T3 embeddings (text, speech,
    conditioning) feed it unchanged and the voice prefix cache is shared.
    """

    name = "ort"

    def __init__(self, t3, threads: int, graph: str = "language_model_int8_mixed.onnx"):
        import onnxruntime as ort
        self.t3 = t3
        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        so.inter_op_num_threads = 1
        so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        # ORT's pool spin-waits after each run by default; torch (OpenMP) runs the
        # sampler and decoder on the same cores between LM steps, so spinning
        # threads would steal them. Park instead.
        so.add_session_config_entry("session.intra_op.allow_spinning", os.environ.get("NANO_ORT_SPIN", "0"))
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.sess = ort.InferenceSession(str(ORT_DIR / graph), so, providers=["CPUExecutionProvider"])
        self.inputs = {i.name: i for i in self.sess.get_inputs()}
        self.outputs = [o.name for o in self.sess.get_outputs()]
        self.past_names = [n for n in self.inputs if "past" in n]
        self.graph = graph

    def _feed(self, embeds: np.ndarray, past: dict | None):
        b, n, _ = embeds.shape
        plen = 0 if not past else next(iter(past.values())).shape[2]
        feed = {"inputs_embeds": embeds.astype(np.float32)}
        if "attention_mask" in self.inputs:
            feed["attention_mask"] = np.ones((b, plen + n), dtype=np.int64)
        if "position_ids" in self.inputs:
            feed["position_ids"] = np.arange(plen, plen + n, dtype=np.int64)[None]
        for name in self.past_names:
            if past:
                feed[name] = past[name]
            else:
                shp = self.inputs[name].shape
                dt = np.float16 if "float16" in self.inputs[name].type else np.float32
                feed[name] = np.zeros((b, shp[1] if isinstance(shp[1], int) else 12, 0,
                                       shp[3] if isinstance(shp[3], int) else 64), dtype=dt)
        return feed

    @torch.inference_mode()
    def prefill(self, embeds: torch.Tensor, past=None):
        outs = self.sess.run(None, self._feed(embeds.float().numpy(), past))
        res = dict(zip(self.outputs, outs))
        logits = res[self.outputs[0]]
        present = {}
        for name in self.past_names:
            pres = name.replace("past_key_values", "present")
            present[name] = res[pres]
        return torch.from_numpy(np.ascontiguousarray(logits[:, -1])).float(), present

    def step(self, token: torch.Tensor, past):
        return self.prefill(self.t3.speech_emb(token), past)

    @staticmethod
    def fork(past):
        return dict(past)  # arrays are never mutated in place: a shallow copy is a fork


# ---------------------------------------------------------------- engine

@dataclass
class Voice:
    conds: object             # chatterbox Conditionals
    prefix_len: int
    past: object              # LM cache after the conditioning prefix
    prefix_logits_src: str = ""


@dataclass
class StreamStats:
    t0: float = 0.0
    first_audio_s: float | None = None
    chunk_ready_s: list = field(default_factory=list)
    chunk_samples: list = field(default_factory=list)
    tokens: int = 0
    token_ids: list = field(default_factory=list)   # last token stream (for seam checks)
    noise: object = None
    t3_s: float = 0.0
    dec_s: float = 0.0
    total_s: float = 0.0


class NanoStream:
    def __init__(self, threads: int = 8, lm: str = "auto", ort_graph: str = "language_model_int8_mixed.onnx",
                 temperature: float = 0.8, top_k: int = 1000, top_p: float = 0.95,
                 repetition_penalty: float = 1.2, max_tokens: int = 1000, flow_prompt_tokens: int | None = 100,
                 flow_window: int = 50, pipeline: bool = True, lm_threads: int | None = None,
                 flow_steps: int = 1, flat_chunks: int = 2):
        """Defaults = the spike's best measured CPU config. threads: total CPU threads.
        lm: 'ort' (ONNX int8 LM, needs _onnx/), 'torch', or 'auto' (ort if present).
        pipeline: sample T3 tokens on a second thread while the decoder works (lm_threads
        for the LM, the rest for the decoder). Upstream-equivalent decoding:
        flow_prompt_tokens=None, flow_window=0, flow_steps=2, pipeline=False."""
        if lm == "auto":
            lm = "ort" if (ORT_DIR / ort_graph).exists() else "torch"
        # oneDNN re-JITs conv kernels per input shape, and HiFT's stft/conv path showed
        # multi-second stalls with it on this CPU; the native kernels are as fast for
        # the flow and stable for HiFT (see bench notes). NANO_MKLDNN=1 re-enables.
        torch.backends.mkldnn.enabled = os.environ.get("NANO_MKLDNN") == "1"
        self.pipeline = pipeline
        self.drain = os.environ.get("NANO_DRAIN") == "1"   # pipelined: decode all ready tokens, not the schedule
        self.hold_first = os.environ.get("NANO_HOLD_FIRST", "1") == "1"  # pipelined: pause T3 during chunk 1
        self.flat_chunks = flat_chunks   # chunks kept at first_tokens before the schedule grows
        if pipeline:
            import sys
            sys.setswitchinterval(float(os.environ.get("NANO_SWITCH", "0.001")))  # GIL hand-off between the two loops
        self.lm_threads = lm_threads or (max(1, threads // 3) if pipeline else threads)
        self.dec_threads = max(1, threads - self.lm_threads) if pipeline else threads
        torch.set_num_threads(self.dec_threads)
        if not getattr(NanoStream, "_interop_set", False):
            torch.set_num_interop_threads(1)
            NanoStream._interop_set = True
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        import chatterbox.models.s3gen.flow_matching as _fm
        _fm.print = lambda *a, **k: None   # silence the per-call […] print
        self.threads = threads
        # Streaming re-runs the flow decoder (full attention over prompt + tokens) once
        # per chunk; its cost is dominated by the reference prompt (10 s = 250 tokens).
        # None keeps upstream's full prompt; N keeps the last N prompt tokens.
        self.flow_prompt_tokens = flow_prompt_tokens
        # 0 = re-run the flow over every generated token so far; N = only the last N
        # already-emitted tokens as left context (bounds cost on long turns).
        self.flow_window = flow_window
        self.flow_steps = flow_steps   # mean-flow Euler steps; upstream Turbo/Nano use 2
        self.model = ChatterboxTurboTTS.from_pretrained(device="cpu", nano=True)
        self.t3 = self.model.t3
        self.s3 = self.model.s3gen
        self.lm = OrtLM(self.t3, self.lm_threads, ort_graph) if lm == "ort" else TorchLM(self.t3)
        self.kw = dict(temperature=temperature, top_k=top_k, top_p=top_p, repetition_penalty=repetition_penalty)
        self.max_tokens = max_tokens
        self.voices: dict[str, Voice] = {}
        self.trim_fade = self.s3.trim_fade.numpy()

    # ------------------------------------------------------------ voice
    @torch.inference_mode()
    def voice(self, ref_wav: str | Path) -> Voice:
        key = str(Path(ref_wav).resolve())
        if key in self.voices:
            return self.voices[key]
        self.model.prepare_conditionals(key, norm_loudness=True)
        conds = self.model.conds
        cond_emb = self.t3.prepare_conditioning(conds.t3)          # (1, 376, 768)
        _, past = self.lm.prefill(cond_emb)
        v = Voice(conds=conds, prefix_len=cond_emb.size(1), past=past)
        self.voices[key] = v
        return v

    # ------------------------------------------------------------ T3
    def _sample(self, logits: torch.Tensor, seen: torch.Tensor) -> int:
        """Upstream's HF processor chain (temperature -> top-k -> top-p -> repetition
        penalty, in that order) computed on the top-k slice only: same distribution,
        a fraction of the cost of sorting the full 6563-way vocabulary every step."""
        temp, k, top_p, rp = (self.kw["temperature"], self.kw["top_k"], self.kw["top_p"],
                              self.kw["repetition_penalty"])
        x = logits[0] / temp if temp > 0 and temp != 1.0 else logits[0]
        vals, idx = torch.topk(x, min(k, x.numel()) if k > 0 else x.numel())    # descending
        if top_p < 1.0:  # HF TopP: drop the low tail whose cumulative mass <= 1 - top_p
            asc = torch.flip(vals, (0,))
            cum = torch.softmax(asc, 0).cumsum(0)
            remove = cum <= (1 - top_p)
            remove[-1] = False
            vals = torch.flip(asc.masked_fill(remove, float("-inf")), (0,))
        if rp != 1.0:
            hit = seen[idx]
            vals = torch.where(hit, torch.where(vals < 0, vals * rp, vals / rp), vals)
        j = torch.multinomial(torch.softmax(vals, 0), 1)
        return int(idx[j])

    @torch.inference_mode()
    def tokens(self, text: str, v: Voice) -> Iterator[int]:
        """Sample speech tokens one at a time (same sampler as upstream inference_turbo)."""
        from chatterbox.tts_turbo import punc_norm
        text = punc_norm(text)
        ids = self.model.tokenizer(text, return_tensors="pt").input_ids
        start = torch.full((1, 1), START_SPEECH, dtype=torch.long)
        embeds = torch.cat([self.t3.text_emb(ids), self.t3.speech_emb(start)], dim=1)
        logits, past = self.lm.prefill(embeds, self.lm.fork(v.past))
        seen = torch.zeros(logits.shape[-1], dtype=torch.bool)
        seen[START_SPEECH] = True  # upstream passes the start token as history for the first step only
        first = True
        for _ in range(self.max_tokens):
            t = self._sample(logits, seen)
            if first:
                seen[START_SPEECH] = False
                first = False
            if t == STOP_SPEECH:
                return
            seen[t] = True
            if t < SPEECH_VOCAB:
                yield t
            logits, past = self.lm.step(torch.tensor([[t]]), past)

    # ------------------------------------------------------------ S3Gen streaming decode
    @torch.inference_mode()
    def _flow(self, toks: list[int], v: Voice, noise: torch.Tensor, finalize: bool,
              finalize_whole: bool = False) -> torch.Tensor:
        # Upstream's finalize=False branch trims h but not its mask (shape error at
        # 5de7a54), so decode everything with finalize=True and drop the frames of
        # the last LOOKAHEAD tokens ourselves: the frames we keep still saw their
        # full lookahead. Frames are emitted once, so the trimmed tail is redone
        # next chunk with real right context.
        ref = v.conds.gen
        if self.flow_prompt_tokens and not finalize_whole:
            k = min(self.flow_prompt_tokens, ref["prompt_token"].shape[1])
            ref = dict(ref, prompt_token=ref["prompt_token"][:, -k:], prompt_token_len=torch.tensor([k]),
                       prompt_feat=ref["prompt_feat"][:, -MEL_PER_TOKEN * k:])
        tok = torch.tensor([toks], dtype=torch.long)
        n_mel = MEL_PER_TOKEN * len(toks)
        mel, _ = self.s3.flow.inference(
            token=tok, token_len=torch.tensor([len(toks)]),
            prompt_token=ref["prompt_token"], prompt_token_len=ref["prompt_token_len"],
            prompt_feat=ref["prompt_feat"], prompt_feat_len=ref["prompt_feat_len"],
            embedding=ref["embedding"], finalize=True,
            n_timesteps=2 if finalize_whole else self.flow_steps,
            noised_mels=noise[:, :, :n_mel], meanflow=True)
        return mel if finalize else mel[:, :, : n_mel - MEL_PER_TOKEN * LOOKAHEAD]

    def stream(self, text: str, ref_wav: str | Path, mode: str = "token", first_tokens: int = 20,
               growth: float = 2.0, max_chunk: int = 100, stats: StreamStats | None = None,
               seed: int | None = None) -> Iterator[np.ndarray]:
        stats = stats if stats is not None else StreamStats()
        stats.t0 = time.perf_counter()
        if seed is not None:
            torch.manual_seed(seed)
        v = self.voice(ref_wav)
        if mode == "whole":   # upstream behaviour: every token, then one decode (the baseline)
            yield from self._emit(stats, self._whole(text, v, stats, first=True))
        elif mode == "clause":
            parts = split_clauses(text)
            for i, part in enumerate(parts):
                yield from self._emit(stats, self._whole(part, v, stats, first=(i == 0)))
        elif mode == "sentence-token":
            for i, part in enumerate(split_clauses(text, first_max_words=10**6)):
                yield from self._token_stream(part, v, first_tokens, growth, max_chunk, stats, first=(i == 0))
        else:
            yield from self._token_stream(text, v, first_tokens, growth, max_chunk, stats, first=True)
        stats.total_s = time.perf_counter() - stats.t0

    def _emit(self, stats: StreamStats, pcm: np.ndarray) -> Iterator[np.ndarray]:
        if pcm.size == 0:
            return
        now = time.perf_counter() - stats.t0
        if stats.first_audio_s is None:
            stats.first_audio_s = now
        stats.chunk_ready_s.append(now)
        stats.chunk_samples.append(int(pcm.size))
        yield pcm

    @torch.inference_mode()
    def _whole(self, text: str, v: Voice, stats: StreamStats, first: bool) -> np.ndarray:
        t = time.perf_counter()
        toks = list(self.tokens(text, v))
        stats.t3_s += time.perf_counter() - t
        stats.tokens += len(toks)
        t = time.perf_counter()
        toks += [SIL] * 3
        noise = torch.randn(1, 80, MEL_PER_TOKEN * len(toks))
        mel = self._flow(toks, v, noise, finalize=True, finalize_whole=True)
        wav, _ = self.s3.mel2wav.inference(speech_feat=mel, cache_source=torch.zeros(1, 1, 0))
        wav = wav.squeeze(0).numpy().astype(np.float32)
        if first:
            wav[: self.trim_fade.size] *= self.trim_fade
        stats.dec_s += time.perf_counter() - t
        return wav

    def _producer(self, text: str, v: Voice, stats: StreamStats, stop: threading.Event,
                  hold: threading.Event | None = None):
        """Token source. Inline: a generator on this thread. Pipelined: a thread feeding a queue
        (it stops sampling as soon as `stop` is set, e.g. the listener barged in)."""
        if not self.pipeline:
            gen = self.tokens(text, v)

            def get(block=True):
                if not block:
                    return _EMPTY
                t = time.perf_counter()
                try:
                    return next(gen)
                except StopIteration:
                    return None
                finally:
                    stats.t3_s += time.perf_counter() - t
            return get

        q: queue.Queue = queue.Queue()

        def run():
            torch.set_num_threads(1)          # sampler ops; the LM has its own ORT pool
            t = time.perf_counter()
            try:
                for tok in self.tokens(text, v):
                    if stop.is_set():
                        break
                    q.put(tok)
                    if hold is not None and hold.is_set():   # first chunk decoding: give it the CPU
                        t_h = time.perf_counter()
                        while hold.is_set() and not stop.is_set():
                            time.sleep(0.002)
                        t += time.perf_counter() - t_h   # paused time is not T3 time
            except BaseException as e:  # surface on the consumer side
                q.put(e)
            stats.t3_s += time.perf_counter() - t
            q.put(None)

        threading.Thread(target=run, daemon=True, name="nano-t3").start()

        def get(block=True):
            try:
                x = q.get(block=block)
            except queue.Empty:
                return _EMPTY
            if isinstance(x, BaseException):
                raise x
            return x
        return get

    @torch.inference_mode()
    def _token_stream(self, text: str, v: Voice, first_tokens: int, growth: float, max_chunk: int,
                      stats: StreamStats, first: bool) -> Iterator[np.ndarray]:
        noise = torch.randn(1, 80, MEL_PER_TOKEN * (self.max_tokens + 8))
        stats.noise = noise
        stop = threading.Event()
        hold = threading.Event() if self.pipeline and self.hold_first else None
        get = self._producer(text, v, stats, stop, hold)
        try:
            yield from self._chunks(get, v, noise, first_tokens, growth, max_chunk, stats, first, hold)
        finally:
            stop.set()

    @torch.inference_mode()
    def _chunks(self, get, v: Voice, noise: torch.Tensor, first_tokens: int, growth: float, max_chunk: int,
                stats: StreamStats, first: bool, hold: threading.Event | None = None) -> Iterator[np.ndarray]:
        toks: list[int] = []
        mel_done = 0                      # gen mel frames already handed to the vocoder
        cache = None                      # (mel tail, source tail, speech tail)
        target = first_tokens + LOOKAHEAD
        step = float(first_tokens)
        n_chunks = 0
        is_first_chunk = first

        def vocode(new_mel: torch.Tensor, final: bool) -> np.ndarray:
            nonlocal cache, is_first_chunk
            if cache is not None:
                new_mel = torch.cat([cache[0], new_mel], dim=2)
                src = cache[1]
            else:
                src = torch.zeros(1, 1, 0)
            wav, s = self.s3.mel2wav.inference(speech_feat=new_mel, cache_source=src)
            wav = wav.squeeze(0).numpy().astype(np.float32).copy()
            if cache is not None:  # CosyVoice2 fade_in_out over the overlap
                h = SRC_CACHE
                wav[:h] = wav[:h] * WINDOW[:h] + cache[2] * WINDOW[h:]
            if is_first_chunk:
                wav[: self.trim_fade.size] *= self.trim_fade
                is_first_chunk = False
            if final:
                cache = None
                return wav
            cache = (new_mel[:, :, -MEL_CACHE:], s[:, :, -SRC_CACHE:], wav[-SRC_CACHE:].copy())
            return wav[:-SRC_CACHE]

        def flow_window(tk: list[int], final: bool) -> torch.Tensor:
            """Mel for tk[mel_done/2:], computed with a bounded left context."""
            s0 = 0
            if self.flow_window:
                s0 = max(0, mel_done // MEL_PER_TOKEN - self.flow_window)
            mel = self._flow(tk[s0:], v, noise[:, :, MEL_PER_TOKEN * s0:], finalize=final)
            return mel[:, :, mel_done - MEL_PER_TOKEN * s0:]

        done = False
        while not done:
            while len(toks) < target and not done:          # wait for this chunk's tokens
                x = get()
                if x is None:
                    done = True
                else:
                    toks.append(x)
            while self.drain and not done:                   # plus whatever is already sampled
                x = get(block=False)
                if x is _EMPTY:
                    break
                if x is None:
                    done = True
                else:
                    toks.append(x)
            if hold is not None and not done and mel_done == 0:
                hold.set()
            t_dec = time.perf_counter()
            if done:
                stats.tokens += len(toks)
                stats.token_ids = list(toks)
                new = flow_window(toks + [SIL] * 3, final=True)
                pcm = vocode(new, final=True) if new.shape[2] or cache is not None else np.zeros(0, np.float32)
            else:
                new = flow_window(toks, final=False)
                pcm = vocode(new, final=False)
                mel_done += new.shape[2]
                n_chunks += 1
                if n_chunks >= self.flat_chunks:   # first `flat_chunks` chunks stay at first_tokens
                    step = min(step * growth, max_chunk)
                target = len(toks) + int(step)
            stats.dec_s += time.perf_counter() - t_dec
            if hold is not None:
                hold.clear()
            yield from self._emit(stats, pcm)


_EMPTY = object()


_DEFAULT: NanoStream | None = None


def generate_stream(text: str, ref_wav: str | Path, **kw) -> Iterator[np.ndarray]:
    """Iterator of float32 mono 24 kHz PCM chunks. Engine kwargs: threads, lm ('torch'|'ort')."""
    global _DEFAULT
    eng_kw = {k: kw.pop(k) for k in ("threads", "lm", "ort_graph", "flow_prompt_tokens", "flow_window",
                                      "pipeline", "lm_threads", "flow_steps", "flat_chunks") if k in kw}
    if _DEFAULT is None:
        _DEFAULT = NanoStream(**eng_kw)
    return _DEFAULT.stream(translate_cues(text), ref_wav, **kw)
