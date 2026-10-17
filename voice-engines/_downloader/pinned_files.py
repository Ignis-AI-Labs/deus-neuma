"""Pinned-file downloads (`download.method: "files"` in engines.json) with sha256 verification.

Each file entry names one file at one revision of a Hugging Face repo, its sha256 and size:

    {"repo": "unsloth/csm-1b", "revision": "<commit>", "path": "model.safetensors",
     "sha256": "<hex>", "bytes": 4153376052, "model": "csm-1b", "dest": "<optional>"}

It lands at voice-engines/<dest>, or — without `dest` — in the Hugging Face cache layout the sidecars
load from offline (_models/_hf_cache/hub/models--<org>--<name>/snapshots/<revision>/<path>, with
refs/main pointing at that revision). Entries with a `model` are fetched only for that model.

Downloads (curl) resume from `<dest>.part` and are renamed into place only when the sha256 matches. Progress is printed as one JSON object per line on stdout (the route's log is
machine-readable):

    {"event": "start", "engine": "csm", "model": "csm-1b", "files": 3, "bytes": 4555230932}
    {"event": "file", "dest": "...", "bytes": 4153376052, "status": "present" | "download"}
    {"event": "progress", "dest": "...", "done": 1048576, "bytes": 4153376052}
    {"event": "verified", "dest": "...", "sha256": "..."}
    {"event": "error", "dest": "...", "detail": "..."}
    {"event": "done", "engine": "csm", "model": "csm-1b"}

A receipt (_models/.verified.json: dest -> sha256, size, mtime) spares re-hashing tens of GB on every
run; a file whose size or mtime changed is hashed again.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

CHUNK = 1 << 20
PROGRESS_EVERY_S = 1.0


def emit(event: str, **fields) -> None:
    print(json.dumps({"event": event, **fields}), flush=True)


def file_dest(entry: dict) -> str:
    """Where an entry lands, relative to voice-engines/ (mirrors engine-registry.js engineFiles)."""
    if entry.get("dest"):
        return entry["dest"]
    org_name = entry["repo"].replace("/", "--", 1)
    return f"_models/_hf_cache/hub/models--{org_name}/snapshots/{entry['revision']}/{entry['path']}"


def select_files(download: dict, model: str | None) -> list[dict]:
    return [f for f in download.get("files", []) if not f.get("model") or f.get("model") == model]


def _inside(root: Path, rel: str) -> Path:
    """Lexical containment (no symlink following: _models may live on another drive)."""
    target = Path(os.path.normpath(root / rel))
    if Path(os.path.normpath(root)) not in target.parents:
        raise ValueError(f"refusing a destination outside {root}: {rel!r}")
    return target


def _sha256_file(path: Path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            h.update(block)
    return h


class Receipts:
    """dest -> {sha256, bytes, mtime_ns} of files this downloader has verified."""

    def __init__(self, path: Path):
        self.path = path
        try:
            self.data = json.loads(path.read_text())
        except (OSError, ValueError):
            self.data = {}

    def matches(self, dest: str, target: Path, entry: dict) -> bool:
        r = self.data.get(dest)
        st = target.stat()
        return bool(r) and r["sha256"] == entry["sha256"] and r["bytes"] == st.st_size and r["mtime_ns"] == st.st_mtime_ns

    def record(self, dest: str, target: Path, sha: str) -> None:
        st = target.stat()
        self.data[dest] = {"sha256": sha, "bytes": st.st_size, "mtime_ns": st.st_mtime_ns}
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=1, sort_keys=True))
        os.replace(tmp, self.path)


def _fetch(entry: dict, dest: str, target: Path) -> str:
    """curl the file into <target>.part (resuming a partial one), then hash it; returns the sha256 hex.
    curl, not Python's HTTP stack: huggingface_hub and urllib hang on this class of machine where curl
    does not (the same reason fetch_onnx.sh uses curl), and curl ships with Linux, macOS and Windows 10+."""
    part = target.with_name(target.name + ".part")
    if part.exists() and part.stat().st_size > entry["bytes"]:
        part.unlink()
    url = f"https://huggingface.co/{entry['repo']}/resolve/{entry['revision']}/{entry['path']}"
    cmd = ["curl", "-sSfL", "--retry", "3", "-C", "-", "-o", str(part), url]
    if os.environ.get("HF_TOKEN"):
        cmd[1:1] = ["-H", f"Authorization: Bearer {os.environ['HF_TOKEN']}"]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    while proc.poll() is None:
        emit("progress", dest=dest, done=part.stat().st_size if part.exists() else 0, bytes=entry["bytes"])
        time.sleep(PROGRESS_EVERY_S)
    if proc.returncode != 0:
        raise RuntimeError(f"{dest}: curl exited {proc.returncode}: {proc.stderr.read().strip()[:300]}")
    have = part.stat().st_size
    emit("progress", dest=dest, done=have, bytes=entry["bytes"])
    sha = _sha256_file(part).hexdigest()
    if sha != entry["sha256"] or have != entry["bytes"]:
        part.unlink(missing_ok=True)
        raise ValueError(f"{dest}: sha256 {sha} / {have} bytes, expected {entry['sha256']} / {entry['bytes']}")
    os.replace(part, target)
    return sha


def _point_ref(root: Path, entry: dict) -> None:
    """HF-cache entries: refs/main -> the pinned revision, so an offline snapshot lookup finds it."""
    if entry.get("dest"):
        return
    ref = root / "_models" / "_hf_cache" / "hub" / f"models--{entry['repo'].replace('/', '--', 1)}" / "refs" / "main"
    ref.parent.mkdir(parents=True, exist_ok=True)
    if not ref.exists() or ref.read_text().strip() != entry["revision"]:
        ref.write_text(entry["revision"])


def download_files(engine_id: str, download: dict, model: str | None, root: Path) -> None:
    """Fetch (or verify in place) every pinned file the engine needs for `model`. Raises on the first
    file that cannot be fetched or does not hash to its pin."""
    files = select_files(download, model)
    receipts = Receipts(root / "_models" / ".verified.json")
    emit("start", engine=engine_id, model=model, files=len(files), bytes=sum(f["bytes"] for f in files))
    for entry in files:
        dest = file_dest(entry)
        target = _inside(root, dest)
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            present = target.exists() and target.stat().st_size == entry["bytes"]
            emit("file", dest=dest, bytes=entry["bytes"], status="present" if present else "download")
            if present and receipts.matches(dest, target, entry):
                sha = entry["sha256"]
            elif present and _sha256_file(target).hexdigest() == entry["sha256"]:
                sha = entry["sha256"]
            else:
                sha = _fetch(entry, dest, target)
            receipts.record(dest, target, sha)
            _point_ref(root, entry)
            emit("verified", dest=dest, sha256=sha)
        except Exception as e:
            emit("error", dest=dest, detail=str(e))
            raise
    emit("done", engine=engine_id, model=model)
