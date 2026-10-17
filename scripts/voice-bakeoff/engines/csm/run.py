"""Voice bake-off runner — the context-aware "Sesame lane".

Engines:
  csm-1b      Sesame CSM-1B via the ungated Apache-2.0 mirror unsloth/csm-1b, loaded through
              Hugging Face transformers' native CSM support (CsmForConditionalGeneration; the
              checkpoint carries its own Mimi codec).
  misotts-8b  MisoTTS 8B (CSM architecture, Llama-8B backbone + 300M audio decoder). Model
              definition vendored from MisoLabsAI/MisoTTS (miso_models.py); Mimi via
              transformers MimiModel (kyutai/mimi); Llama-3.2 text tokenizer from the CSM mirror
              (same vocab + BOS/EOS template as meta-llama/Llama-3.2-1B, which is gated).

Cloning = context: the reference clip + its transcript is a prior turn of the same speaker id.
Dialogue: rolling context = both reference clips + every earlier generated turn.

Run (see ../../README.md):
  HF_HOME=../../../../voice-engines/_models/_hf_cache uv run run.py \
    --lines ../../lines.json --samples ../../../../voice-engines/_samples/bakeoff-2026-09-30
"""

from __future__ import annotations

import argparse
import gc
import json
import os
import random
import re
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")  # weights are pre-fetched with curl (hf CLI hangs here)
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import numpy as np
import soundfile as sf
import torch
from scipy.signal import resample_poly

SR = 24_000
FRAME_MS = 80  # Mimi 12.5 Hz
MAX_SEQ = 2048  # both models' backbone window (positions)
PEAK = 10 ** (-1 / 20)  # -1 dBFS
TEMPERATURE = 0.9  # Sesame generator / MisoTTS generator / csm-1b generation_config defaults
TOPK = 50
GAP_MS = 350

HERE = Path(__file__).resolve().parent


# ---------------------------------------------------------------- helpers

def strip_cues(text: str) -> str:
    t = re.sub(r"\{[a-z]+\}", " ", text)
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s+([,.!?])", r"\1", t)
    return t


def seed_all(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def load_ref(path: Path) -> np.ndarray:
    audio, sr = sf.read(str(path), dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if sr != SR:
        g = np.gcd(sr, SR)
        audio = resample_poly(audio, SR // g, sr // g).astype(np.float32)
    return audio


def write_wav(path: Path, audio: np.ndarray) -> None:
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0:
        audio = audio * (PEAK / peak)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio, SR, subtype="PCM_16")


def max_frames_for(text: str) -> int:
    # ~14 chars/s natural speech; allow ~2x plus 3 s of headroom, capped at 45 s.
    ms = min(45_000, 3_000 + 150 * len(text))
    return int(ms / FRAME_MS)


def sync() -> None:
    if torch.cuda.is_available():
        torch.cuda.synchronize()


# ---------------------------------------------------------------- engines
# Each engine exposes: generate(text, speaker, context) -> (audio np.float32 @24k, frames, hit_max)
# context = list of (speaker:int, text:str, audio:np.ndarray)


class Csm1b:
    engine = "csm-1b"
    model_id = "unsloth/csm-1b"

    def __init__(self, device: str):
        from transformers import AutoProcessor, CsmForConditionalGeneration

        self.device = device
        self.processor = AutoProcessor.from_pretrained(self.model_id)
        self.model = CsmForConditionalGeneration.from_pretrained(
            self.model_id, dtype=torch.bfloat16, device_map=device
        )
        # Sesame's reference generator runs the backbone in bf16 and Mimi in fp32.
        self.model.codec_model.float()
        self.model.eval()

    def prompt_len(self, context, text, speaker) -> int:
        n = 0
        for spk, t, a in context:
            n += len(self.processor.tokenizer(f"[{spk}]{t}")["input_ids"]) + int(np.ceil(len(a) / SR * 12.5)) + 1
        return n + len(self.processor.tokenizer(f"[{speaker}]{text}")["input_ids"])

    @torch.inference_mode()
    def generate(self, text, speaker, context, max_frames):
        conv = [
            {"role": str(spk), "content": [{"type": "text", "text": t}, {"type": "audio", "path": a}]}
            for spk, t, a in context
        ]
        conv.append({"role": str(speaker), "content": [{"type": "text", "text": text}]})
        inputs = self.processor.apply_chat_template(conv, tokenize=True, return_dict=True).to(self.device)
        out = self.model.generate(
            **inputs,
            output_audio=True,
            max_new_tokens=max_frames,
            do_sample=True,
            temperature=TEMPERATURE,
            top_k=TOPK,
            depth_decoder_do_sample=True,
            depth_decoder_temperature=TEMPERATURE,
            depth_decoder_top_k=TOPK,
        )
        audio = out[0].float().cpu().numpy()
        frames = int(round(len(audio) / SR * 12.5))
        return audio, frames, frames >= max_frames

    def close(self):
        del self.model
        del self.processor


class Miso8b:
    engine = "misotts-8b"
    model_id = "MisoLabs/MisoTTS"

    def __init__(self, device: str):
        from huggingface_hub import hf_hub_download
        from safetensors import safe_open
        from tokenizers import Tokenizer
        from transformers import MimiModel

        sys.path.insert(0, str(HERE))
        import miso_models as mm

        self.mm = mm
        self.device = device
        dtype = torch.bfloat16
        weights = hf_hub_download(self.model_id, "model.safetensors")

        # Build on meta, materialise bf16 directly on the GPU (the checkpoint is fp32, 33 GB),
        # stream the weights in tensor by tensor, then rebuild RoPE caches (non-persistent) in
        # fp32 and cast — the same end state as the upstream Model(...).to(device, bf16).
        with torch.device("meta"):
            model = mm.Model(mm.MISO_TTS_8B_CONFIG)
        model = model.to(dtype=dtype).to_empty(device=device)
        expected = set(model.state_dict().keys())
        seen = set()
        params = dict(model.named_parameters())
        params.update(dict(model.named_buffers()))
        with safe_open(weights, framework="pt", device="cpu") as f:
            for k in f.keys():
                key = k.removeprefix("module.")
                if key not in params:
                    raise KeyError(f"unexpected checkpoint key {k}")
                with torch.no_grad():
                    params[key].copy_(f.get_tensor(k).to(dtype))
                seen.add(key)
        missing = expected - seen
        if missing:
            raise KeyError(f"checkpoint missing {len(missing)} keys, e.g. {sorted(missing)[:5]}")
        with torch.device(device):
            for m in model.modules():
                if hasattr(m, "rope_init") and callable(m.rope_init):
                    m.rope_init()
        model.to(device=device, dtype=dtype)
        model.eval()
        model.setup_caches(1)
        self.model = model

        tok_path = hf_hub_download("unsloth/csm-1b", "tokenizer.json")
        self.tok = Tokenizer.from_file(tok_path)  # post_processor = <|begin_of_text|> $A <|end_of_text|>
        assert self.tok.token_to_id("<|begin_of_text|>") == 128000
        assert self.tok.token_to_id("<|end_of_text|>") == 128001

        self.mimi = MimiModel.from_pretrained("kyutai/mimi").to(device).float().eval()
        self.frame_size = mm.MISO_TTS_8B_CONFIG.audio_num_codebooks + 1
        self.ncb = mm.MISO_TTS_8B_CONFIG.audio_num_codebooks

    # --- tokenisation mirrors MisoTTS generator.py
    def _text(self, text, speaker):
        ids = self.tok.encode(f"[{speaker}] {text.lstrip()}").ids
        fr = torch.zeros(len(ids), self.frame_size, dtype=torch.long)
        mk = torch.zeros(len(ids), self.frame_size, dtype=torch.bool)
        fr[:, -1] = torch.tensor(ids)
        mk[:, -1] = True
        return fr.to(self.device), mk.to(self.device)

    def _audio(self, audio: np.ndarray):
        x = torch.from_numpy(audio).float().to(self.device)[None, None]
        codes = self.mimi.encode(x, num_quantizers=self.ncb).audio_codes[0]  # (K, T)
        codes = torch.cat([codes, torch.zeros(codes.size(0), 1, dtype=codes.dtype, device=self.device)], dim=1)
        fr = torch.zeros(codes.size(1), self.frame_size, dtype=torch.long, device=self.device)
        mk = torch.zeros(codes.size(1), self.frame_size, dtype=torch.bool, device=self.device)
        fr[:, :-1] = codes.transpose(0, 1)
        mk[:, :-1] = True
        return fr, mk

    def prompt_len(self, context, text, speaker) -> int:
        n = 0
        for spk, t, a in context:
            n += len(self.tok.encode(f"[{spk}] {t.lstrip()}").ids) + int(np.ceil(len(a) / SR * 12.5)) + 1
        return n + len(self.tok.encode(f"[{speaker}] {text.lstrip()}").ids)

    @torch.inference_mode()
    def generate(self, text, speaker, context, max_frames):
        self.model.reset_caches()
        toks, masks = [], []
        for spk, t, a in context:
            tf, tm = self._text(t, spk)
            af, am = self._audio(a)
            toks += [tf, af]
            masks += [tm, am]
        tf, tm = self._text(text, speaker)
        toks.append(tf)
        masks.append(tm)
        prompt = torch.cat(toks, 0)
        pmask = torch.cat(masks, 0)
        if prompt.size(0) >= MAX_SEQ - max_frames:
            raise ValueError(f"prompt {prompt.size(0)} too long for {max_frames} frames")
        cur = prompt.unsqueeze(0)
        cmask = pmask.unsqueeze(0)
        pos = torch.arange(0, prompt.size(0), device=self.device).unsqueeze(0)
        samples = []
        for _ in range(max_frames):
            s = self.model.generate_frame(cur, cmask, pos, TEMPERATURE, TOPK)
            if torch.all(s == 0):
                break
            samples.append(s)
            cur = torch.cat([s, torch.zeros(1, 1, dtype=torch.long, device=self.device)], dim=1).unsqueeze(1)
            cmask = torch.cat(
                [torch.ones_like(s).bool(), torch.zeros(1, 1, dtype=torch.bool, device=self.device)], dim=1
            ).unsqueeze(1)
            pos = pos[:, -1:] + 1
        if not samples:
            return np.zeros(int(SR * 0.1), dtype=np.float32), 0, False
        codes = torch.stack(samples).permute(1, 2, 0).long()  # (1, K, T)
        audio = self.mimi.decode(codes).audio_values[0, 0].float().cpu().numpy()
        return audio, len(samples), len(samples) >= max_frames

    def close(self):
        del self.model
        del self.mimi


ENGINES = {"csm-1b": Csm1b, "misotts-8b": Miso8b}

META_STATIC = {
    "csm-1b": {
        "model": "unsloth/csm-1b (ungated Apache-2.0 mirror of sesame/csm-1b, rev 39e8c756)",
        "license": "Apache-2.0",
    },
    "misotts-8b": {
        "model": "MisoLabs/MisoTTS (rev ef6b096c) + kyutai/mimi codec; code MisoLabsAI/MisoTTS@cd7dde13",
        "license": (
            "Modified MIT (Copyright (c) 2026 Kamino Learning, Inc.): standard MIT grant (use, copy, modify, "
            "merge, publish, distribute, sublicense, sell; keep the copyright + permission notice; no warranty), "
            "plus one modification: if the Software or any derivative is used in commercial products or "
            "services with more than 50 million monthly active users, or more than 10 million US dollars "
            "(or equivalent) in monthly revenue, you must prominently display \"Miso Labs\" on the user "
            "interface of that product or service."
        ),
    },
}


# ---------------------------------------------------------------- driver

def run_engine(name: str, lines: dict, samples: Path, only: set[str] | None, refs: dict, ref_text: dict) -> None:
    out = samples / "out" / name
    out.mkdir(parents=True, exist_ok=True)
    device = "cuda"
    torch.cuda.reset_peak_memory_stats()
    notes: list[str] = []
    clips: dict[str, dict] = {}
    t0 = time.time()
    eng = ENGINES[name](device)
    load_s = time.time() - t0
    print(f"[{name}] loaded in {load_s:.1f}s; allocated {torch.cuda.memory_allocated() / 2**20:.0f} MB", flush=True)

    def gen(clip_id, text, speaker, context):
        mf = max_frames_for(text)
        # trim the oldest non-reference context turns if the window would overflow
        ctx = list(context)
        trimmed = 0
        while eng.prompt_len(ctx, text, speaker) >= MAX_SEQ - mf and len(ctx) > 2:
            ctx.pop(2)
            trimmed += 1
        if trimmed:
            notes.append(f"{clip_id}: trimmed {trimmed} oldest dialogue turns from context to fit the 2048 window")
        sync()
        g0 = time.perf_counter()
        audio, frames, hit = eng.generate(text, speaker, ctx, mf)
        sync()
        gen_ms = (time.perf_counter() - g0) * 1000
        audio_ms = len(audio) / SR * 1000
        clips[clip_id] = {
            "genMs": round(gen_ms),
            "audioMs": round(audio_ms),
            "rtf": round(gen_ms / audio_ms, 3) if audio_ms else None,
        }
        if hit:
            notes.append(f"{clip_id}: hit the max-length cap ({mf * FRAME_MS} ms) without EOS - likely runaway/babble")
        print(f"[{name}] {clip_id}: {audio_ms / 1000:.2f}s audio in {gen_ms / 1000:.2f}s (rtf {gen_ms / max(audio_ms, 1):.2f})"
              f"{' HIT-MAX' if hit else ''}", flush=True)
        return audio

    takes = int(lines.get("takes", 2))
    cue_dropped = set()

    # conversation + read-aloud: context = that voice's reference clip only (speaker 0)
    for item in list(lines["conversation"]) + list(lines["readAloud"]):
        text = strip_cues(item["text"])
        if text != item["text"]:
            cue_dropped.update(re.findall(r"\{([a-z]+)\}", item["text"]))
        for voice in item["voices"]:
            for take in range(1, takes + 1):
                cid = f"{item['id']}__{voice}__t{take}"
                if only and item["id"] not in only and cid not in only:
                    continue
                seed_all(take)
                ctx = [(0, ref_text[voice], refs[voice])]
                audio = gen(cid, text, 0, ctx)
                write_wav(out / f"{cid}.wav", audio)

    # dialogue: speaker 0 = hannah, 1 = james; rolling context of refs + every earlier turn
    dlg = lines["dialogue"]
    spk_of = {"hannah": 0, "james": 1}
    if not only or dlg["id"] in only:
        for take in range(1, takes + 1):
            seed_all(take)
            ctx = [(0, ref_text["hannah"], refs["hannah"]), (1, ref_text["james"], refs["james"])]
            turns_audio = []
            for n, turn in enumerate(dlg["turns"]):
                text = strip_cues(turn["text"])
                if text != turn["text"]:
                    cue_dropped.update(re.findall(r"\{([a-z]+)\}", turn["text"]))
                spk = spk_of[turn["speaker"]]
                cid = f"{dlg['id']}__turn{n}__t{take}"
                audio = gen(cid, text, spk, ctx)
                clips[cid]["speaker"] = turn["speaker"]
                clips[cid]["contextTurns"] = len(ctx)
                ctx.append((spk, text, audio))
                turns_audio.append(audio)
                if turn["speaker"] == "hannah":
                    write_wav(out / f"{cid}.wav", audio)
            gap = np.zeros(int(SR * GAP_MS / 1000), dtype=np.float32)
            parts = []
            for i, a in enumerate(turns_audio):
                if i:
                    parts.append(gap)
                parts.append(a.astype(np.float32))
            write_wav(out / f"{dlg['id']}__t{take}.wav", np.concatenate(parts))

    peak_mb = round(torch.cuda.max_memory_allocated() / 2**20)
    meta_path = out / "meta.json"
    if only and meta_path.exists():  # partial re-run: merge
        old = json.loads(meta_path.read_text())
        old_clips = old.get("clips", {})
        old_clips.update(clips)
        clips = old_clips
        notes = old.get("notes", []) + notes
        peak_mb = max(peak_mb, old.get("peakVramMb", 0))
    meta = {
        "engine": name,
        **META_STATIC[name],
        "clones": True,
        "voiceNote": (
            "cloned by context: refs/Hannah.wav / refs/James.wav (resampled 32k->24k) with their "
            "refs/transcripts.json text as a prior turn of the same speaker id"
        ),
        "cues": "no trained cue tokens; every {cue} removed from the text ("
        + ", ".join(sorted(cue_dropped or {"laugh", "chuckle", "sigh", "gasp", "breath"}))
        + " dropped)",
        "contextAware": True,
        "contextStrategy": (
            "conversation/read-aloud: context = [voice ref clip as speaker 0], generate as speaker 0. "
            "dialogue: speaker 0 = hannah, 1 = james; context = [hannah ref, james ref] + every earlier "
            "generated turn (raw audio + text), oldest generated turns trimmed first if the 2048-position "
            "window would overflow (never needed at this script length)."
        ),
        "settings": {
            "temperature": TEMPERATURE,
            "topk": TOPK,
            "depthDecoderTemperature": TEMPERATURE,
            "depthDecoderTopk": TOPK,
            "dtype": "bfloat16 backbone/decoder, float32 Mimi",
            "maxAudioMs": "min(45000, 3000 + 150*chars)",
            "seeds": "take 1 = seed 1, take 2 = seed 2 (dialogue: seeded once per take, turns run in order)",
        },
        "device": "cuda (RTX PRO 6000 Blackwell, shared with a running benchmark)",
        "peakVramMb": peak_mb,
        "loadSeconds": round(load_s, 1),
        "clips": clips,
        "notes": notes,
    }
    if name == "misotts-8b":
        meta["notes"] = [
            "SilentCipher watermark from upstream generator.py NOT applied (parity with csm-1b via transformers, "
            "fewer deps); model code + sampling otherwise upstream.",
            "Mimi via transformers MimiModel(kyutai/mimi) instead of moshi's loader (same weights); text tokenizer "
            "from unsloth/csm-1b (Llama-3.2 vocab, identical BOS/EOS template) since meta-llama is gated.",
            "Quality-ceiling reference: ~16 GB bf16 weights, not a typical-user model.",
        ] + [n for n in meta["notes"] if not n.startswith(("SilentCipher", "Mimi via", "Quality-ceiling"))]
    elif name == "csm-1b":
        meta["notes"] = [
            "transformers CsmForConditionalGeneration, non-streaming (no TTFB); no watermark "
            "(the official sesame generator adds an inaudible SilentCipher watermark).",
        ] + [n for n in meta["notes"] if not n.startswith("transformers CsmForConditionalGeneration")]
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    print(f"[{name}] done; peak VRAM {peak_mb} MB; meta -> {meta_path}", flush=True)

    eng.close()
    del eng
    gc.collect()
    torch.cuda.empty_cache()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", required=True)
    ap.add_argument("--samples", required=True)
    ap.add_argument("--engines", default="csm-1b,misotts-8b")
    ap.add_argument("--only", default="", help="comma list of line ids or clip ids (debug / partial re-run)")
    ap.add_argument("--min-free-gb", type=float, default=22.0, help="MisoTTS refuses to load below this free VRAM")
    args = ap.parse_args()

    lines = json.loads(Path(args.lines).read_text())
    samples = Path(args.samples).resolve()
    ref_text_all = json.loads((samples / "refs" / "transcripts.json").read_text())
    refs, ref_text = {}, {}
    for voice, v in lines["voices"].items():
        p = samples / v["ref"]
        refs[voice] = load_ref(p)
        ref_text[voice] = ref_text_all[p.stem]
    only = {s for s in args.only.split(",") if s} or None

    for name in [e for e in args.engines.split(",") if e]:
        if name == "misotts-8b":
            free, _ = torch.cuda.mem_get_info()
            if free / 2**30 < args.min_free_gb:
                print(f"[{name}] SKIP: only {free / 2**30:.1f} GB free VRAM (< {args.min_free_gb})", flush=True)
                continue
        run_engine(name, lines, samples, only, refs, ref_text)


if __name__ == "__main__":
    main()
