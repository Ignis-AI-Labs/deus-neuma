"""Voice bake-off runner: Llama-style LMs that emit SNAC 24 kHz codes.

Engines:
  orpheus-3b  unsloth/orpheus-3b-0.1-ft (ungated mirror of canopylabs/orpheus-3b-0.1-ft)
  maya1       maya-research/maya1

Contract: scripts/voice-bakeoff/README.md. Plain transformers, full-sequence
generation (no streaming, so no ttfbMs). One model on the GPU at a time.
"""

import argparse
import gc
import json
import re
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from snac import SNAC
from transformers import AutoModelForCausalLM, AutoTokenizer

SR = 24000
GAP_MS = 350
PEAK_DBFS = -1.0

# Shared SNAC-LM token layout (Orpheus and Maya1 use the same Llama-3 extension).
START_OF_HUMAN = 128259
END_OF_HUMAN = 128260
START_OF_AI = 128261
START_OF_SPEECH = 128257
END_OF_SPEECH = 128258
END_OF_TEXT = 128009
CODE_OFFSET = 128266
CODE_MAX = CODE_OFFSET + 7 * 4096 - 1  # 156937

# ---------------------------------------------------------------- engines ---

ORPHEUS = {
    "engine": "orpheus-3b",
    "model": "unsloth/orpheus-3b-0.1-ft",
    "license": (
        "Llama 3.2 Community License (weights are a finetune of meta-llama/Llama-3.2-3B-Instruct; "
        "the canopylabs and unsloth cards both say apache-2.0, which covers Canopy's code/finetune "
        "only - the Llama 3.2 licence and its attribution/AUP terms carry through to the weights)"
    ),
    "clones": False,
    # Orpheus-TTS README: voices in order of conversational realism
    # tara, leah, jess, leo, dan, mia, zac, zoe.
    "voices": {"hannah": "tara", "james": "leo"},
    "voiceNote": (
        "no cloning in the ft model; preset voices: hannah -> 'tara' (the card's top-ranked, "
        "warm young American woman), james -> 'leo' (top-ranked male preset)"
    ),
    # Orpheus-TTS README trained tags: <laugh> <chuckle> <sigh> <cough> <sniffle> <groan> <yawn> <gasp>
    "cueMap": {"laugh": "<laugh>", "chuckle": "<chuckle>", "sigh": "<sigh>", "gasp": "<gasp>", "breath": None},
    "cues": "native <laugh> <chuckle> <sigh> <gasp>; {breath} dropped (no trained breath tag)",
    # orpheus-speech package (engine_class.generate_tokens_sync) defaults.
    "settings": {
        "temperature": 0.6,
        "top_p": 0.8,
        "repetition_penalty": 1.3,
        "max_new_tokens": 4096,
        "eos_token_id": END_OF_SPEECH,
        "dtype": "bfloat16",
        "backend": "transformers generate (full sequence)",
    },
}

MAYA_DESCRIPTIONS = {
    # Built from lines.json presetHint in Maya1's prompt.txt attribute vocabulary;
    # identical for every line of a voice.
    "hannah": (
        "Realistic female voice in her late 20s with an american accent. Normal pitch, warm timbre, "
        "conversational pacing, neutral tone at med intensity, casual register."
    ),
    "james": (
        "Realistic male voice in his 30s with an american accent. Normal pitch, smooth timbre, "
        "conversational pacing, calm neutral tone at low intensity, casual register."
    ),
}

MAYA1 = {
    "engine": "maya1",
    "model": "maya-research/maya1",
    "license": "Apache-2.0",
    "clones": False,
    "voices": MAYA_DESCRIPTIONS,
    "voiceNote": (
        "no audio cloning; voices DESIGNED by description (same description on every line): "
        f"hannah = \"{MAYA_DESCRIPTIONS['hannah']}\"; james = \"{MAYA_DESCRIPTIONS['james']}\""
    ),
    # emotions.txt: laugh laugh_harder sigh chuckle gasp angry excited whisper cry scream sing
    # snort exhale gulp giggle sarcastic curious
    "cueMap": {"laugh": "<laugh>", "chuckle": "<chuckle>", "sigh": "<sigh>", "gasp": "<gasp>", "breath": "<exhale>"},
    # lines.json emotion -> an emotions.txt tag prepended to the line (only where one fits).
    # <curious> was tried on c08 and dropped: in both seeds Maya1 spoke "curious/cursor..." on a loop
    # and then read its own voice description aloud, never the line (no end-of-speech on seed 2).
    "emotionTags": {"excited": "<excited>", "intimate": "<whisper>"},
    "cues": (
        "native <laugh> <chuckle> <sigh> <gasp>; {breath} -> <exhale>; emotion tags prepended: "
        "excited -> <excited> (c04), intimate -> <whisper> (c06); no other emotion gets a tag "
        "(<curious> on c08 broke generation and was dropped)"
    ),
    # Maya1 card quick-start settings.
    "settings": {
        "temperature": 0.4,
        "top_p": 0.9,
        "repetition_penalty": 1.1,
        "max_new_tokens": 2048,
        "min_new_tokens": 28,
        "eos_token_id": END_OF_SPEECH,
        "trimWarmupSamples": 2048,
        "dtype": "bfloat16",
        "backend": "transformers generate (full sequence)",
    },
    "extraNotes": [
        "A first pass prepended <curious> to c08-curious: both seeds looped 'curious/cursor' and then "
        "spoke the voice description text instead of the line (seed 2 ran to max_new_tokens). The tag "
        "is dropped; c08 is spoken untagged.",
    ],
}

ENGINES = {"orpheus-3b": ORPHEUS, "maya1": MAYA1}

# ------------------------------------------------------------------ text ----

CUE_RE = re.compile(r"\{(\w+)\}")


def translate(text: str, cue_map: dict) -> str:
    def sub(m):
        tag = cue_map.get(m.group(1))
        return f" {tag} " if tag else " "

    out = CUE_RE.sub(sub, text)
    out = re.sub(r"\s+", " ", out).strip()
    return re.sub(r"\s+([,.?!])", r"\1", out)


def spoken_chars(text: str) -> int:
    return len(re.sub(r"\s+", " ", CUE_RE.sub("", text)).strip())


# ----------------------------------------------------------------- audio ----


def peak_normalize(x: np.ndarray) -> np.ndarray:
    x = x.astype(np.float32)
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    if peak <= 0:
        return x
    return x * (10 ** (PEAK_DBFS / 20) / peak)


def write_wav(path: Path, x: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), peak_normalize(x), SR, subtype="PCM_16")


def snac_decode(snac_model, codes7: list[int]) -> np.ndarray:
    """codes7: per-frame 7 codes already reduced to 0..4095 (frame order a,b,c,d,e,f,g)."""
    n = len(codes7) // 7
    if n == 0:
        return np.zeros(0, dtype=np.float32)
    f = np.array(codes7[: n * 7], dtype=np.int64).reshape(n, 7)
    l1 = f[:, 0]
    l2 = f[:, [1, 4]].reshape(-1)
    l3 = f[:, [2, 3, 5, 6]].reshape(-1)
    dev = next(snac_model.parameters()).device
    codes = [torch.from_numpy(c).unsqueeze(0).to(dev) for c in (l1, l2, l3)]
    with torch.inference_mode():
        audio = snac_model.decode(codes)
    return audio[0, 0].float().cpu().numpy()


# ------------------------------------------------------------ generation ----


class Runner:
    def __init__(self, spec: dict, device: str):
        self.spec = spec
        self.device = device
        repo = spec["model"]
        self.tok = AutoTokenizer.from_pretrained(repo)
        self.model = AutoModelForCausalLM.from_pretrained(repo, torch_dtype=torch.bfloat16).to(device).eval()
        self.snac = SNAC.from_pretrained("hubertsiuzdak/snac_24khz").eval().to(device)

    def prompt_ids(self, voice: str, text: str) -> torch.Tensor:
        if self.spec["engine"] == "orpheus-3b":
            # orpheus-speech _format_prompt: SOH + tok("tara: text") + EOT EOH SOA SOS
            ids = self.tok(f"{self.spec['voices'][voice]}: {text}", return_tensors="pt").input_ids
            pre = torch.tensor([[START_OF_HUMAN]])
            post = torch.tensor([[END_OF_TEXT, END_OF_HUMAN, START_OF_AI, START_OF_SPEECH]])
            return torch.cat([pre, ids, post], dim=1)
        # Maya1 card build_prompt: SOH BOS <description="..."> text EOT EOH SOA SOS, then tokenizer()
        t = self.tok
        prompt = (
            t.decode([START_OF_HUMAN]) + t.bos_token + f'<description="{self.spec["voices"][voice]}"> {text}'
            + t.decode([END_OF_TEXT]) + t.decode([END_OF_HUMAN]) + t.decode([START_OF_AI])
            + t.decode([START_OF_SPEECH])
        )
        return t(prompt, return_tensors="pt").input_ids

    def codes_from(self, gen: list[int]) -> tuple[list[int], dict]:
        info = {"eos": END_OF_SPEECH in gen, "newTokens": len(gen)}
        if self.spec["engine"] == "orpheus-3b":
            # Orpheus reference: crop after the last SOS, drop EOS, subtract offset + (i%7)*4096.
            if START_OF_SPEECH in gen:
                gen = gen[len(gen) - 1 - gen[::-1].index(START_OF_SPEECH) + 1 :]
            if END_OF_SPEECH in gen:
                gen = gen[: gen.index(END_OF_SPEECH)]
            raw = [t for t in gen if CODE_OFFSET <= t <= CODE_MAX]
            raw = raw[: len(raw) // 7 * 7]
            codes, bad = [], 0
            for i, t in enumerate(raw):
                c = t - CODE_OFFSET - (i % 7) * 4096
                if not 0 <= c < 4096:
                    bad += 1
                codes.append(c % 4096)
            info["misplacedCodes"] = bad
            return codes, info
        # Maya1 reference extract_snac_codes + unpack_snac_from_7 (mod 4096).
        if END_OF_SPEECH in gen:
            gen = gen[: gen.index(END_OF_SPEECH)]
        raw = [t for t in gen if CODE_OFFSET <= t <= CODE_MAX]
        raw = raw[: len(raw) // 7 * 7]
        return [(t - CODE_OFFSET) % 4096 for t in raw], info

    def synth(self, voice: str, text: str, seed: int) -> tuple[np.ndarray, dict]:
        s = self.spec["settings"]
        ids = self.prompt_ids(voice, text).to(self.device)
        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        kw = dict(
            max_new_tokens=s["max_new_tokens"],
            do_sample=True,
            temperature=s["temperature"],
            top_p=s["top_p"],
            repetition_penalty=s["repetition_penalty"],
            eos_token_id=s["eos_token_id"],
            pad_token_id=self.tok.pad_token_id if self.tok.pad_token_id is not None else 128004,
        )
        if "min_new_tokens" in s:
            kw["min_new_tokens"] = s["min_new_tokens"]
        if self.device == "cuda":
            torch.cuda.synchronize()
        t0 = time.perf_counter()
        with torch.inference_mode():
            out = self.model.generate(input_ids=ids, attention_mask=torch.ones_like(ids), **kw)
        gen = out[0, ids.shape[1] :].tolist()
        codes, info = self.codes_from(gen)
        audio = snac_decode(self.snac, codes)
        if "trimWarmupSamples" in s and len(audio) > s["trimWarmupSamples"]:
            audio = audio[s["trimWarmupSamples"] :]
        if self.device == "cuda":
            torch.cuda.synchronize()
        gen_ms = (time.perf_counter() - t0) * 1000
        info["hitMaxTokens"] = len(gen) >= s["max_new_tokens"]
        return audio, {"genMs": round(gen_ms), **info}

    def close(self):
        del self.model, self.snac
        gc.collect()
        torch.cuda.empty_cache()


def clip_stat(audio: np.ndarray, info: dict, text: str) -> dict:
    audio_ms = len(audio) / SR * 1000
    chars = spoken_chars(text)
    stat = {
        "genMs": info["genMs"],
        "audioMs": round(audio_ms),
        "rtf": round(info["genMs"] / audio_ms, 3) if audio_ms else None,
        "msPerChar": round(audio_ms / chars, 1) if chars else None,
        "newTokens": info["newTokens"],
        "eos": info["eos"],
    }
    if info.get("misplacedCodes"):
        stat["misplacedCodes"] = info["misplacedCodes"]
    return stat


def flag(key: str, stat: dict, notes: list):
    # Conversational English ~ 55-90 ms per character; far outside = truncation or runaway.
    if not stat["eos"] or stat.get("hitMaxTokens"):
        notes.append(f"{key}: no end-of-speech token before max_new_tokens (runaway/truncated)")
    mpc = stat["msPerChar"] or 0
    if mpc > 160:
        notes.append(f"{key}: {stat['audioMs']} ms for the text ({mpc} ms/char) - long for the text: pauses, a long cue, or a runaway")
    elif mpc < 35:
        notes.append(f"{key}: {stat['audioMs']} ms for the text ({mpc} ms/char) - likely truncated/skipped words")
    if stat.get("misplacedCodes"):
        notes.append(f"{key}: {stat['misplacedCodes']} SNAC codes in the wrong frame slot (wrapped mod 4096)")


def run_engine(spec: dict, lines: dict, samples: Path, device: str):
    out_dir = samples / "out" / spec["engine"]
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.cuda.reset_peak_memory_stats()
    runner = Runner(spec, device)
    clips, notes, texts = {}, [], {}
    takes = int(lines.get("takes", 2))
    cue_map = spec["cueMap"]
    emo_tags = spec.get("emotionTags", {})

    def text_for(item_text: str, emotion: str | None) -> str:
        t = translate(item_text, cue_map)
        tag = emo_tags.get(emotion or "")
        return f"{tag} {t}" if tag else t

    def do(key: str, voice: str, raw_text: str, emotion: str | None, seed: int):
        text = text_for(raw_text, emotion)
        audio, info = runner.synth(voice, text, seed)
        stat = clip_stat(audio, info, raw_text)
        stat["hitMaxTokens"] = info["hitMaxTokens"]
        flag(key, stat, notes)
        stat.pop("hitMaxTokens")
        clips[key] = stat
        texts[key] = text
        print(f"[{spec['engine']}] {key}: {stat}", flush=True)
        return audio

    for take in range(1, takes + 1):
        for item in lines["conversation"] + lines.get("readAloud", []):
            for voice in item["voices"]:
                key = f"{item['id']}__{voice}__t{take}"
                audio = do(key, voice, item["text"], item.get("emotion"), take)
                write_wav(out_dir / f"{key}.wav", audio)

        dlg = lines["dialogue"]
        gap = np.zeros(int(SR * GAP_MS / 1000), dtype=np.float32)
        parts = []
        for n, turn in enumerate(dlg["turns"]):
            key = f"{dlg['id']}__turn{n}__t{take}"
            audio = do(key, turn["speaker"], turn["text"], turn.get("emotion"), take)
            if turn["speaker"] == "hannah":
                write_wav(out_dir / f"{key}.wav", audio)
            if parts:
                parts.append(gap)
            parts.append(peak_normalize(audio))
        write_wav(out_dir / f"{dlg['id']}__t{take}.wav", np.concatenate(parts))

    peak_mb = round(torch.cuda.max_memory_allocated() / 2**20) if device == "cuda" else None
    runner.close()

    rtfs = sorted(c["rtf"] for c in clips.values() if c["rtf"])
    meta = {
        "engine": spec["engine"],
        "model": spec["model"],
        "license": spec["license"],
        "clones": spec["clones"],
        "voiceNote": spec["voiceNote"],
        "cues": spec["cues"],
        "contextAware": False,
        "settings": spec["settings"],
        "device": device,
        "peakVramMb": peak_mb,
        "medianRtf": rtfs[len(rtfs) // 2] if rtfs else None,
        "clips": clips,
        "promptTexts": texts,
        "notes": [
            "Non-streaming transformers generate + one SNAC decode per clip; no ttfbMs. "
            "Timings taken while a benchmark shares the GPU: relative, not absolute.",
            "Dialogue turns are spoken alone (engine is not context-aware); james turns use the "
            "engine's own james voice. Each turn is peak-normalised before concatenation.",
            *spec.get("extraNotes", []),
            *notes,
        ],
    }
    if spec["engine"] == "maya1":
        meta["voiceDescriptions"] = MAYA_DESCRIPTIONS
    else:
        meta["voicePresets"] = spec["voices"]
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"[{spec['engine']}] done: {len(clips)} clips, median RTF {meta['medianRtf']}, peak {peak_mb} MB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", required=True)
    ap.add_argument("--samples", required=True)
    ap.add_argument("--engines", default="orpheus-3b,maya1")
    args = ap.parse_args()
    lines = json.loads(Path(args.lines).read_text())
    device = "cuda" if torch.cuda.is_available() else "cpu"
    for name in args.engines.split(","):
        run_engine(ENGINES[name.strip()], lines, Path(args.samples), device)


if __name__ == "__main__":
    main()
