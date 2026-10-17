#!/usr/bin/python3
"""Materialize two exact held packed authorities into two held private roots."""

from __future__ import annotations

import argparse
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import unicodedata

MAGIC = b"NEUMA-PACK-V2\0" + bytes(2)
HEADER_BYTES = 24
FORMAT = "neuma-packed-authority-v2"
ARCHIVE_KINDS = {"runtime": "neuma-runtime-manifest", "tool": "neuma-source-manifest"}
MAX_ARCHIVES = 2
MAX_ARCHIVE_BYTES = 34 * 1024**3
MAX_EXTRACTED_BYTES = 32 * 1024**3
MAX_RUNTIME_FILES = 100_000
MAX_TOOL_FILES = 1_024
MAX_FILE_BYTES = 8 * 1024**3
MAX_MANIFEST_BYTES = 4 * 1024**2
MAX_PATH_BYTES = 512
MAX_PATH_DEPTH = 64
COPY_BYTES = 1024 * 1024
SHA256 = re.compile(r"^[0-9a-f]{64}$")
MAX_COMMAND_BYTES = 256 * 1024
MAX_COMMAND_ARGUMENTS = 512
MAX_ARGUMENT_BYTES = 64 * 1024
MAX_CHILD_FDS = 16
MAX_OPEN_FDS = 256


class Refusal(Exception):
    """A closed validation failure whose text never contains private payloads."""


class Reader:
    """Bounded positional descriptor reader that hashes every consumed byte."""

    def __init__(self, fd: int, size: int):
        if fd < 3 or size < HEADER_BYTES or size > MAX_ARCHIVE_BYTES:
            raise Refusal("archive declaration")
        try:
            file_stat = os.fstat(fd)
        except OSError as error:
            raise Refusal("archive descriptor") from error
        if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_size != size:
            raise Refusal("archive file")
        self.fd = fd
        self.size = size
        self.offset = 0
        self.digest = hashlib.sha256()

    def read_exact(self, count: int) -> bytes:
        if count < 0 or self.offset + count > self.size:
            raise Refusal("archive boundary")
        chunks: list[bytes] = []
        remaining = count
        while remaining:
            try:
                chunk = os.pread(self.fd, min(COPY_BYTES, remaining), self.offset)
            except OSError as error:
                raise Refusal("archive read") from error
            if not chunk:
                raise Refusal("archive truncation")
            chunks.append(chunk)
            self.digest.update(chunk)
            self.offset += len(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)


class Archive:
    """One exact packed runtime or tool declaration."""

    def __init__(self, fields: list[str]):
        if len(fields) != 7 or fields[0] not in ARCHIVE_KINDS:
            raise Refusal("archive shape")
        try:
            fd = int(fields[1])
            size = int(fields[3])
            file_count = int(fields[4])
        except ValueError as error:
            raise Refusal("archive integer") from error
        maximum_files = MAX_RUNTIME_FILES if fields[0] == "runtime" else MAX_TOOL_FILES
        if not SHA256.fullmatch(fields[2]) or not SHA256.fullmatch(fields[5]) \
                or fields[6] != ARCHIVE_KINDS[fields[0]] \
                or file_count < 1 or file_count > maximum_files:
            raise Refusal("archive declaration")
        self.destination = fields[0]
        self.fd = fd
        self.sha256 = fields[2]
        self.bytes = size
        self.file_count = file_count
        self.manifest_sha256 = fields[5]
        self.manifest_kind = fields[6]


def checked_add(total: int, amount: int, maximum: int) -> int:
    if amount < 0 or total > maximum - amount:
        raise Refusal("aggregate limit")
    return total + amount


def safe_parts(value: object) -> tuple[str, ...]:
    if not isinstance(value, str) or not value or value != unicodedata.normalize("NFC", value):
        raise Refusal("member path")
    if value.startswith("/") or "\\" in value or len(value.encode("utf-8")) > MAX_PATH_BYTES:
        raise Refusal("member path")
    parts = tuple(value.split("/"))
    if len(parts) > MAX_PATH_DEPTH or any(not part or part in (".", "..") for part in parts):
        raise Refusal("member path")
    return parts


def manifest_rows(reader: Reader, archive: Archive) -> list[dict[str, object]]:
    if reader.read_exact(len(MAGIC)) != MAGIC:
        raise Refusal("archive format")
    manifest_size = int.from_bytes(reader.read_exact(8), "big")
    if manifest_size < 1 or manifest_size > MAX_MANIFEST_BYTES:
        raise Refusal("manifest size")
    raw = reader.read_exact(manifest_size)
    if hashlib.sha256(raw).hexdigest() != archive.manifest_sha256:
        raise Refusal("manifest digest")
    try:
        manifest = json.loads(raw)
    except (UnicodeDecodeError, ValueError) as error:
        raise Refusal("manifest encoding") from error
    if not isinstance(manifest, dict) or set(manifest) != {"schemaVersion", "kind", "format", "files"} \
            or manifest["schemaVersion"] != 2 or manifest["kind"] != archive.manifest_kind \
            or manifest["format"] != FORMAT or not isinstance(manifest["files"], list) \
            or len(manifest["files"]) != archive.file_count:
        raise Refusal("manifest shape")
    rows: list[dict[str, object]] = []
    paths: list[str] = []
    for row in manifest["files"]:
        if not isinstance(row, dict) or set(row) != {"relativePath", "sha256", "bytes", "mode"} \
                or not SHA256.fullmatch(str(row["sha256"])) \
                or not isinstance(row["bytes"], int) or isinstance(row["bytes"], bool) \
                or row["bytes"] < 0 or row["bytes"] > MAX_FILE_BYTES \
                or row["mode"] not in (0o400, 0o500):
            raise Refusal("manifest member")
        safe_parts(row["relativePath"])
        paths.append(row["relativePath"])
        rows.append(row)
    if paths != sorted(paths, key=lambda value: value.encode("utf-8")) or len(set(paths)) != len(paths):
        raise Refusal("manifest ordering")
    return rows


def private_empty_root(fd: int) -> Path:
    if fd < 3:
        raise Refusal("root descriptor")
    try:
        root_state = os.fstat(fd)
        root = Path(f"/proc/self/fd/{fd}")
        if not stat.S_ISDIR(root_state.st_mode) or root_state.st_uid != os.geteuid() \
                or stat.S_IMODE(root_state.st_mode) != 0o700 or any(root.iterdir()):
            raise Refusal("root state")
    except OSError as error:
        raise Refusal("root descriptor") from error
    return root


def extract_file(reader: Reader, root: Path, row: dict[str, object]) -> None:
    target = root.joinpath(*safe_parts(row["relativePath"]))
    fd = None
    primary = None
    try:
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(target, flags, 0o600)
        remaining = row["bytes"]
        digest = hashlib.sha256()
        while remaining:
            chunk = reader.read_exact(min(COPY_BYTES, remaining))
            digest.update(chunk)
            view = memoryview(chunk)
            while view:
                count = os.write(fd, view)
                if count <= 0:
                    raise Refusal("member write")
                view = view[count:]
            remaining -= len(chunk)
        if digest.hexdigest() != row["sha256"]:
            raise Refusal("member digest")
        os.fchmod(fd, row["mode"])
        os.fsync(fd)
    except (OSError, Refusal) as error:
        primary = error
    if fd is not None:
        try:
            os.close(fd)
        except OSError as error:
            primary = error if primary is None else ExceptionGroup(
                "member write and close", [primary, error],
            )
    if primary is not None:
        raise Refusal("member extraction") from primary


def freeze_tree(root: Path) -> None:
    directories = [entry for entry in root.rglob("*") if entry.is_dir()]
    for directory in sorted(directories, key=lambda value: len(value.parts), reverse=True):
        directory.chmod(0o500)
    root.chmod(0o500)


def consume_archive(archive: Archive, root: Path, extracted_total: int) -> int:
    reader = Reader(archive.fd, archive.bytes)
    rows = manifest_rows(reader, archive)
    declared = 0
    for row in rows:
        declared = checked_add(declared, row["bytes"], MAX_EXTRACTED_BYTES)
    extracted_total = checked_add(extracted_total, declared, MAX_EXTRACTED_BYTES)
    for row in rows:
        extract_file(reader, root, row)
    if reader.offset != archive.bytes or reader.digest.hexdigest() != archive.sha256:
        raise Refusal("archive digest")
    freeze_tree(root)
    return extracted_total


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False, allow_abbrev=False)
    parser.add_argument("--archive", action="append", nargs=7, default=[])
    parser.add_argument("--root", action="append", nargs=2, default=[])
    parser.add_argument("--command")
    parser.add_argument("--child-fd", action="append", type=int, default=[])
    parsed = parser.parse_args()
    materialize = parsed.command is None
    if materialize and (len(parsed.archive) != MAX_ARCHIVES
                        or len(parsed.root) != MAX_ARCHIVES or parsed.child_fd):
        raise Refusal("materializer arguments")
    if not materialize and (parsed.archive or parsed.root):
        raise Refusal("launcher arguments")
    return parsed


def launch_command(raw: str, child_fds: list[int]) -> None:
    if not raw or len(raw.encode("utf-8")) > MAX_COMMAND_BYTES:
        raise Refusal("command size")
    try:
        command = json.loads(raw)
    except (TypeError, ValueError) as error:
        raise Refusal("command encoding") from error
    if not isinstance(command, list) or not command or len(command) > MAX_COMMAND_ARGUMENTS \
            or command[0] != "/runtime/bin/python" \
            or any(not isinstance(argument, str) or "\0" in argument
                   or len(argument.encode("utf-8")) > MAX_ARGUMENT_BYTES
                   for argument in command):
        raise Refusal("command shape")
    if len(child_fds) > MAX_CHILD_FDS or len(set(child_fds)) != len(child_fds) \
            or any(fd < 3 or fd >= MAX_OPEN_FDS for fd in child_fds):
        raise Refusal("child descriptor declaration")
    retained = set(child_fds)
    try:
        opened = [int(name) for name in os.listdir("/proc/self/fd") if name.isdigit()]
    except OSError as error:
        raise Refusal("descriptor inventory") from error
    if len(opened) > MAX_OPEN_FDS:
        raise Refusal("descriptor inventory")
    for fd in opened:
        if fd < 3 or fd in retained:
            continue
        try:
            os.close(fd)
        except OSError as error:
            if error.errno != errno.EBADF:
                raise Refusal("descriptor cleanup") from error
    for fd in retained:
        try:
            os.fstat(fd)
        except OSError as error:
            raise Refusal("child descriptor") from error
    os.execve(command[0], command, dict(os.environ))


def main() -> int:
    parsed = parse_arguments()
    if parsed.command is not None:
        launch_command(parsed.command, parsed.child_fd)
        raise Refusal("launcher returned")
    archives = [Archive(fields) for fields in parsed.archive]
    if {archive.destination for archive in archives} != set(ARCHIVE_KINDS) \
            or len({archive.fd for archive in archives}) != len(archives):
        raise Refusal("archive completeness")
    try:
        root_fields = {name: int(fd) for name, fd in parsed.root}
    except (TypeError, ValueError) as error:
        raise Refusal("root declaration") from error
    if set(root_fields) != set(ARCHIVE_KINDS) or len(set(root_fields.values())) != len(root_fields) \
            or set(root_fields.values()) & {archive.fd for archive in archives}:
        raise Refusal("root declaration")
    roots = {name: private_empty_root(fd) for name, fd in root_fields.items()}
    extracted_total = 0
    for archive in archives:
        extracted_total = consume_archive(archive, roots[archive.destination], extracted_total)
    close_errors = []
    for fd in [archive.fd for archive in archives] + list(root_fields.values()):
        try:
            os.close(fd)
        except OSError as error:
            close_errors.append(error)
    if close_errors:
        raise Refusal("descriptor cleanup") from ExceptionGroup(
            "materializer descriptor cleanup", close_errors,
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Refusal:
        print("packed authority refused", file=os.sys.stderr)
        raise SystemExit(125) from None
