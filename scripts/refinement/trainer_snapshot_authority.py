"""Strict one-pass snapshot verification for the isolated refinement trainer."""

import fcntl
import hashlib
import json
import os
import re
import stat
import unicodedata
from pathlib import Path, PurePosixPath

SHA256 = re.compile(r"^[0-9a-f]{64}$")
SAFE_SUFFIXES = (
    "q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj",
)
ATTENTION_SUFFIXES = ("q_proj", "k_proj", "v_proj", "o_proj")
MAX_MANIFEST_BYTES = 256 * 1024
MAX_SNAPSHOT_FILES = 236
MAX_SNAPSHOT_BYTES = 80 * 1024**3
MAX_TENSOR_KEYS = 1_000_000
MAX_TARGET_MODULES = 1024
MAX_TARGET_BYTES = 512
READ_ONLY = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)

def has_target_suffix(name, suffixes):
    return any(name == suffix or name.endswith(f".{suffix}") for suffix in suffixes)


class SnapshotRefusal(Exception):
    """Closed refusal with no private path or bytes in its text."""


def fail(message):
    raise SnapshotRefusal(message)


def strict_object(pairs):
    value = {}
    for key, child in pairs:
        if key in value:
            raise ValueError("duplicate key")
        value[key] = child
    return value


def parse_json(raw, label):
    def nonfinite(_value):
        raise ValueError("non-finite")
    try:
        return json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=strict_object,
            parse_constant=nonfinite,
        )
    except (UnicodeDecodeError, ValueError) as error:
        raise SnapshotRefusal(f"{label} is not strict UTF-8 JSON") from error


def same_stat(left, right):
    fields = (
        "st_dev", "st_ino", "st_size", "st_mode", "st_uid", "st_gid",
        "st_nlink", "st_mtime_ns", "st_ctime_ns",
    )
    return all(getattr(left, key) == getattr(right, key) for key in fields)


def read_only_descriptor(fd, label):
    if not isinstance(fd, int) or isinstance(fd, bool) or not 3 <= fd <= 1_048_575:
        fail(f"{label} descriptor is invalid")
    try:
        descriptor_flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        observed = os.fstat(fd)
    except OSError as error:
        raise SnapshotRefusal(f"{label} descriptor is unavailable") from error
    if descriptor_flags & os.O_ACCMODE != os.O_RDONLY:
        fail(f"{label} descriptor is not read-only")
    return observed


def inherited_manifest(fd):
    before = read_only_descriptor(fd, "snapshot manifest")
    if not stat.S_ISREG(before.st_mode) or stat.S_IMODE(before.st_mode) != 0o400 \
            or before.st_uid != os.geteuid() or before.st_nlink != 0 \
            or not 1 <= before.st_size <= MAX_MANIFEST_BYTES:
        fail("snapshot manifest is not a bounded held authority")
    chunks, offset = [], 0
    while offset < before.st_size:
        try:
            chunk = os.pread(fd, min(1024**2, before.st_size - offset), offset)
        except OSError as error:
            raise SnapshotRefusal("snapshot manifest cannot be read") from error
        if not chunk:
            fail("snapshot manifest ended before its declared bytes")
        chunks.append(chunk)
        offset += len(chunk)
    if not same_stat(before, os.fstat(fd)):
        fail("snapshot manifest changed while read")
    return b"".join(chunks), before


def safe_parts(relative):
    if not isinstance(relative, str) or not relative \
            or relative != unicodedata.normalize("NFC", relative) or "\\" in relative \
            or any(ord(char) < 32 or ord(char) == 127 for char in relative):
        fail("snapshot manifest contains a noncanonical path")
    pure = PurePosixPath(relative)
    parts = pure.parts
    if pure.is_absolute() or not parts or len(parts) > 32 \
            or any(part in ("", ".", "..") for part in parts) \
            or "/".join(parts) != relative or len(relative.encode("utf-8")) > 512:
        fail("snapshot manifest contains an unsafe path")
    return parts


def manifest_value(raw, expected):
    digest = hashlib.sha256(raw).hexdigest()
    if not isinstance(expected, str) or not SHA256.fullmatch(expected) or digest != expected:
        fail("snapshot manifest digest mismatch")
    value = parse_json(raw, "snapshot manifest")
    if not isinstance(value, dict) \
            or list(value) != ["schemaVersion", "kind", "format", "files"] \
            or value["schemaVersion"] != 1 \
            or value["kind"] != "neuma-snapshot-manifest" \
            or value["format"] != "neuma-file-set-v1" \
            or not isinstance(value["files"], list) \
            or not 1 <= len(value["files"]) <= MAX_SNAPSHOT_FILES:
        fail("snapshot manifest shape is invalid")
    canonical = json.dumps(
        value, ensure_ascii=False, separators=(",", ":"),
    ).encode("utf-8")
    if canonical != raw:
        fail("snapshot manifest bytes are not canonical")
    previous, seen, total = None, set(), 0
    for row in value["files"]:
        if not isinstance(row, dict) \
                or list(row) != ["relativePath", "sha256", "bytes", "mode"]:
            fail("snapshot manifest file row is invalid")
        parts = safe_parts(row["relativePath"])
        order = row["relativePath"].encode("utf-8")
        if (previous is not None and order <= previous) or parts in seen:
            fail("snapshot manifest paths are not strictly ordered and unique")
        previous, _ = order, seen.add(parts)
        size = row["bytes"]
        if not isinstance(row["sha256"], str) or not SHA256.fullmatch(row["sha256"]) \
                or not isinstance(size, int) or isinstance(size, bool) \
                or size < 0 or size > MAX_SNAPSHOT_BYTES or row["mode"] != 0o400 \
                or total > MAX_SNAPSHOT_BYTES - size:
            fail("snapshot manifest file authority is invalid")
        total += size
    return value, digest


def tree_states(root, rows):
    files = {row["relativePath"] for row in rows}
    directories = set()
    for relative in files:
        parts = PurePosixPath(relative).parts
        directories.update("/".join(parts[:index]) for index in range(1, len(parts)))
    try:
        root_stat = os.lstat(root)
    except OSError as error:
        raise SnapshotRefusal("snapshot mount is unavailable") from error
    if not stat.S_ISDIR(root_stat.st_mode):
        fail("snapshot mount root is not a directory")
    states, stack, nodes = {}, [(Path(root), "")], 0
    while stack:
        directory, prefix = stack.pop()
        try:
            entries = list(os.scandir(directory))
        except OSError as error:
            raise SnapshotRefusal("snapshot mount cannot be enumerated") from error
        for entry in entries:
            nodes += 1
            if nodes > MAX_SNAPSHOT_FILES * 32:
                fail("snapshot mount contains too many nodes")
            relative = f"{prefix}/{entry.name}" if prefix else entry.name
            try:
                info = entry.stat(follow_symlinks=False)
            except OSError as error:
                raise SnapshotRefusal("snapshot mount metadata is unavailable") from error
            if stat.S_ISDIR(info.st_mode) and relative in directories:
                stack.append((Path(entry.path), relative))
            elif stat.S_ISREG(info.st_mode) and relative in files:
                states[relative] = info
            else:
                fail("snapshot mount contains an undeclared or non-regular node")
    if set(states) != files:
        fail("snapshot mount file set differs from its manifest")
    return states


def hash_file(root, row, mounted_state):
    target = Path(root).joinpath(*safe_parts(row["relativePath"]))
    try:
        fd = os.open(target, READ_ONLY)
    except OSError as error:
        raise SnapshotRefusal("snapshot file cannot be opened") from error
    digest = hashlib.sha256()
    try:
        before, offset = read_only_descriptor(fd, "snapshot file"), 0
        if not same_stat(before, mounted_state) or not stat.S_ISREG(before.st_mode) \
                or stat.S_IMODE(before.st_mode) != row["mode"] \
                or before.st_uid != os.geteuid() or before.st_nlink != 0 \
                or before.st_size != row["bytes"]:
            fail("snapshot file metadata differs from its manifest")
        while offset < before.st_size:
            try:
                chunk = os.pread(fd, min(1024**2, before.st_size - offset), offset)
            except OSError as error:
                raise SnapshotRefusal("snapshot file cannot be read") from error
            if not chunk:
                fail("snapshot file ended before its declared bytes")
            digest.update(chunk)
            offset += len(chunk)
        if not same_stat(before, os.fstat(fd)):
            fail("snapshot file changed while hashed")
    finally:
        os.close(fd)
    if digest.hexdigest() != row["sha256"]:
        fail("snapshot file digest differs from its manifest")


def read_metadata(root, row, maximum):
    if row is None or not 1 <= row["bytes"] <= maximum:
        fail("snapshot metadata exceeds its hard byte ceiling")
    target = Path(root).joinpath(*safe_parts(row["relativePath"]))
    try:
        raw = target.read_bytes()
    except OSError as error:
        raise SnapshotRefusal("snapshot metadata cannot be read") from error
    if len(raw) != row["bytes"] or hashlib.sha256(raw).hexdigest() != row["sha256"]:
        fail("snapshot metadata changed after verification")
    return raw


def bounded_target_names(names, label):
    if not names or len(names) > MAX_TARGET_MODULES \
            or any(not isinstance(name, str) or not name \
                   or len(name.encode("utf-8")) > MAX_TARGET_BYTES for name in names):
        fail(f"snapshot {label} authority is invalid")
    return names


def model_facts(manifest, root, exact_targets):
    rows = {row["relativePath"]: row for row in manifest["files"]}
    config = parse_json(
        read_metadata(root, rows.get("config.json"), 2 * 1024**2),
        "snapshot config",
    )
    if not isinstance(config, dict):
        fail("snapshot config must be an object")
    model_type = config.get("model_type")
    architectures = config.get("architectures", [])
    if (model_type is not None and (
            not isinstance(model_type, str) or len(model_type.encode("utf-8")) > 512)) \
            or not isinstance(architectures, list) or len(architectures) > 64 \
            or any(not isinstance(item, str) or len(item.encode("utf-8")) > 512
                   for item in architectures):
        fail("snapshot config identity is invalid")
    index = rows.get("model.safetensors.index.json")
    keys = []
    if index:
        parsed = parse_json(
            read_metadata(root, index, 16 * 1024**2),
            "safetensors index",
        )
        weight_map = parsed.get("weight_map") if isinstance(parsed, dict) else None
        if not isinstance(weight_map, dict):
            fail("snapshot safetensors index has no weight map")
        keys = list(weight_map)
    else:
        from safetensors import safe_open
        for row in manifest["files"]:
            if row["relativePath"].endswith(".safetensors"):
                target = Path(root).joinpath(*safe_parts(row["relativePath"]))
                with safe_open(str(target), framework="pt", device="cpu") as tensors:
                    keys.extend(tensors.keys())
    if not keys or len(keys) > MAX_TENSOR_KEYS \
            or any(not isinstance(key, str) or len(key.encode("utf-8")) > 4096 for key in keys):
        fail("snapshot tensor key authority is invalid")
    eligible = sorted({
        key[:-7] for key in keys
        if key.endswith(".weight") and has_target_suffix(key[:-7], SAFE_SUFFIXES)
        and "vision" not in key and "audio" not in key
    })
    attention = [name for name in eligible if has_target_suffix(name, ATTENTION_SUFFIXES)]
    bounded_target_names(eligible, "eligible target module")
    bounded_target_names(attention, "attention target module")
    targets = attention if exact_targets is None else sorted(exact_targets)
    bounded_target_names(targets, "selected target module")
    eligible_set = set(eligible)
    if any(name not in eligible_set for name in targets):
        fail("snapshot target module authority is absent or unsafe")
    experts = [
        config.get("num_experts"),
        config.get("num_local_experts"),
        config.get("num_experts_per_tok"),
    ]
    mixture = any(
        isinstance(item, int) and not isinstance(item, bool) and item > 1
        for item in experts
    ) or "moe" in str(model_type or "").lower() \
        or any("moe" in item.lower() for item in architectures)
    return {
        "targetModules": targets,
        "eligibleTargetModules": eligible,
        "attentionTargetModules": attention,
        "baseConfig": {
            "sha256": rows["config.json"]["sha256"],
            "modelType": model_type,
            "architectures": architectures,
            "mixtureOfExperts": mixture,
        },
    }


class VerifiedSnapshotAuthority:
    """One full-byte verification followed only by bounded stability checks."""

    def __init__(self, fd, manifest_sha256, manifest_stat, root, manifest, states, facts):
        self.fd = fd
        self.manifest_sha256 = manifest_sha256
        self.manifest_stat = manifest_stat
        self.root = root
        self.manifest = manifest
        self.states = states
        self.model_facts = facts

    def verify_stable(self):
        if not same_stat(self.manifest_stat, read_only_descriptor(
                self.fd, "snapshot manifest")):
            fail("snapshot manifest descriptor changed")
        observed = tree_states(self.root, self.manifest["files"])
        if set(observed) != set(self.states) or any(
                not same_stat(self.states[name], observed[name]) for name in self.states):
            fail("snapshot mount identity changed")
        return self.manifest_sha256, self.model_facts


def verify_snapshot_authority(fd, expected_sha256, root, exact_targets):
    """Hash the closed snapshot exactly once and retain its phase authority."""
    raw, manifest_stat = inherited_manifest(fd)
    manifest, digest = manifest_value(raw, expected_sha256)
    states = tree_states(root, manifest["files"])
    for row in manifest["files"]:
        hash_file(root, row, states[row["relativePath"]])
    facts = model_facts(manifest, root, exact_targets)
    authority = VerifiedSnapshotAuthority(
        fd, digest, manifest_stat, root, manifest, states, facts,
    )
    authority.verify_stable()
    return authority
