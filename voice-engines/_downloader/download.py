"""Engine-aware model downloader.

Reads ../engines.json, resolves the HF repo + allow-patterns for the requested
engine, and snapshots it into ../_models/<engine_id>/. Engines with
download.method "files" (the ONE VOICE engines) fetch pinned files instead,
sha256-verified, with JSON progress lines (see pinned_files.py); --model picks
the model of a multi-model engine (default: its defaultModel).

Idempotent: re-running skips files already on disk. Set HF_HUB_ENABLE_HF_TRANSFER=1
in the env for faster downloads (requires hf_transfer installed).

Usage:
    uv run download.py <engine_id> [<engine_id> ...]
    uv run download.py csm --model misotts-8b
    uv run download.py --all-local
    uv run download.py --list
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

from pinned_files import download_files, file_dest, select_files

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "engines.json"
CACHE_ROOT = ROOT / "_models"


def load_manifest() -> dict:
    with MANIFEST_PATH.open() as f:
        return json.load(f)


def resolve_engine(engine_id: str, manifest: dict) -> dict:
    engines = manifest.get("engines", {})
    if engine_id not in engines:
        raise SystemExit(f"unknown engine: {engine_id!r} (known: {', '.join(engines)})")
    engine = engines[engine_id]
    if engine.get("type") != "local":
        raise SystemExit(f"{engine_id!r} is not a local engine (type={engine.get('type')})")
    download = engine.get("download", {})
    if download.get("method") not in ("huggingface_snapshot", "files"):
        raise SystemExit(
            f"{engine_id!r} download method is {download.get('method')!r}, "
            "not 'huggingface_snapshot' — handle manually"
        )
    return engine


def snapshot_repo(download: dict, target: Path) -> None:
    """Snapshot one HF repo (optionally revision-pinned) into target."""
    snapshot_download(
        repo_id=download["repo"],
        local_dir=str(target),
        allow_patterns=download.get("allowPatterns"),
        revision=download.get("revision"),
        cache_dir=str(CACHE_ROOT / "_hf_cache"),
    )


def repo_blocks(download: dict) -> list[dict]:
    """The primary repo block plus any extraRepos, as one uniform list."""
    return [download, *download.get("extraRepos", [])]


def block_target(engine_root: Path, block: dict) -> Path:
    """Where one repo block lands. Default is the managed engine dir itself;
    a block declaring targetSubdir lands under that subdir instead (qwen3:
    two repos whose root filenames collide — config.json, model.safetensors —
    so base/ + voice-design/ are the law)."""
    return engine_root / block.get("targetSubdir", "")


def download_engine(engine_id: str, manifest: dict, model: str | None = None) -> Path:
    engine = resolve_engine(engine_id, manifest)
    download = engine["download"]
    if download["method"] == "files":
        chosen = model or engine.get("defaultModel")
        if engine.get("models") and chosen not in engine["models"]:
            raise SystemExit(f"{engine_id!r} has no model {chosen!r} (known: {', '.join(engine['models'])})")
        download_files(engine_id, download, chosen, ROOT)
        return ROOT
    target = CACHE_ROOT / engine_id
    target.mkdir(parents=True, exist_ok=True)

    # Every block (primary + extraRepos) snapshots at repo-relative paths
    # under its block_target. A GATED repo raises on the first unauthenticated
    # fetch — the engine's notes field in engines.json names the auth
    # requirement.
    for block in repo_blocks(download):
        dest = block_target(target, block)
        dest.mkdir(parents=True, exist_ok=True)
        print(f"[{engine_id}] downloading from {block['repo']} → {dest}", flush=True)
        snapshot_repo(block, dest)
    print(f"[{engine_id}] done", flush=True)
    return target


def list_engines(manifest: dict) -> None:
    for eid, e in manifest.get("engines", {}).items():
        if e.get("type") != "local":
            continue
        download = e.get("download", {})
        if download.get("method") == "files":
            for m in (e.get("models") or {None: None}):
                files = select_files(download, m)
                # size check only — the sha256 was verified when the file landed
                on_disk = "✓" if all((ROOT / file_dest(f)).is_file()
                                     and (ROOT / file_dest(f)).stat().st_size == f["bytes"] for f in files) else " "
                gb = round(sum(f["bytes"] for f in files) / 1e9, 1)
                print(f"  {on_disk} {eid:12} {gb}GB  {len(files)} pinned files" + (f" (--model {m})" if m else ""))
            continue
        if download.get("method") != "huggingface_snapshot":
            print(f"  {eid:12} (manual setup required)")
            continue
        target = CACHE_ROOT / eid
        size_gb = e.get("requirements", {}).get("diskGb", "?")
        blocks = repo_blocks(download)
        # On-disk truth is per block: a qwen3 root with only base/ present is
        # NOT downloaded, however full the engine dir looks.
        on_disk = "✓" if all(
            block_target(target, b).is_dir() and any(block_target(target, b).iterdir())
            for b in blocks
        ) else " "
        repos = "; ".join(
            f"{b['targetSubdir']}/ ← {b['repo']}" if b.get("targetSubdir") else b["repo"]
            for b in blocks
        )
        print(f"  {on_disk} {eid:12} {size_gb}GB  {repos}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engines", nargs="*", help="engine IDs to download")
    parser.add_argument("--all-local", action="store_true", help="download all snapshot-based local engines")
    parser.add_argument("--list", action="store_true", help="list local engines and exit")
    parser.add_argument("--model", default=None, help="model of a multi-model engine (csm: csm-1b | misotts-8b)")
    args = parser.parse_args(argv)

    manifest = load_manifest()

    if args.list:
        list_engines(manifest)
        return 0

    if args.all_local:
        targets = [
            eid for eid, e in manifest.get("engines", {}).items()
            if e.get("type") == "local"
            and e.get("download", {}).get("method") in ("huggingface_snapshot", "files")
        ]
    else:
        targets = list(args.engines)

    if not targets:
        parser.error("no engines specified (pass engine IDs, --all-local, or --list)")

    rc = 0
    for eid in targets:
        try:
            download_engine(eid, manifest, args.model)
        except (SystemExit, Exception) as e:
            # One gated/failed engine must never abort the batch (SystemExit is
            # NOT an Exception subclass — both are needed here).
            hint = " — repo is gated; run `hf auth login` first" if "gated" in str(e).lower() else ""
            print(f"[{eid}] skipped: {e}{hint}", file=sys.stderr, flush=True)
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
