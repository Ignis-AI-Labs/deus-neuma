"""Where the whisper sidecar's weights live — read from the pinned files in engines.json.

The whisper entry in voice-engines/engines.json lists every file the sidecar
needs (`download.method: "files"`, sha256-pinned, fetched by
`_downloader/download.py whisper` with curl). Each entry carries a `use`:
"transcribe" (the dictation / forge-words model behind POST /transcribe),
"stream" (the fallback live lane's model) or "live" (Nemotron, the live /stream lane's
model when pinned and present). This module turns that list into the
model directories and names any file that is not on disk — so the sidecar
can refuse plainly at startup instead of reaching for the network at first use.

Pure over the manifest + the filesystem; no imports beyond the stdlib.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

ENGINES_ROOT = Path(__file__).resolve().parent.parent      # voice-engines/
MANIFEST = ENGINES_ROOT / "engines.json"
FETCH_HINT = "run: uv run voice-engines/_downloader/download.py whisper"


def file_dest(entry: dict) -> str:
    """Mirror of _downloader/pinned_files.file_dest and engine-registry.js engineFiles."""
    if entry.get("dest"):
        return entry["dest"]
    org_name = entry["repo"].replace("/", "--", 1)
    return f"_models/_hf_cache/hub/models--{org_name}/snapshots/{entry['revision']}/{entry['path']}"


def pinned_files(manifest_path: Path = MANIFEST) -> list[dict]:
    with open(manifest_path) as f:
        manifest = json.load(f)
    return manifest["engines"]["whisper"]["download"].get("files", [])


WEIGHTS = ("model.bin", "model.safetensors")   # CTranslate2 whisper / transformers (Nemotron)


def model_dir(files: list[dict], use: str) -> Path | None:
    """The directory holding the `use` model's weights (None if not pinned)."""
    for entry in files:
        if entry.get("use") == use and entry["path"] in WEIGHTS:
            return (ENGINES_ROOT / file_dest(entry)).parent
    return None


def model_label(files: list[dict], use: str) -> str | None:
    """A short name for the `use` model: the repo's name (faster-whisper-tiny → tiny)."""
    for entry in files:
        if entry.get("use") == use and entry["path"] in WEIGHTS:
            name = entry["repo"].split("/", 1)[-1]
            return name.replace("faster-whisper-", "").replace("faster-", "")
    return None


def missing_files(files: list[dict], use: str, override_dir: str | None = None) -> list[str]:
    """Every pinned file for `use` that is absent or the wrong size — as paths a person can read.
    With an override directory (WHISPER_STREAM_MODEL_DIR — any CTranslate2 whisper export;
    NEMOTRON_MODEL_DIR — a transformers export), the files needed to load offline are
    expected there: weights, config, tokenizer (without tokenizer.json it would fetch one)."""
    if override_dir:
        weights = "model.safetensors" if use == "live" else "model.bin"
        return [str(Path(override_dir) / name) for name in (weights, "config.json", "tokenizer.json")
                if not (Path(override_dir) / name).is_file()]
    out = []
    for entry in files:
        if entry.get("use") != use:
            continue
        path = ENGINES_ROOT / file_dest(entry)
        try:
            ok = path.stat().st_size == entry["bytes"]
        except OSError:
            ok = False
        if not ok:
            out.append(f"voice-engines/{file_dest(entry)}")
    return out


def resolve(use: str, override_env: str | None = None) -> tuple[Path, str]:
    """(directory, label) for `use`, or raise FileNotFoundError naming each missing file."""
    files = pinned_files()
    override = os.environ.get(override_env) if override_env else None
    missing = missing_files(files, use, override)
    if missing:
        raise FileNotFoundError(
            f"whisper {use} model incomplete — missing {', '.join(missing)} ({FETCH_HINT})"
        )
    if override:
        return Path(override), Path(override).name
    directory = model_dir(files, use)
    if directory is None:
        raise FileNotFoundError(f"engines.json pins no whisper {use} model ({FETCH_HINT})")
    return directory, model_label(files, use) or use
