# Voice bake-off — the runner contract

Every engine speaks `lines.json` and nothing else. Ledger:
`docs/work/voice-bakeoff.md`.

## Layout

- `lines.json` — the script (conversation lines, one dialogue, read-aloud).
- `engines/<engine>/` — one uv project per engine family: `pyproject.toml`,
  `run.py`. Its `.venv/` is gitignored. Model weights go to the Hugging Face
  cache at `voice-engines/_models/_hf_cache` (set `HF_HOME` to it), never into
  git.
- Samples dir `S = voice-engines/_samples/bakeoff-2026-09-30/` (gitignored):
  `refs/` (CC0 reference voices + `transcripts.json`), `out/<engine>/`,
  `index.html`.

## Run

```bash
cd scripts/voice-bakeoff/engines/<engine>
HF_HOME=../../../../voice-engines/_models/_hf_cache uv run run.py \
  --lines ../../lines.json \
  --samples ../../../../voice-engines/_samples/bakeoff-2026-09-30
```

## What a runner writes

For each engine id `<engine>` (one runner may produce several, e.g.
`chatterbox-turbo` and `chatterbox-nano`):

- `out/<engine>/<lineId>__<voice>__t<take>.wav` for every conversation and
  read-aloud line × each of its `voices` × `takes` (take 1 = seed 1, take 2 =
  seed 2).
- `out/<engine>/d01-news__t<take>.wav`: the whole dialogue, all six turns
  concatenated with 350 ms of silence between turns, plus each being turn alone
  as `d01-news__turn<N>__t<take>.wav` (N = 1, 3, 5 — the hannah turns).
- `out/<engine>/meta.json`:

```json
{
  "engine": "chatterbox-turbo",
  "model": "ResembleAI/chatterbox-turbo",
  "license": "MIT",
  "clones": true,
  "voiceNote": "cloned from refs/Hannah.wav and refs/James.wav",
  "cues": "native [laugh] [chuckle] [sigh] [gasp]; {breath} dropped",
  "contextAware": false,
  "settings": { "temperature": 0.8 },
  "device": "cuda",
  "peakVramMb": 3120,
  "clips": {
    "c01-greet__hannah__t1": { "genMs": 812, "audioMs": 5210, "rtf": 0.156, "ttfbMs": 190 }
  },
  "notes": ["anything the listener should know: failures, workarounds, a cue the model read aloud"]
}
```

`ttfbMs` only when the engine truly streams and the runner measured the first
audio chunk; omit it otherwise. Timings on this rig are taken while the
benchmark shares the GPU: relative, not absolute.

## Rules

- **Fair chance.** Use each engine's own recommended settings and its native
  expressiveness (tags, exaggeration, emotion vectors, descriptions, context).
  Translate `{cue}` only into cues the model was trained on; drop the rest.
- **Same voice.** Cloning engines clone `refs/Hannah.wav` / `refs/James.wav`
  (transcripts in `refs/transcripts.json`). A non-cloning engine uses its
  closest preset and says so in `voiceNote`.
- Output is 24 kHz+ mono 16-bit WAV, peak-normalised to −1 dBFS so loudness
  never decides a vote.
- Nothing here ships. Model output stays under the gitignored samples dir.
