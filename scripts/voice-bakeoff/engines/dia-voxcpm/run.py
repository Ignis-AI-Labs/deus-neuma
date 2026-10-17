#!/usr/bin/env python3
"""Voice bake-off runner for two engines (contract: scripts/voice-bakeoff/README.md).

  dia2-2b  nari-labs/Dia2-2B   dialogue model, [S1]/[S2] tags, audio-prefix cloning,
                               the d01-news dialogue generated as ONE conversation
  voxcpm2  openbmb/VoxCPM2     "ultimate cloning" (prompt audio + transcript + reference)

With no --engines flag the runner re-invokes itself once per engine, so only one
model is ever resident and each engine's peak VRAM is measured on its own.

Weights: fetch.sh puts them in the HF cache layout under $HF_HOME; we load offline.
"""
from __future__ import annotations

import argparse
import gc
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import numpy as np
import soundfile as sf

ENGINES = ("dia2-2b", "voxcpm2")
HERE = Path(__file__).resolve().parent
TURN_GAP_MS = 350

# --- cue translation ---------------------------------------------------------
# Dia2's tokenizer (added_tokens.json / special_tokens_map.json in nari-labs/Dia2-2B)
# carries single-token nonverbals incl. (laughs) (sighs) (gasps). It has no chuckle
# and no breath token ((panting) is not a breath), so those two are dropped.
DIA2_CUES = {"laugh": "(laughs)", "sigh": "(sighs)", "gasp": "(gasps)"}
CUE_RE = re.compile(r"\{(\w+)\}")


def render_text(text: str, cue_map: dict[str, str]) -> str:
    out = CUE_RE.sub(lambda m: cue_map.get(m.group(1), ""), text)
    return re.sub(r"\s+", " ", out).strip()


def plain_words(text: str) -> list[str]:
    t = CUE_RE.sub(" ", text).lower().replace("’", "'")
    return re.findall(r"[a-z0-9']+", t)


# --- audio helpers -------------------------------------------------------------
def to_mono_f32(wav) -> np.ndarray:
    a = np.asarray(wav, dtype=np.float32)
    if a.ndim > 1:
        a = a.mean(axis=0) if a.shape[0] < a.shape[-1] else a.mean(axis=-1)
    return a


def write_norm(path: Path, audio: np.ndarray, sr: int) -> int:
    a = to_mono_f32(audio)
    peak = float(np.max(np.abs(a))) if a.size else 0.0
    if peak > 0:
        a = a * (10 ** (-1 / 20) / peak)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), a, sr, subtype="PCM_16")
    return int(round(1000 * len(a) / sr))


def trim_silence(a: np.ndarray, sr: int, top_db: float = 40.0, pad_ms: int = 60) -> np.ndarray:
    if a.size == 0:
        return a
    win = max(1, sr // 100)  # 10 ms frames
    n = len(a) // win
    if n == 0:
        return a
    rms = np.sqrt(np.mean(a[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
    thr = rms.max() * 10 ** (-top_db / 20)
    idx = np.where(rms > thr)[0]
    if idx.size == 0:
        return a
    pad = int(sr * pad_ms / 1000)
    s = max(0, idx[0] * win - pad)
    e = min(len(a), (idx[-1] + 1) * win + pad)
    return a[s:e]


def cuda_sync():
    import torch

    if torch.cuda.is_available():
        torch.cuda.synchronize()


def seed_all(seed: int):
    import random

    import torch

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


# --- job list -----------------------------------------------------------------
def single_jobs(lines: dict) -> list[dict]:
    jobs = []
    for item in lines["conversation"] + lines["readAloud"]:
        for voice in item["voices"]:
            for take in range(1, lines["takes"] + 1):
                jobs.append({"id": f"{item['id']}__{voice}__t{take}", "text": item["text"],
                             "voice": voice, "take": take})
    return jobs


# --- whisper word timings for Dia2 prefixes --------------------------------------
_WHISPER = None


def whisper_model():
    global _WHISPER
    if _WHISPER is None:
        import whisper_timestamped as wts

        _WHISPER = wts.load_model("openai/whisper-large-v3", device="cuda")
    return _WHISPER


def free_whisper():
    global _WHISPER
    _WHISPER = None
    gc.collect()
    import torch

    torch.cuda.empty_cache()


def asr_words(path: str) -> list[dict]:
    import whisper_timestamped as wts

    res = wts.transcribe(whisper_model(), path, language="en", verbose=None)
    words = []
    for seg in res.get("segments", []):
        for w in seg.get("words", []):
            t = (w.get("text") or "").strip()
            if t:
                words.append({"text": t, "start": float(w["start"]), "end": float(w["end"])})
    return words


def word_error_rate(ref: list[str], hyp: list[str]) -> float:
    if not ref:
        return 0.0
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
            prev, d[j] = d[j], cur
    return d[len(hyp)] / len(ref)


# ================================================================================
# Dia2
# ================================================================================
def run_dia2(lines: dict, samples: Path, out: Path, only: set[str] | None, notes: list[str]):
    import torch
    from dia2 import Dia2, GenerationConfig, SamplingConfig
    from dia2.runtime import voice_clone

    refs = samples / "refs"
    transcripts = json.loads((refs / "transcripts.json").read_text())
    ref_path = {v: str((samples / meta["ref"]).resolve()) for v, meta in lines["voices"].items()}

    # 0) Both refs are cut mid-speech at 10.0 s. Dia2 forces each prefix word at its
    #    whisper start frame (+3) during warm-up; a word starting in the last few
    #    frames is never consumed and the model then SPEAKS it at the head of the
    #    output ("Okay, bye." before every Hannah line). Appending 0.8 s of silence to
    #    the prefix lets every prefix word land inside the prefix.
    import tempfile

    pad_dir = Path(tempfile.mkdtemp(prefix="dia2-prefix-"))
    for v, p in list(ref_path.items()):
        a, sr0 = sf.read(p, dtype="float32")
        a = to_mono_f32(a)
        padded = pad_dir / Path(p).name
        sf.write(str(padded), np.concatenate([a, np.zeros(int(0.8 * sr0), np.float32)]), sr0, subtype="PCM_16")
        ref_path[v] = str(padded.resolve())
    notes.append("dia2 prefixes: refs padded with 0.8 s trailing silence (refs end mid-speech; see run.py)")

    # 1) Word timings for each reference (the repo transcribes prefixes with
    #    whisper-large-v3 on every call). Done once here; when whisper's word count
    #    matches refs/transcripts.json the transcript's own words replace whisper's.
    prefix_words: dict[str, list] = {}
    for voice, path in ref_path.items():
        words = asr_words(path)
        name = Path(path).stem
        truth = transcripts.get(name, "").split()
        if truth and len(truth) == len(words):
            for w, t in zip(words, truth):
                w["text"] = t
            src = "refs/transcripts.json words on whisper-large-v3 timings"
        else:
            src = f"whisper-large-v3 words ({len(words)} vs transcript {len(truth)} words, counts differ)"
        prefix_words[path] = [voice_clone.WhisperWord(w["text"], w["start"], w["end"]) for w in words]
        notes.append(f"dia2 prefix {name}: {src}: \"{' '.join(w['text'] for w in words)}\"")
    free_whisper()
    voice_clone.transcribe_words = lambda path, device, language=None: prefix_words[str(Path(path).resolve())]

    # Diagnostic: count prefix words the warm-up failed to consume (they would be spoken).
    import dia2.engine as dia2_engine

    leftovers: list[int] = []
    _warm = dia2_engine.warmup_with_prefix

    def _warm_checked(runtime, plan, state, generation):
        r = _warm(runtime, plan, state, generation)
        leftovers.append(len(plan.entries) - len(state.transcript))
        return r

    dia2_engine.warmup_with_prefix = _warm_checked

    torch.cuda.reset_peak_memory_stats()
    dia = Dia2.from_repo("nari-labs/Dia2-2B", device="cuda", dtype="bfloat16")
    config = GenerationConfig(
        cfg_scale=2.0,
        audio=SamplingConfig(temperature=0.8, top_k=50),
        use_cuda_graph=True,
    )
    settings = {"cfg_scale": 2.0, "audio_temperature": 0.8, "audio_top_k": 50,
                "text_temperature": 0.6, "text_top_k": 50, "dtype": "bfloat16",
                "use_cuda_graph": True, "note": "nari-labs model-card programmatic defaults"}

    def gen(script: str, s1: str, s2: str | None, seed: int):
        seed_all(seed)
        cuda_sync()
        t0 = time.perf_counter()
        res = dia.generate(script, config=config, prefix_speaker_1=s1, prefix_speaker_2=s2)
        cuda_sync()
        ms = (time.perf_counter() - t0) * 1000
        return res, ms

    # warm-up (untimed): CUDA graphs, Mimi, kernels
    gen("[S1] Warming up.", ref_path["hannah"], None, 0)
    clips = {}

    for job in single_jobs(lines):
        if only and not any(job["id"].startswith(o) for o in only):
            continue
        text = render_text(job["text"], DIA2_CUES)
        res, ms = gen(f"[S1] {text}", ref_path[job["voice"]], None, job["take"])
        sr = res.sample_rate
        audio_ms = write_norm(out / f"{job['id']}.wav", res.waveform.float().cpu().numpy(), sr)
        clips[job["id"]] = {"genMs": round(ms), "audioMs": audio_ms, "rtf": round(ms / audio_ms, 3),
                            "text": f"[S1] {text}"}
        if leftovers and leftovers[-1]:
            notes.append(f"dia2 {job['id']}: {leftovers[-1]} prefix words unconsumed after warm-up")
        print(f"[dia2] {job['id']}: {audio_ms} ms audio in {ms:.0f} ms", flush=True)

    # 2) The dialogue: one generation, james = [S1] (prefix speaker 1), hannah = [S2]
    #    (prefix speaker 2). Every turn is conditioned on both voices' prefix audio and
    #    on all earlier generated turns; per-turn files are cut on the model's own
    #    word timestamps.
    dlg = lines["dialogue"]
    if not only or any(dlg["id"].startswith(o) for o in only):
        tag = {"james": "[S1]", "hannah": "[S2]"}
        turn_texts = [render_text(t["text"], DIA2_CUES) for t in dlg["turns"]]
        script = " ".join(f"{tag[t['speaker']]} {tx}" for t, tx in zip(dlg["turns"], turn_texts))
        word_counts = [len(tx.split()) for tx in turn_texts]
        for take in range(1, lines["takes"] + 1):
            res, ms = gen(script, ref_path["james"], ref_path["hannah"], take)
            if leftovers and leftovers[-1]:
                notes.append(f"dia2 d01 t{take}: {leftovers[-1]} prefix words unconsumed after warm-up")
            sr = res.sample_rate
            wav = res.waveform.float().cpu().numpy()
            stamps = res.timestamps
            if os.environ.get("DIA2_DEBUG_DIR"):
                dbg = Path(os.environ["DIA2_DEBUG_DIR"])
                dbg.mkdir(parents=True, exist_ok=True)
                sf.write(str(dbg / f"d01_raw_t{take}.wav"), wav, sr)
                (dbg / f"d01_stamps_t{take}.json").write_text(json.dumps(stamps))
            starts, k = [], 0
            for n in word_counts:
                starts.append(stamps[k][1] if k < len(stamps) else None)
                k += n
            ok = len(stamps) == sum(word_counts) and all(s is not None for s in starts)
            if not ok:
                notes.append(f"dia2 d01 t{take}: {len(stamps)} word stamps for {sum(word_counts)} words; turn cut approximate")
                starts = [s if s is not None else len(wav) / sr for s in starts]
            # cut a little before each turn's first-word frame (Mimi frame = 80 ms)
            bounds = [0] + [max(0, int((s - 0.08) * sr)) for s in starts[1:]] + [len(wav)]
            pieces = [trim_silence(wav[bounds[i]:bounds[i + 1]], sr) for i in range(len(dlg["turns"]))]
            gap = np.zeros(int(sr * TURN_GAP_MS / 1000), dtype=np.float32)
            joined = []
            for i, p in enumerate(pieces):
                if i:
                    joined.append(gap)
                joined.append(p)
            full = np.concatenate(joined)
            cid = f"{dlg['id']}__t{take}"
            raw_ms = round(1000 * len(wav) / sr)
            audio_ms = write_norm(out / f"{cid}.wav", full, sr)
            clips[cid] = {"genMs": round(ms), "audioMs": audio_ms, "rtf": round(ms / raw_ms, 3),
                          "rawAudioMs": raw_ms, "text": script,
                          "turnStartsS": [round(s, 2) for s in starts]}
            for i, t in enumerate(dlg["turns"]):
                if t["speaker"] != "hannah":
                    continue
                tid = f"{dlg['id']}__turn{i}__t{take}"
                t_ms = write_norm(out / f"{tid}.wav", pieces[i], sr)
                clips[tid] = {"genMs": round(ms * t_ms / raw_ms), "audioMs": t_ms,
                              "rtf": round(ms / raw_ms, 3), "genShared": cid, "text": turn_texts[i]}
            print(f"[dia2] {cid}: {raw_ms} ms audio in {ms:.0f} ms; turn starts {clips[cid]['turnStartsS']}", flush=True)

    peak = torch.cuda.max_memory_allocated() / 2**20
    meta = {
        "engine": "dia2-2b",
        "model": "nari-labs/Dia2-2B",
        "license": "Apache-2.0",
        "clones": True,
        "voiceNote": "cloned by audio prefix: refs/Hannah.wav / refs/James.wav as prefix speaker 1 for single lines; "
                     "dialogue uses James.wav as [S1] prefix and Hannah.wav as [S2] prefix",
        "cues": "native (laughs) (sighs) (gasps) (tokenizer added tokens); {chuckle} {breath} dropped (no trained token)",
        "contextAware": True,
        "contextNote": "d01-news generated as one [S1]/[S2] conversation in a single pass; each hannah turn is conditioned "
                       "on both reference prefixes and every earlier turn. Per-turn WAVs are cut on the model's word "
                       "timestamps; the concatenated file replaces the model's own inter-turn pauses with 350 ms gaps. "
                       "Turn clip genMs is the single-pass time apportioned by duration.",
        "settings": settings,
        "device": "cuda",
        "peakVramMb": round(peak),
        "sampleRate": 24000,
        "clips": clips,
        "notes": notes,
    }
    del dia
    gc.collect()
    torch.cuda.empty_cache()
    return meta


# ================================================================================
# VoxCPM2
# ================================================================================
def run_voxcpm(lines: dict, samples: Path, out: Path, only: set[str] | None, notes: list[str]):
    import torch
    from huggingface_hub import snapshot_download
    from voxcpm import VoxCPM

    refs = samples / "refs"
    transcripts = json.loads((refs / "transcripts.json").read_text())
    ref_path = {v: str((samples / meta["ref"]).resolve()) for v, meta in lines["voices"].items()}
    ref_text = {v: transcripts[Path(p).stem] for v, p in ref_path.items()}

    torch.cuda.reset_peak_memory_stats()
    local = snapshot_download("openbmb/VoxCPM2", local_files_only=True)
    optimize = os.environ.get("VOXCPM_OPTIMIZE", "1") == "1"
    model = VoxCPM.from_pretrained(local, load_denoiser=False, optimize=optimize)
    sr = model.tts_model.sample_rate
    settings = {"cfg_value": 2.0, "inference_timesteps": 10, "mode": "ultimate cloning (prompt_wav + prompt_text + reference_wav)",
                "normalize": False, "denoise": False, "retry_badcase": True, "torch_compile": optimize,
                "note": "model-card recommended cfg/steps"}

    def gen(text: str, voice: str, seed: int):
        seed_all(seed)
        cuda_sync()
        t0 = time.perf_counter()
        wav = model.generate(text=text, prompt_wav_path=ref_path[voice], prompt_text=ref_text[voice],
                             reference_wav_path=ref_path[voice], cfg_value=2.0, inference_timesteps=10)
        cuda_sync()
        return wav, (time.perf_counter() - t0) * 1000

    gen("Warming up the model.", "hannah", 0)
    clips = {}
    for job in single_jobs(lines):
        if only and not any(job["id"].startswith(o) for o in only):
            continue
        text = render_text(job["text"], {})
        wav, ms = gen(text, job["voice"], job["take"])
        audio_ms = write_norm(out / f"{job['id']}.wav", wav, sr)
        clips[job["id"]] = {"genMs": round(ms), "audioMs": audio_ms, "rtf": round(ms / audio_ms, 3), "text": text}
        print(f"[voxcpm2] {job['id']}: {audio_ms} ms audio in {ms:.0f} ms", flush=True)

    dlg = lines["dialogue"]
    if not only or any(dlg["id"].startswith(o) for o in only):
        for take in range(1, lines["takes"] + 1):
            pieces, total_ms = [], 0.0
            for i, t in enumerate(dlg["turns"]):
                text = render_text(t["text"], {})
                wav, ms = gen(text, t["speaker"], take * 100 + i)
                total_ms += ms
                a = to_mono_f32(wav)
                pieces.append(a)
                if t["speaker"] == "hannah":
                    tid = f"{dlg['id']}__turn{i}__t{take}"
                    t_ms = write_norm(out / f"{tid}.wav", a, sr)
                    clips[tid] = {"genMs": round(ms), "audioMs": t_ms, "rtf": round(ms / t_ms, 3), "text": text}
            gap = np.zeros(int(sr * TURN_GAP_MS / 1000), dtype=np.float32)
            joined = []
            for i, p in enumerate(pieces):
                if i:
                    joined.append(gap)
                joined.append(p)
            cid = f"{dlg['id']}__t{take}"
            audio_ms = write_norm(out / f"{cid}.wav", np.concatenate(joined), sr)
            speech_ms = audio_ms - TURN_GAP_MS * (len(pieces) - 1)
            clips[cid] = {"genMs": round(total_ms), "audioMs": audio_ms, "rtf": round(total_ms / speech_ms, 3)}
            print(f"[voxcpm2] {cid}: {audio_ms} ms audio in {total_ms:.0f} ms", flush=True)

    peak = torch.cuda.max_memory_allocated() / 2**20
    meta = {
        "engine": "voxcpm2",
        "model": "openbmb/VoxCPM2",
        "license": "Apache-2.0",
        "clones": True,
        "voiceNote": "ultimate cloning from refs/Hannah.wav / refs/James.wav: same clip as prompt_wav (with its "
                     "refs/transcripts.json transcript) and as reference_wav, per the model card",
        "cues": "none (no trained cue tokens); every {cue} removed; emotion is inferred by the model from the text. "
                "No style-control parenthetical used (that is a reference-only feature; ultimate cloning is continuation)",
        "contextAware": False,
        "settings": settings,
        "device": "cuda",
        "peakVramMb": round(peak),
        "sampleRate": sr,
        "clips": clips,
        "notes": notes,
    }
    del model
    gc.collect()
    torch.cuda.empty_cache()
    return meta


# ================================================================================
# QA: ASR every clip, flag runaways / truncations
# ================================================================================
def run_qa(out: Path, lines: dict):
    meta_path = out / "meta.json"
    meta = json.loads(meta_path.read_text())
    texts = {}
    for item in lines["conversation"] + lines["readAloud"]:
        texts[item["id"]] = item["text"]
    dlg = lines["dialogue"]
    flagged = []
    for cid, clip in meta["clips"].items():
        wav = out / f"{cid}.wav"
        if not wav.exists():
            continue
        if cid.startswith(dlg["id"] + "__turn"):
            n = int(cid.split("__turn")[1].split("__")[0])
            ref = dlg["turns"][n]["text"]
        elif cid.startswith(dlg["id"]):
            ref = " ".join(t["text"] for t in dlg["turns"])
        else:
            ref = texts[cid.split("__")[0]]
        hyp_words = asr_words(str(wav))
        hyp = " ".join(w["text"] for w in hyp_words)
        wer = word_error_rate(plain_words(ref), plain_words(hyp))
        clip["asr"] = hyp
        clip["asrWer"] = round(wer, 3)
        n_words = len(plain_words(ref))
        clip["msPerWord"] = round(clip["audioMs"] / max(1, n_words))
        if wer > 0.25:
            flagged.append(f"{cid}: ASR WER {wer:.2f} — heard \"{hyp}\"")
        print(f"[qa] {meta['engine']} {cid}: WER {wer:.2f}", flush=True)
    meta["notes"] = [n for n in meta.get("notes", []) if not n.startswith("QA:")]
    meta["notes"].append("QA: whisper-large-v3 transcribed every clip (clip.asr / clip.asrWer, cues excluded from the reference text).")
    meta["notes"].extend(f"QA: {f}" for f in flagged)
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    free_whisper()


# ================================================================================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", required=True)
    ap.add_argument("--samples", required=True)
    ap.add_argument("--engines", default=None, help="comma list of: " + ",".join(ENGINES))
    ap.add_argument("--only", default=None, help="comma list of clip-id prefixes (debug)")
    ap.add_argument("--no-qa", action="store_true", help="skip the whisper ASR check")
    args = ap.parse_args()

    engines = args.engines.split(",") if args.engines else list(ENGINES)
    if len(engines) > 1:
        # one process per engine: one model resident at a time, clean peak VRAM
        for e in engines:
            cmd = [sys.executable, __file__, "--lines", args.lines, "--samples", args.samples, "--engines", e]
            if args.only:
                cmd += ["--only", args.only]
            if args.no_qa:
                cmd.append("--no-qa")
            print(f"== {e}", flush=True)
            rc = subprocess.call(cmd)
            if rc:
                print(f"!! {e} exited {rc}", flush=True)
        return

    engine = engines[0]
    lines = json.loads(Path(args.lines).read_text())
    samples = Path(args.samples).resolve()
    out = samples / "out" / engine
    out.mkdir(parents=True, exist_ok=True)
    only = set(args.only.split(",")) if args.only else None
    notes: list[str] = []
    if engine == "dia2-2b":
        meta = run_dia2(lines, samples, out, only, notes)
    elif engine == "voxcpm2":
        meta = run_voxcpm(lines, samples, out, only, notes)
    else:
        raise SystemExit(f"unknown engine {engine}")
    rtfs = sorted(c["rtf"] for k, c in meta["clips"].items() if "genShared" not in c)
    if rtfs:
        meta["medianRtf"] = rtfs[len(rtfs) // 2] if len(rtfs) % 2 else round((rtfs[len(rtfs) // 2 - 1] + rtfs[len(rtfs) // 2]) / 2, 3)
    (out / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"[{engine}] wrote {len(meta['clips'])} clips, peak VRAM {meta['peakVramMb']} MB, median RTF {meta.get('medianRtf')}", flush=True)
    if not args.no_qa:
        run_qa(out, lines)


if __name__ == "__main__":
    main()
