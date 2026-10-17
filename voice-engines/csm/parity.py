"""Parity check: this repo's plain-PyTorch CSM-1B vs transformers' CsmForConditionalGeneration.

Compares (a) backbone hidden + codebook-0 logits over a real prompt (reference clip + text) and
(b) depth-decoder hidden states over a 32-position frame, same weights, bf16 both sides.

  uv run --group dev parity.py
  uv run parity.py --miso REF.pt [--quant int8]   # MisoTTS vs upstream torchtune model code: REF.pt holds
      tokens/mask/codes + hidden states saved from the vendored miso_models.py (bake-off venv)
"""

import json
import sys

import numpy as np
import torch
import torch.nn.functional as F

from csm_stream import NCB, CsmStream, Segment, _snapshot
from bench import load_ref, REFS

def cmp(name, a, b):
    a, b = a.float().flatten(), b.float().flatten().to(a.device)
    cos = F.cosine_similarity(a, b, dim=0).item()
    rel = ((a - b).norm() / b.norm()).item()
    print(f"{name:28s} cos={cos:.5f} rel_err={rel:.4f}")
    return cos


if "--miso" in sys.argv:
    ref = torch.load(sys.argv[sys.argv.index("--miso") + 1])
    quant = sys.argv[sys.argv.index("--quant") + 1] if "--quant" in sys.argv else None
    gen = CsmStream("misotts-8b", compile=False, quant=quant)
    with torch.inference_mode():
        toks, masks = ref["tokens"][0].cuda(), ref["mask"][0].cuda()
        hb = gen.bb.prefill(gen._embed_prompt(toks, masks))
        ok = cmp("backbone hidden (all pos)", hb, ref["hb"]) > 0.99
        c0 = F.linear(hb[:, -1], gen.W["c0_head"])
        ok &= cmp("codebook0 logits (last)", c0, ref["c0"]) > 0.99
        print("top-5 c0 mine", c0.float().topk(5).indices.tolist(), " ref", ref["c0"].topk(5).indices.tolist())
        codes = ref["codes"].cuda()
        embs = F.embedding(codes[:31] + torch.arange(31, device="cuda") * 2051, gen.W["audio_emb_proj"])
        x = torch.cat([F.linear(hb[:, -1:], gen.W["projection"]), embs.unsqueeze(0)], 1)
        # decoder over all 32 positions at once (prefill-shaped, cuBLAS path) ...
        hd = gen.dec.step_static(x, 0)
        ok &= cmp("depth decoder hidden", hd, ref["hd"]) > 0.99
        # ... and token by token (the per-frame decode path: int8 Triton GEMV when quantised)
        y = [gen.dec.step_static(x[:, :2], 0)]
        for p in range(2, 32):
            y.append(gen.dec.step_static(x[:, p:p + 1], p))
        ok &= cmp("depth decoder (stepwise)", torch.cat(y, 1), ref["hd"]) > 0.99
    print("PARITY", "OK" if ok else "FAIL", f"(misotts-8b, quant={quant})")
    sys.exit(0 if ok else 1)

torch.manual_seed(0)
gen = CsmStream("csm-1b", compile=False)
ref_text = json.loads((REFS / "transcripts.json").read_text())
ctx = [Segment(0, ref_text["Hannah"], load_ref(REFS / "Hannah.wav"))]
toks, masks = gen.prompt("Hey, you're back.", 0, ctx)

with torch.inference_mode():
    e = gen._embed_prompt(toks, masks)
    mine_h = gen.bb.prefill(e)
    mine_logits = F.linear(mine_h[:, -1], gen.W["c0_head"]).float()

from transformers import CsmForConditionalGeneration

hf = CsmForConditionalGeneration.from_pretrained(str(_snapshot("unsloth/csm-1b")), dtype=torch.bfloat16,
                                                 device_map="cuda").eval()
with torch.inference_mode():
    out = hf.backbone_model(inputs_embeds=e, use_cache=False)
    hf_h = out.last_hidden_state
    hf_logits = hf.lm_head(hf_h[:, -1]).float()

    ok = cmp("backbone hidden (all pos)", mine_h, hf_h) > 0.99
    ok &= cmp("codebook0 logits (last)", mine_logits, hf_logits) > 0.99
    print("top-5 c0 mine", mine_logits.topk(5).indices.tolist(), " hf", hf_logits.topk(5).indices.tolist())

    # depth decoder over one full frame: [h_last, emb(c0), emb(c1+off) ... emb(c30+off)]
    codes = torch.randint(1, 2048, (NCB,), device="cuda")
    embs = F.embedding(codes[:-1] + torch.arange(NCB - 1, device="cuda") * 2051, gen.W["audio_emb"])
    x = torch.cat([mine_h[:, -1:], embs.unsqueeze(0)], 1)  # (1, 32, 2048)
    gen.dec.k.zero_(); gen.dec.v.zero_()
    mine_d = gen.dec.step_static(F.linear(x, gen.W["projection"]), 0)
    hf_d = hf.depth_decoder.model(inputs_embeds=x, use_cache=False).last_hidden_state
    ok &= cmp("depth decoder hidden", mine_d, hf_d) > 0.99
    ml = torch.einsum("sd,sdv->sv", mine_d[0, 1:].float(), gen.W["audio_head"].float())
    hl = torch.einsum("sd,sdv->sv", hf_d[0, 1:].float(), hf.depth_decoder.codebooks_head.weight.float())
    ok &= cmp("codebooks 1..31 logits", ml, hl) > 0.99
print("PARITY", "OK" if ok else "FAIL")
sys.exit(0 if ok else 1)
