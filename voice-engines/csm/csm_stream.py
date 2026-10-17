"""Neuma voice engine — streaming Sesame CSM generator (Phase 0 spike, docs/work/one-voice.md).

One implementation for both tiers of the same architecture (Sesame CSM: a Llama backbone that
predicts Mimi codebook 0 per 80 ms frame + a small "depth" decoder that predicts codebooks 1..31):

  csm-1b      Sesame CSM-1B (1B backbone + 100M decoder), weights: unsloth/csm-1b
              (ungated Apache-2.0 mirror of sesame/csm-1b, transformers layout)
  misotts-8b  MisoTTS 8B (8B backbone + 300M decoder), weights: MisoLabs/MisoTTS
              (torchtune layout, interleaved RoPE -> permuted here to rotate-half)

Why this is fast (vs. the bake-off path, RTF 1.4-5.6):
  * plain-PyTorch Llama blocks with a STATIC KV cache (fixed 2048 positions, masked by position),
  * the whole per-frame step — depth decoder (31 sequential codebooks) + sampling + the next
    backbone token — is ONE CUDA graph (optionally torch.compile'd first for kernel fusion), so
    the ~3k tiny kernels per frame cost one launch,
  * frame-by-frame Mimi decode in moshi's streaming mode (its own CUDA-graphed conv/transformer
    state), so audio leaves after the first frames instead of after the whole utterance.

Design ideas follow Sesame's reference generator (github.com/SesameAILabs/csm, Apache-2.0) and
davidbrowne17/csm-streaming (Apache-2.0, commit 121552fc: torch.compile'd backbone/decoder +
moshi streaming Mimi decode). No code is copied from either verbatim; the sampling function
mirrors Sesame's `sample_topk` (Apache-2.0, Copyright Sesame AI Labs) semantics.

Options: compile=True (torch.compile the frame step before capture; ~1.5-5 min cold, cached after),
quant="int8" (weight-only int8 LM linears via int8_gemv.py — the MisoTTS speed path).

Small-footprint / CPU options (Light-tier feasibility; every default below reproduces the Standard/High
path byte for byte):
  kv_len=N          backbone static KV window (default MAX_SEQ = 2048 positions; prompt + reply must fit)
  lean=True         drop the unused half of each Mimi instance (decoder of the encoder, encoder of the
                    decoder), keep the 128k-row text-embedding table on the CPU (prefill-only gather),
                    and fold the depth decoder's input projection per step instead of a pre-projected table;
                    with an int quant also int8 audio embeddings + codebook heads; all prep on the CPU (load
                    peak = steady state); chunked prompt embedding; empty_cache() after warm-up
  mimi_dtype="bf16" / "fp16"   Mimi weights in half precision (default fp32)
  mimi_enc_device="cpu"        encode reference / context audio on the CPU (one-time per clip)
  quant="int4"      group-128 weight-only int4 (int8_gemv.gemv_i4, GPU); "int4/int8" = int4 backbone + int8
                    depth decoder (int4 in the decoder costs timbre: speaker-sim 0.79 vs 0.88)
  Measured smallest real-time footprint (csm-1b-small/gpu-int8-lean): quant="int8", kv_len=1024, lean=True,
  mimi_dtype="bf16", mimi_enc_device="cpu", env PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
  -> 1.44 GB allocated, 2.46 GB process total (nvidia-smi, incl. a 0.68 GB CUDA context on a 188-SM card).
  device="cpu"      no CUDA at all: eager frame step (or torch.compile'd), fp32 activations by default;
                    quant="int8" -> weight-only int8 (torch._weight_int8pack_mm),
                    quant="dyn8" -> PyTorch dynamic int8 (int8 activations too, x86/fbgemm kernels)

Mimi weights (moshi layout, gitignored): voice-engines/csm/_weights/, fetched once with
  curl -L -o _weights/mimi-tokenizer-e351c8d8-checkpoint125.safetensors \
    https://huggingface.co/kyutai/moshiko-pytorch-bf16/resolve/main/tokenizer-e351c8d8-checkpoint125.safetensors
  (sha256 09b782f0629851a271227fb9d36db65c041790365f11bbe5d3d59369cf863f50; Mimi = CC-BY-4.0)

API:
  for pcm in generate_stream(text, speaker, context): ...   # module-level, lazily loads csm-1b
  gen = CsmStream("csm-1b")                      # load + capture (warm-up)
  for pcm in gen.generate_stream(text, speaker, context):   # context: list[Segment]
      ...                                        # pcm: np.float32 mono @ 24 kHz
  gen.last_codes                                 # codes of the utterance just spoken (reuse as context)
"""

from __future__ import annotations

import hashlib
import math
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import numpy as np
import torch
import torch.nn.functional as F

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
HF_CACHE = REPO / "voice-engines" / "_models" / "_hf_cache"
MIMI_WEIGHTS = HERE / "_weights" / "mimi-tokenizer-e351c8d8-checkpoint125.safetensors"

SR = 24_000
FRAME_SAMPLES = 1920  # Mimi 12.5 Hz
NCB = 32
AUDIO_VOCAB = 2051
TEXT_VOCAB = 128_256
MAX_SEQ = 2048


# ------------------------------------------------------------------------------------ config

@dataclass(frozen=True)
class LMCfg:
    dim: int
    layers: int
    heads: int
    kv_heads: int
    hidden: int

    @property
    def head_dim(self) -> int:
        return self.dim // self.heads


@dataclass(frozen=True)
class ModelCfg:
    name: str
    backbone: LMCfg
    decoder: LMCfg
    speaker_space: bool  # MisoTTS tokenises "[0] text", Sesame "[0]text"


MODELS = {
    "csm-1b": ModelCfg("csm-1b", LMCfg(2048, 16, 32, 8, 8192), LMCfg(1024, 4, 8, 2, 8192), False),
    "misotts-8b": ModelCfg("misotts-8b", LMCfg(4096, 32, 32, 8, 14336), LMCfg(1536, 8, 24, 6, 6912), True),
}


def _snapshot(repo: str) -> Path:
    """The snapshot `refs/main` names (HF cache layout); sorted-last only when there is no ref."""
    root = HF_CACHE / "hub" / f"models--{repo.replace('/', '--')}"
    ref = root / "refs" / "main"
    if ref.is_file() and (root / "snapshots" / ref.read_text().strip()).is_dir():
        return root / "snapshots" / ref.read_text().strip()
    snaps = sorted((root / "snapshots").iterdir())
    if not snaps:
        raise FileNotFoundError(root / "snapshots")
    return snaps[-1]


# ------------------------------------------------------------------------------------ RoPE

def llama3_rope(head_dim: int, max_seq: int, device) -> tuple[torch.Tensor, torch.Tensor]:
    """Llama-3 scaled RoPE (torchtune Llama3ScaledRoPE: base 5e5, scale 32, low 1, high 4, old ctx 8192)."""
    base, scale, low, high, old = 500_000.0, 32.0, 1.0, 4.0, 8192
    inv = 1.0 / (base ** (torch.arange(0, head_dim, 2, dtype=torch.float64)[: head_dim // 2] / head_dim))
    wavelen = 2 * math.pi / inv
    lo_wl, hi_wl = old / low, old / high
    smooth = (old / wavelen - low) / (high - low)
    scaled = torch.where(wavelen > lo_wl, inv / scale, inv)
    mid = (wavelen <= lo_wl) & (wavelen >= hi_wl)
    scaled = torch.where(mid, (1 - smooth) * inv / scale + smooth * inv, scaled)
    t = torch.arange(max_seq, dtype=torch.float64)
    ang = torch.outer(t, scaled)  # (S, hd/2)
    ang = torch.cat([ang, ang], dim=-1)  # rotate-half layout
    return ang.cos().float().to(device), ang.sin().float().to(device)


def _rot_half(x):
    a, b = x.chunk(2, dim=-1)
    return torch.cat([-b, a], dim=-1)


def apply_rope(x, cos, sin):
    # x (B, H, S, hd) bf16; cos/sin (S, hd) fp32
    xf = x.float()
    return (xf * cos + _rot_half(xf) * sin).to(x.dtype)


def rms_norm(x, w, eps=1e-5):
    xf = x.float()
    return (xf * torch.rsqrt(xf.pow(2).mean(-1, keepdim=True) + eps)).to(x.dtype) * w


# ------------------------------------------------------------------------------------ model

class Llama:
    """Weights-only Llama stack with a static KV cache. Not an nn.Module (no autograd, no hooks)."""

    def __init__(self, cfg: LMCfg, cache_len: int, device, dtype):
        self.cfg = cfg
        self.L: list[dict[str, torch.Tensor]] = [dict() for _ in range(cfg.layers)]
        self.norm: torch.Tensor | None = None
        shape = (cfg.layers, 1, cfg.kv_heads, cache_len, cfg.head_dim)
        self.k = torch.zeros(shape, device=device, dtype=dtype)
        self.v = torch.zeros(shape, device=device, dtype=dtype)
        self.cos, self.sin = llama3_rope(cfg.head_dim, MAX_SEQ, device)
        self.cache_len = cache_len
        self.device = device
        self.dtype = dtype

    def finalize(self, quant: str | None = None, quant_on_cpu: bool = False):
        # layer weights arrive on the CPU; move ONE layer at a time to the GPU, fuse q/k/v and gate/up
        # (fewer, larger GEMVs per token) and optionally quantise, so the load peak is ~one layer of bf16.
        # quant_on_cpu: quantise first, upload only the int8 bytes (no fp32 transients on the GPU)
        for l in self.L:
            if not quant_on_cpu:
                for k in list(l):
                    l[k] = l[k].to(self.device)
            l["wqkv"] = torch.cat([l.pop("wq"), l.pop("wk"), l.pop("wv")], 0).contiguous()
            l["w13"] = torch.cat([l.pop("w1"), l.pop("w3")], 0).contiguous()
            if quant == "int8":
                # weight-only int8, symmetric per output channel: half the bytes per token. Decode uses the
                # Triton GEMV in int8_gemv.py (inductor's own int8 path measured 4x SLOWER here).
                for name in ("wqkv", "w13", "wo", "w2"):
                    w = l[name].float()
                    scale = w.abs().amax(dim=1).clamp(min=1e-8) / 127.0
                    l[name] = torch.round(w / scale[:, None]).clamp(-127, 127).to(torch.int8).contiguous()
                    l[name + "_s"] = scale.to(self.dtype)
                    del w
            elif quant == "int4":
                # weight-only int4, group-wise (int8_gemv.quantize_i4): a quarter of bf16's bytes
                from int8_gemv import quantize_i4

                if self.device.type != "cuda":
                    raise ValueError("int4 is GPU-only here")
                for name in ("wqkv", "w13", "wo", "w2"):
                    l[name], sc = quantize_i4(l[name])
                    l[name + "_s"] = sc.to(self.dtype)
            elif quant == "dyn8":
                # PyTorch dynamic quantisation (CPU only): int8 weights per channel, activations quantised
                # per call; fbgemm/x86 packed GEMM. Activations must be fp32.
                for name in ("wqkv", "w13", "wo", "w2"):
                    w = l[name].float()
                    scale = (w.abs().amax(dim=1).clamp(min=1e-8) / 127.0).double()
                    q = torch.quantize_per_channel(w, scale, torch.zeros_like(scale, dtype=torch.long), 0, torch.qint8)
                    l[name] = torch.ops.quantized.linear_prepack(q, None)
                    del w, q
            if quant_on_cpu:
                for k in list(l):
                    if isinstance(l[k], torch.Tensor):
                        l[k] = l[k].to(self.device)
        self.quant = quant

    def lin(self, x, l, name):
        w = l[name]
        if not isinstance(w, torch.Tensor):  # quant="dyn8": prepacked dynamic-int8 params (CPU)
            return torch.ops.quantized.linear_dynamic(x, w)
        if w.dtype == torch.int8 and w.device.type == "cpu":  # weight-only int8 on the CPU
            y = torch._weight_int8pack_mm(x.reshape(-1, x.size(-1)), w, l[name + "_s"])
            return y.view(*x.shape[:-1], w.size(0))
        if w.dtype == torch.uint8:  # int4 packed
            from int8_gemv import dequantize_i4, gemv_i4

            if x.numel() // x.size(-1) <= 4:
                return gemv_i4(x, w, l[name + "_s"])
            return F.linear(x, dequantize_i4(w, l[name + "_s"], x.dtype))
        if w.dtype == torch.int8:
            if x.numel() // x.size(-1) <= 4:  # decode: Triton int8 GEMV reads only the int8 bytes
                from int8_gemv import gemv_i8

                return gemv_i8(x, w, l[name + "_s"])
            return F.linear(x, w.to(x.dtype)) * l[name + "_s"]  # prefill: dequantise + cuBLAS
        return F.linear(x, w)

    def _attn_proj(self, l, x, cos, sin):
        c = self.cfg
        b, s, _ = x.shape
        qkv = self.lin(rms_norm(x, l["attn_norm"]), l, "wqkv")
        q, k, v = qkv.split([c.heads * c.head_dim, c.kv_heads * c.head_dim, c.kv_heads * c.head_dim], -1)
        q = q.view(b, s, c.heads, c.head_dim).transpose(1, 2)
        k = k.view(b, s, c.kv_heads, c.head_dim).transpose(1, 2)
        v = v.view(b, s, c.kv_heads, c.head_dim).transpose(1, 2)
        return apply_rope(q, cos, sin), apply_rope(k, cos, sin), v

    def _mlp(self, l, x):
        gu = self.lin(rms_norm(x, l["mlp_norm"]), l, "w13")
        g, u = gu.chunk(2, -1)
        return self.lin(F.silu(g) * u, l, "w2")

    def prefill(self, x: torch.Tensor) -> torch.Tensor:
        """x (1, S, dim) from position 0; fills cache[:S]; returns final-normed hidden (1, S, dim)."""
        s = x.size(1)
        cos, sin = self.cos[:s], self.sin[:s]
        for i, l in enumerate(self.L):
            q, k, v = self._attn_proj(l, x, cos, sin)
            self.k[i, :, :, :s] = k
            self.v[i, :, :, :s] = v
            a = F.scaled_dot_product_attention(q, k, v, is_causal=True, enable_gqa=True)
            x = x + self.lin(a.transpose(1, 2).reshape(1, s, -1), l, "wo")
            x = x + self._mlp(l, x)
        return rms_norm(x, self.norm)

    def step(self, x: torch.Tensor, pos: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        """One token at device position `pos` (shape (1,)); attends over the static cache with `mask`."""
        cos, sin = self.cos[pos], self.sin[pos]
        for i, l in enumerate(self.L):
            q, k, v = self._attn_proj(l, x, cos, sin)
            self.k[i].index_copy_(2, pos, k)
            self.v[i].index_copy_(2, pos, v)
            a = F.scaled_dot_product_attention(q, self.k[i], self.v[i], attn_mask=mask, enable_gqa=True)
            x = x + self.lin(a.transpose(1, 2).reshape(1, 1, -1), l, "wo")
            x = x + self._mlp(l, x)
        return rms_norm(x, self.norm)

    def step_static(self, x: torch.Tensor, p0: int) -> torch.Tensor:
        """Depth decoder: tokens at python-int positions p0..p0+S-1, causal over cache[:p0+S]."""
        s = x.size(1)
        p1 = p0 + s
        cos, sin = self.cos[p0:p1], self.sin[p0:p1]
        for i, l in enumerate(self.L):
            q, k, v = self._attn_proj(l, x, cos, sin)
            self.k[i, :, :, p0:p1] = k
            self.v[i, :, :, p0:p1] = v
            kk, vv = self.k[i, :, :, :p1], self.v[i, :, :, :p1]
            a = F.scaled_dot_product_attention(q, kk, vv, is_causal=(p0 == 0 and s > 1), enable_gqa=True)
            x = x + self.lin(a.transpose(1, 2).reshape(1, s, -1), l, "wo")
            x = x + self._mlp(l, x)
        return rms_norm(x, self.norm)


def sample_topk(logits: torch.Tensor, topk: int, temperature: float) -> torch.Tensor:
    """Sesame's sample_topk: temperature, top-k filter, softmax, exponential-race sample (no sync)."""
    logits = logits.float() / temperature
    kth = torch.topk(logits, topk, dim=-1).values[..., -1:]
    probs = torch.softmax(logits.masked_fill(logits < kth, float("-inf")), dim=-1)
    q = torch.empty_like(probs).exponential_(1)
    return torch.argmax(probs / q, dim=-1, keepdim=True)  # (1, 1) int64


def _permute_interleaved_to_half(w: torch.Tensor, heads: int) -> torch.Tensor:
    out, inp = w.shape
    return w.view(heads, out // heads // 2, 2, inp).transpose(1, 2).reshape(out, inp)


# ------------------------------------------------------------------------------------ generator

@dataclass
class Segment:
    speaker: int
    text: str
    audio: np.ndarray | None = None  # float32 mono 24 kHz
    codes: torch.Tensor | None = None  # (32, T) int64 Mimi codes (skips the encode)
    _key: str | None = field(default=None, repr=False)


class CsmStream:
    def __init__(self, model: str = "csm-1b", device: str = "cuda", temperature: float = 0.9, topk: int = 50,
                 compile: bool = True, compile_mode: str = "default", quant: str | None = None,
                 max_frames: int = 1000, log=print, kv_len: int = MAX_SEQ, lean: bool = False,
                 dtype: str | None = None, mimi_dtype: str | None = None, mimi_enc_device: str | None = None):
        self.cfg = MODELS[model]
        self.device = torch.device(device)
        dtypes = {"bf16": torch.bfloat16, "fp16": torch.float16, "fp32": torch.float32}
        # bf16 on the GPU (the Standard/High path); fp32 activations on the CPU unless asked otherwise
        self.dtype = dtypes[dtype] if dtype else (torch.bfloat16 if self.device.type == "cuda" else torch.float32)
        if not 64 <= kv_len <= MAX_SEQ:
            raise ValueError(f"kv_len must be in [64, {MAX_SEQ}]")
        self.kv_len = kv_len
        self.lean = lean
        self.mimi_dtype = dtypes[mimi_dtype] if mimi_dtype else torch.float32
        self.mimi_enc_device = torch.device(mimi_enc_device) if mimi_enc_device else self.device
        self.temperature, self.topk = temperature, topk
        self.max_frames = max_frames
        self.compile_mode = compile_mode
        self.quant = quant
        self.log = log
        self._codes_cache: dict[str, torch.Tensor] = {}
        self.last_codes: torch.Tensor | None = None
        self.timings: dict[str, float] = {}

        t0 = time.perf_counter()
        self._load_weights()
        self._load_tokenizer()
        self._load_mimi()
        self.timings["load_s"] = time.perf_counter() - t0
        t0 = time.perf_counter()
        self._build_graph(compile)
        self.timings["capture_s"] = time.perf_counter() - t0

    # ---------------------------------------------------------------- loading
    def _load_weights(self):
        from safetensors import safe_open

        c, dev, dt = self.cfg, self.device, self.dtype
        self.bb = Llama(c.backbone, self.kv_len, dev, dt)
        self.dec = Llama(c.decoder, NCB, dev, dt)
        W: dict[str, torch.Tensor] = {}

        def put(t):
            return t.to(device=dev, dtype=dt, non_blocking=False).contiguous()

        def put_lean(t):  # lean: tables are prepared on the CPU and uploaded once, final (no GPU temporaries)
            return t.to(dtype=dt).contiguous() if self.lean else put(t)

        if c.name == "csm-1b":
            path = _snapshot("unsloth/csm-1b") / "model.safetensors"
            names = {"self_attn.q_proj": "wq", "self_attn.k_proj": "wk", "self_attn.v_proj": "wv",
                     "self_attn.o_proj": "wo", "mlp.gate_proj": "w1", "mlp.up_proj": "w3", "mlp.down_proj": "w2",
                     "input_layernorm": "attn_norm", "post_attention_layernorm": "mlp_norm"}
            with safe_open(str(path), framework="pt", device="cpu") as f:
                for k in f.keys():
                    if k.startswith("codec_model."):
                        continue
                    t = f.get_tensor(k)
                    if k.startswith(("backbone_model.layers.", "depth_decoder.model.layers.")):
                        stack = self.bb if k.startswith("backbone_model") else self.dec
                        rest = k.split(".layers.", 1)[1]
                        idx, sub = rest.split(".", 1)
                        sub = sub.removesuffix(".weight")
                        stack.L[int(idx)][names[sub]] = t.to(dtype=dt)  # CPU; finalize() moves it
                    elif k == "backbone_model.norm.weight":
                        self.bb.norm = put(t)
                    elif k == "depth_decoder.model.norm.weight":
                        self.dec.norm = put(t)
                    elif k == "embed_text_tokens.weight":
                        # lean: 128k x 2048 table (0.5 GB) stays on the CPU; only prefill gathers from it
                        W["text_emb"] = t.to(dtype=dt).contiguous() if self.lean else put(t)
                    elif k == "depth_decoder.model.embed_tokens.weight":  # tied with the backbone's
                        W["audio_emb"] = put_lean(t)
                    elif k == "depth_decoder.model.inputs_embeds_projector.weight":
                        W["projection"] = put(t)
                    elif k == "lm_head.weight":
                        W["c0_head"] = put(t)
                    elif k == "depth_decoder.codebooks_head.weight":
                        W["audio_head"] = put_lean(t)
                    else:
                        raise KeyError(k)
        else:
            path = _snapshot("MisoLabs/MisoTTS") / "model.safetensors"
            names = {"attn.q_proj": "wq", "attn.k_proj": "wk", "attn.v_proj": "wv", "attn.output_proj": "wo",
                     "mlp.w1": "w1", "mlp.w3": "w3", "mlp.w2": "w2", "sa_norm": "attn_norm", "mlp_norm": "mlp_norm"}
            with safe_open(str(path), framework="pt", device="cpu") as f:
                for k0 in f.keys():
                    k = k0.removeprefix("module.")
                    t = f.get_tensor(k0)
                    if k.startswith(("backbone.layers.", "decoder.layers.")):
                        stack = self.bb if k.startswith("backbone") else self.dec
                        idx, sub = k.split(".layers.", 1)[1].split(".", 1)
                        sub = sub.removesuffix(".weight").removesuffix(".scale")
                        nm = names[sub]
                        if nm == "wq":
                            t = _permute_interleaved_to_half(t, stack.cfg.heads)
                        elif nm == "wk":
                            t = _permute_interleaved_to_half(t, stack.cfg.kv_heads)
                        stack.L[int(idx)][nm] = t.to(dtype=dt)  # CPU; finalize() moves it
                    elif k == "backbone.norm.scale":
                        self.bb.norm = put(t)
                    elif k == "decoder.norm.scale":
                        self.dec.norm = put(t)
                    elif k in ("text_embeddings.weight", "audio_embeddings.weight", "projection.weight",
                               "codebook0_head.weight", "audio_head"):
                        W[{"text_embeddings.weight": "text_emb", "audio_embeddings.weight": "audio_emb",
                           "projection.weight": "projection", "codebook0_head.weight": "c0_head",
                           "audio_head": "audio_head"}[k]] = put(t)
                    else:
                        raise KeyError(k)
                    del t
        for stack in (self.bb, self.dec):
            for i, l in enumerate(stack.L):
                if set(l) != {"wq", "wk", "wv", "wo", "w1", "w2", "w3", "attn_norm", "mlp_norm"}:
                    raise KeyError(f"layer {i} incomplete: {sorted(l)}")
        # quant "a/b": backbone a, depth decoder b (e.g. "int4/int8"); plain "a" = both
        bq, dq = (self.quant.split("/") + [None])[:2] if self.quant else (None, None)
        for stack, q in ((self.bb, bq), (self.dec, dq or bq)):
            stack.finalize(q, quant_on_cpu=self.lean)
        if self.lean and bq in ("int8", "int4"):
            # lean int8: also the audio embedding (per-row scale) and the 31 codebook heads (per-output scale)
            e = W.pop("audio_emb").cpu().float()
            es = e.abs().amax(dim=1, keepdim=True).clamp(min=1e-8) / 127.0
            W["audio_emb_q"] = torch.round(e / es).clamp(-127, 127).to(torch.int8).contiguous()
            W["audio_emb_s"] = es.to(dt)
            h = W.pop("audio_head").cpu().float().transpose(1, 2)  # (31, 2051, d_dec): rows = outputs
            hs = h.abs().amax(dim=2).clamp(min=1e-8) / 127.0
            W["audio_head_q"] = torch.round(h / hs[..., None]).clamp(-127, 127).to(torch.int8).contiguous()
            W["audio_head_s"] = hs.to(dt).contiguous()
            del e, h
        if self.lean:
            for k in W:
                if k != "text_emb":
                    W[k] = W[k].to(dev)
        if not self.lean:  # lean: project per step instead (saves the 65k x d_dec table)
            W["audio_emb_proj"] = torch.cat([F.linear(c, W["projection"]) for c in W["audio_emb"].split(8192)])
        self.W = W
        self.cb_offsets = (torch.arange(NCB, device=self.device) * AUDIO_VOCAB).view(1, 1, NCB)

    def _load_tokenizer(self):
        from tokenizers import Tokenizer

        self.tok = Tokenizer.from_file(str(_snapshot("unsloth/csm-1b") / "tokenizer.json"))
        # post_processor = <|begin_of_text|> $A <|end_of_text|> (Sesame's TemplateProcessing)
        ids = self.tok.encode("x").ids
        assert ids[0] == 128000 and ids[-1] == 128001, ids

    def _load_mimi(self):
        from moshi.models import loaders

        # two instances: a plain one to ENCODE context audio, a streaming one to DECODE frame by frame
        # lean: build both on the CPU, trim and cast there, then upload only what runs
        enc_dev, dec_dev = ("cpu", "cpu") if self.lean else (self.mimi_enc_device, self.device)
        self.mimi_enc = loaders.get_mimi(str(MIMI_WEIGHTS), device=enc_dev, num_codebooks=NCB).eval()
        self.mimi_dec = loaders.get_mimi(str(MIMI_WEIGHTS), device=dec_dev, num_codebooks=NCB).eval()
        if self.lean:  # each instance only ever runs one direction
            for m, unused in ((self.mimi_enc, ("decoder", "decoder_transformer", "upsample")),
                              (self.mimi_dec, ("encoder", "encoder_transformer", "downsample"))):
                for name in unused:
                    setattr(m, name, torch.nn.Identity())
        if self.mimi_dtype != torch.float32:
            self.mimi_dec.to(self.mimi_dtype)
            if self.mimi_enc_device.type == "cuda":
                self.mimi_enc.to(self.mimi_dtype)
        if self.lean:
            self.mimi_enc.to(self.mimi_enc_device)
            self.mimi_dec.to(self.device)
        self.mimi_enc_dtype = next(self.mimi_enc.parameters()).dtype
        self.mimi_dec.streaming_forever(1)

    # ---------------------------------------------------------------- the per-frame step (graphed)
    def _frame_step(self):
        """Given h_last (backbone hidden of the previous position) and pos (next position):
        sample one frame of 32 codebooks via the depth decoder, then run the backbone on that frame."""
        W, dec = self.W, self.dec
        h = self.h_last  # (1, 1, D)
        c0 = sample_topk(F.linear(h[:, 0], W["c0_head"]), self.topk, self.temperature)  # (1,1)
        samples = [c0]
        # decoder inputs are projection(audio_emb(code)); the table is pre-projected at load (no GEMV here)
        x = torch.cat([F.linear(h, W["projection"]), self._dec_in(c0)], dim=1)  # (1,2,d)
        y = dec.step_static(x, 0)[:, -1]
        p = 2
        for i in range(1, NCB):
            ci = sample_topk(self._head(y, i - 1), self.topk, self.temperature)
            samples.append(ci)
            if i == NCB - 1:
                break
            y = dec.step_static(self._dec_in(ci + i * AUDIO_VOCAB), p)[:, -1]
            p += 1
        frame = torch.cat(samples, dim=1)  # (1, 32)
        self.frame_out.copy_(frame)
        # backbone on the new frame (audio slots only; text slot masked out)
        emb = self._aemb(frame.view(1, 1, NCB) + self.cb_offsets).sum(dim=2)  # (1,1,D)
        mask = (self.arange_seq <= self.pos).view(1, 1, 1, self.kv_len)
        self.h_last.copy_(self.bb.step(emb, self.pos, mask))
        self.pos.add_(1)

    def _aemb(self, idx):
        """Audio-token embedding rows (flat ids): bf16 table, or (lean int8) int8 rows x per-row scale."""
        if "audio_emb" in self.W:
            return F.embedding(idx, self.W["audio_emb"])
        return F.embedding(idx, self.W["audio_emb_q"]).to(self.dtype) * F.embedding(idx, self.W["audio_emb_s"])

    def _head(self, y, j):
        """Logits of codebook j+1 from the depth decoder's hidden y (1, d_dec)."""
        if "audio_head" in self.W:
            return y @ self.W["audio_head"][j]
        q, s = self.W["audio_head_q"][j], self.W["audio_head_s"][j]
        if q.device.type == "cpu":
            return torch._weight_int8pack_mm(y, q, s)
        from int8_gemv import gemv_i8

        return gemv_i8(y, q, s)

    def _dec_in(self, idx):
        """Depth-decoder input for flat audio-token ids: the pre-projected table, or (lean) gather + project."""
        if "audio_emb_proj" in self.W:
            return F.embedding(idx, self.W["audio_emb_proj"])
        return F.linear(self._aemb(idx), self.W["projection"])

    def _build_graph(self, compile: bool):
        dev = self.device
        D = self.cfg.backbone.dim
        self.h_last = torch.zeros(1, 1, D, device=dev, dtype=self.dtype)
        self.pos = torch.zeros(1, device=dev, dtype=torch.long)
        self.frame_out = torch.zeros(1, NCB, device=dev, dtype=torch.long)
        self.arange_seq = torch.arange(self.kv_len, device=dev)
        self.hist = torch.zeros(self.max_frames, NCB, device=dev, dtype=torch.long)
        fn = self._frame_step
        if compile:
            import torch._inductor.config as inductor_config

            inductor_config.fallback_random = True  # eager RNG ops: plain philox, safe to capture in our graph
            fn = torch.compile(fn, fullgraph=True, dynamic=False, mode=self.compile_mode)
        self._step_fn = fn
        if dev.type != "cuda":  # CPU: no graph; the (optionally compiled) step runs as is
            with torch.inference_mode():
                for _ in range(2):
                    self.pos.fill_(5)
                    fn()
                self.mimi_enc.encode(torch.zeros(1, 1, SR, device=self.mimi_enc_device, dtype=self.mimi_enc_dtype))
                for _ in range(3):
                    self.mimi_dec.decode(torch.zeros(1, NCB, 1, device=dev, dtype=torch.long))
                self.mimi_dec.reset_streaming()
            self._replay = fn
            return
        s = torch.cuda.Stream()
        s.wait_stream(torch.cuda.current_stream())
        with torch.inference_mode(), torch.cuda.stream(s):
            for _ in range(3):  # warm-up (and compile)
                self.pos.fill_(5)
                fn()
        torch.cuda.current_stream().wait_stream(s)
        torch.cuda.synchronize()
        self.graph = torch.cuda.CUDAGraph()
        with torch.inference_mode(), torch.cuda.graph(self.graph):
            fn()
        torch.cuda.synchronize()
        self._replay = self.graph.replay
        # warm Mimi's streaming CUDA graphs too, and the encoder (its first call pays ~0.3 s of cuDNN setup)
        with torch.inference_mode():
            self.mimi_enc.encode(torch.zeros(1, 1, SR, device=self.mimi_enc_device, dtype=self.mimi_enc_dtype))
            for _ in range(3):
                self.mimi_dec.decode(torch.zeros(1, NCB, 1, device=dev, dtype=torch.long))
            self.mimi_dec.reset_streaming()
        torch.cuda.synchronize()
        if self.lean:  # hand back load/autotune transients (Triton's 256 MB benchmark flush buffer, etc.)
            torch.cuda.empty_cache()

    # ---------------------------------------------------------------- tokenisation
    def _text_frames(self, text: str, speaker: int):
        t = f"[{speaker}] {text.lstrip()}" if self.cfg.speaker_space else f"[{speaker}]{text}"
        ids = torch.tensor(self.tok.encode(t).ids, device=self.device)
        fr = torch.zeros(len(ids), NCB + 1, dtype=torch.long, device=self.device)
        mk = torch.zeros(len(ids), NCB + 1, dtype=torch.bool, device=self.device)
        fr[:, -1] = ids
        mk[:, -1] = True
        return fr, mk

    @torch.inference_mode()
    def encode(self, audio: np.ndarray) -> torch.Tensor:
        """float32 mono 24 kHz -> (32, T) Mimi codes. Cached by content hash."""
        key = hashlib.sha1(np.ascontiguousarray(audio, dtype=np.float32).tobytes()).hexdigest()
        if key not in self._codes_cache:
            x = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32))
            x = x.to(self.mimi_enc_device, self.mimi_enc_dtype)[None, None]
            self._codes_cache[key] = self.mimi_enc.encode(x)[0, :NCB].long().to(self.device)
        return self._codes_cache[key]

    def _audio_frames(self, codes: torch.Tensor):
        codes = torch.cat([codes, torch.zeros(NCB, 1, dtype=codes.dtype, device=codes.device)], 1)  # EOS frame
        fr = torch.zeros(codes.size(1), NCB + 1, dtype=torch.long, device=self.device)
        mk = torch.zeros(codes.size(1), NCB + 1, dtype=torch.bool, device=self.device)
        fr[:, :-1] = codes.T
        mk[:, :-1] = True
        return fr, mk

    def prompt(self, text: str, speaker: int, context: list[Segment]):
        toks, masks = [], []
        for seg in context:
            codes = seg.codes if seg.codes is not None else self.encode(seg.audio)
            for fr, mk in (self._text_frames(seg.text, seg.speaker), self._audio_frames(codes)):
                toks.append(fr)
                masks.append(mk)
        fr, mk = self._text_frames(text, speaker)
        toks.append(fr)
        masks.append(mk)
        return torch.cat(toks), torch.cat(masks)

    def _embed_prompt(self, toks, masks):
        W = self.W
        if self.lean:  # bounded transient: 64 positions at a time, each row's 33 slots summed in place
            out = torch.empty(1, toks.size(0), self.cfg.backbone.dim, device=self.device, dtype=self.dtype)
            for i in range(0, toks.size(0), 64):
                t, m = toks[i:i + 64], masks[i:i + 64]
                a = (self._aemb(t[:, :NCB] + self.cb_offsets[0]) * m[:, :NCB, None]).sum(1)
                x = F.embedding(t[:, NCB].cpu(), W["text_emb"]).to(self.device) * m[:, NCB, None]
                out[0, i:i + 64] = a + x
            return out
        audio = self._aemb(toks[:, :NCB] + self.cb_offsets[0])  # (S, 32, D)
        if W["text_emb"].device.type != toks.device.type:  # lean: gather on the CPU, ship only the rows
            text = F.embedding(toks[:, NCB:].cpu(), W["text_emb"]).to(self.device)
        else:
            text = F.embedding(toks[:, NCB:], W["text_emb"])  # (S, 1, D)
        e = torch.cat([audio, text], 1) * masks.unsqueeze(-1)
        return e.sum(1).unsqueeze(0)  # (1, S, D)

    # ---------------------------------------------------------------- generation
    @torch.inference_mode()
    def generate_stream(self, text: str, speaker: int, context: list[Segment], max_audio_ms: float | None = None,
                        chunk_schedule: tuple[int, ...] = (2, 2, 4, 6)) -> Iterator[np.ndarray]:
        """Yield float32 PCM chunks (24 kHz). Chunk sizes in frames (80 ms each) follow `chunk_schedule`, the last
        size repeating: a small first chunk for latency, then growing so the player's buffer never runs dry."""
        toks, masks = self.prompt(text, speaker, context)
        n = toks.size(0)
        max_frames = self.max_frames if max_audio_ms is None else min(self.max_frames, int(max_audio_ms / 80))
        max_frames = min(max_frames, self.kv_len - n - 1)
        if max_frames <= 0:
            raise ValueError(f"prompt of {n} positions leaves no room in the {self.kv_len} window")
        # prefill (eager): fills the backbone cache [0, n), leaves h_last + pos for the graph
        h = self.bb.prefill(self._embed_prompt(toks, masks))
        self.h_last.copy_(h[:, -1:])
        self.pos.fill_(n)
        self.mimi_dec.reset_streaming()
        done = 0
        sched = list(chunk_schedule)
        want = sched.pop(0)
        codes_out = []
        while done < max_frames:
            k = min(want, max_frames - done)
            pcm = []
            for j in range(k):
                self._replay()
                self.hist[done + j].copy_(self.frame_out[0])
                pcm.append(self.mimi_dec.decode(self.hist[done + j].view(1, NCB, 1)))
            frames = self.hist[done:done + k].cpu()  # the one sync per chunk
            eos = (frames == 0).all(dim=1).nonzero()
            stop = int(eos[0]) if eos.numel() else k
            if stop:
                audio = torch.cat(pcm[:stop], dim=-1)[0, 0].float().cpu().numpy()
                codes_out.append(frames[:stop])
                yield audio
            done += stop
            if stop < k:
                break
            want = sched.pop(0) if sched else want
        self.last_codes = torch.cat(codes_out).T.contiguous().to(self.device) if codes_out else None
        self.last_frames = done

    def generate(self, text, speaker, context, **kw) -> np.ndarray:
        parts = list(self.generate_stream(text, speaker, context, **kw))
        return np.concatenate(parts) if parts else np.zeros(0, np.float32)

    # ---------------------------------------------------------------- parity helpers
    @torch.inference_mode()
    def first_logits(self, toks, masks) -> torch.Tensor:
        h = self.bb.prefill(self._embed_prompt(toks, masks))
        return F.linear(h[:, -1], self.W["c0_head"]).float()


_default: CsmStream | None = None


def generate_stream(text: str, speaker: int, context: list[Segment], model: str = "csm-1b",
                    **kw) -> Iterator[np.ndarray]:
    """Module-level entry point: one lazily-built generator per process (first call pays load + warm-up)."""
    global _default
    if _default is None or _default.cfg.name != model:
        _default = CsmStream(model, quant="int8" if model == "misotts-8b" else None)
    return _default.generate_stream(text, speaker, context, **kw)

