# Existing engines (the baseline to beat)

Runners for the four engines Neuma already carries. Each imports the model
directly inside that sidecar's own venv (no server, no ports, no `uv sync`);
`common.py` holds the shared loop from `../../README.md`. Run from the repo
root; defaults point at `lines.json` and the `bakeoff-2026-09-30` samples dir
(`--lines` / `--samples` override). One model on the GPU at a time.

```bash
voice-engines/kokoro/.venv/bin/python scripts/voice-bakeoff/engines/existing/run_kokoro.py   # -> out/kokoro
voice-engines/zonos/.venv/bin/python  scripts/voice-bakeoff/engines/existing/run_zonos.py    # -> out/zonos
voice-engines/kyutai/.venv/bin/python scripts/voice-bakeoff/engines/existing/run_kyutai.py   # -> out/kyutai
voice-engines/qwen3/.venv/bin/python  scripts/voice-bakeoff/engines/existing/run_qwen3.py    # -> out/qwen3-tts (ICL clone)
QWEN3_CLONE_MODE=xvec voice-engines/qwen3/.venv/bin/python scripts/voice-bakeoff/engines/existing/run_qwen3.py  # -> out/qwen3-tts-xvec (sidecar's embedding-only clone)
```

Debug a subset with `--only c01-greet --takes 1` (writes `meta.partial.json`,
never clobbers `meta.json`).
