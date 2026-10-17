"""Weight-only int8 GEMV (Triton) for single-token decode: y[m, n] = s[n] * sum_k x[m, k] * W[n, k].

Memory-bound: reads the int8 weight once (half of bf16), accumulates in fp32. M (tokens) <= 4.
Used for the per-frame step (backbone token + 31 depth-decoder passes); prefill falls back to
dequantise + cuBLAS.
"""

import torch
import triton
import triton.language as tl


@triton.autotune(
    configs=[
        triton.Config({"BLOCK_N": bn, "BLOCK_K": bk}, num_warps=nw, num_stages=ns)
        for bn, bk, nw, ns in [
            (8, 512, 4, 3), (16, 256, 4, 3), (16, 512, 4, 3), (32, 256, 4, 3), (32, 512, 8, 3),
            (64, 256, 8, 3), (64, 128, 4, 4), (8, 1024, 4, 2), (16, 1024, 8, 2), (4, 1024, 4, 3),
        ]
    ],
    key=["N", "K", "M"],
)
@triton.jit
def _gemv_i8(x_ptr, w_ptr, s_ptr, y_ptr, N, K, M: tl.constexpr, BLOCK_N: tl.constexpr, BLOCK_K: tl.constexpr):
    pid = tl.program_id(0)
    rn = pid * BLOCK_N + tl.arange(0, BLOCK_N)
    nmask = rn < N
    acc = tl.zeros([M, BLOCK_N], dtype=tl.float32)
    rm = tl.arange(0, M)
    for k0 in range(0, K, BLOCK_K):
        rk = k0 + tl.arange(0, BLOCK_K)
        kmask = rk < K
        w = tl.load(w_ptr + rn[:, None] * K + rk[None, :], mask=nmask[:, None] & kmask[None, :], other=0)
        w = w.to(tl.float32)  # (BN, BK)
        x = tl.load(x_ptr + rm[:, None] * K + rk[None, :], mask=kmask[None, :], other=0.0).to(tl.float32)  # (M, BK)
        acc += tl.sum(x[:, None, :] * w[None, :, :], axis=2)
    s = tl.load(s_ptr + rn, mask=nmask, other=0.0).to(tl.float32)
    out = acc * s[None, :]
    tl.store(y_ptr + rm[:, None] * N + rn[None, :], out.to(y_ptr.dtype.element_ty), mask=nmask[None, :])


def gemv_i8(x: torch.Tensor, w: torch.Tensor, s: torch.Tensor) -> torch.Tensor:
    """x (..., K) bf16 with prod(...) <= 4; w (N, K) int8; s (N,) -> (..., N)."""
    shp = x.shape
    x2 = x.reshape(-1, shp[-1]).contiguous()
    m, k = x2.shape
    n = w.shape[0]
    mp = 1 if m == 1 else (2 if m == 2 else 4)
    if mp != m:
        x2 = torch.cat([x2, x2.new_zeros(mp - m, k)])
    y = torch.empty(mp, n, device=x.device, dtype=x.dtype)
    grid = lambda meta: (triton.cdiv(n, meta["BLOCK_N"]),)
    _gemv_i8[grid](x2, w, s, y, n, k, M=mp)
    return y[:m].reshape(*shp[:-1], n)


# ------------------------------------------------------------------------------------ int4 (group-wise)
# Weight-only int4, symmetric per (output row, group of G inputs): w ~= s[n, k // G] * (q - 8), q in [0, 15].
# Packed two per byte along K: byte j of row n = q[n, 2j] | q[n, 2j + 1] << 4. Quarter of bf16's bytes
# (+ one bf16 scale per G weights). Small-footprint experiment for CSM-1B (docs/work/one-voice.md, Light tier).
I4_GROUP = 128


def quantize_i4(w: torch.Tensor, group: int = I4_GROUP) -> tuple[torch.Tensor, torch.Tensor]:
    """w (N, K) float -> (packed uint8 (N, K/2), scales (N, K/group) float32)."""
    n, k = w.shape
    g = w.float().view(n, k // group, group)
    s = g.abs().amax(dim=-1).clamp(min=1e-8) / 7.0
    q = (torch.round(g / s[..., None]).clamp(-8, 7) + 8).to(torch.uint8).view(n, k)
    return (q[:, 0::2] | (q[:, 1::2] << 4)).contiguous(), s


def dequantize_i4(p: torch.Tensor, s: torch.Tensor, dtype=torch.bfloat16, group: int = I4_GROUP) -> torch.Tensor:
    n = p.size(0)
    q = torch.stack([p & 0xF, p >> 4], dim=-1).view(n, -1).to(dtype) - 8
    return (q.view(n, -1, group) * s.to(dtype)[..., None]).view(n, -1)


@triton.autotune(
    configs=[
        triton.Config({"BLOCK_N": bn, "BLOCK_K": bk}, num_warps=nw, num_stages=ns)
        for bn, bk, nw, ns in [
            (8, 128, 4, 3), (16, 128, 4, 3), (32, 128, 4, 3), (64, 128, 8, 3), (16, 64, 4, 4),
            (32, 64, 4, 4), (64, 64, 4, 3), (4, 128, 4, 3), (128, 128, 8, 2),
        ]
    ],
    key=["N", "K", "M"],
)
@triton.jit
def _gemv_i4(x_ptr, w_ptr, s_ptr, y_ptr, N, K, M: tl.constexpr, G: tl.constexpr, BLOCK_N: tl.constexpr,
             BLOCK_K: tl.constexpr):
    pid = tl.program_id(0)
    rn = pid * BLOCK_N + tl.arange(0, BLOCK_N)
    nmask = rn < N
    acc = tl.zeros([M, BLOCK_N], dtype=tl.float32)
    rm = tl.arange(0, M)
    HB: tl.constexpr = BLOCK_K // 2
    for k0 in range(0, K, BLOCK_K):  # BLOCK_K <= G, G % BLOCK_K == 0: one scale per row per block
        rj = k0 // 2 + tl.arange(0, HB)
        b = tl.load(w_ptr + rn[:, None] * (K // 2) + rj[None, :], mask=nmask[:, None], other=0)
        lo = (b & 0xF).to(tl.float32) - 8.0
        hi = (b >> 4).to(tl.float32) - 8.0
        xe = tl.load(x_ptr + rm[:, None] * K + 2 * rj[None, :]).to(tl.float32)
        xo = tl.load(x_ptr + rm[:, None] * K + 2 * rj[None, :] + 1).to(tl.float32)
        part = tl.sum(xe[:, None, :] * lo[None, :, :] + xo[:, None, :] * hi[None, :, :], axis=2)
        s = tl.load(s_ptr + rn * (K // G) + k0 // G, mask=nmask, other=0.0).to(tl.float32)
        acc += part * s[None, :]
    tl.store(y_ptr + rm[:, None] * N + rn[None, :], acc.to(y_ptr.dtype.element_ty), mask=nmask[None, :])


def gemv_i4(x: torch.Tensor, w: torch.Tensor, s: torch.Tensor) -> torch.Tensor:
    """x (..., K) bf16 with prod(...) <= 4; w (N, K/2) uint8 packed; s (N, K/G) -> (..., N)."""
    shp = x.shape
    x2 = x.reshape(-1, shp[-1]).contiguous()
    m, k = x2.shape
    n = w.shape[0]
    mp = 1 if m == 1 else (2 if m == 2 else 4)
    if mp != m:
        x2 = torch.cat([x2, x2.new_zeros(mp - m, k)])
    y = torch.empty(mp, n, device=x.device, dtype=x.dtype)
    grid = lambda meta: (triton.cdiv(n, meta["BLOCK_N"]),)
    _gemv_i4[grid](x2, w, s, y, n, k, M=mp, G=I4_GROUP)
    return y[:m].reshape(*shp[:-1], n)
