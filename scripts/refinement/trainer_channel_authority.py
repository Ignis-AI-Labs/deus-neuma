"""Held corpus input and canonical facts output for the isolated trainer."""

import fcntl
import hashlib
import json
import os
import stat

MAX_CORPUS_BYTES = 64 * 1024**2
MAX_SAMPLE_BYTES = 1024**2
MAX_FACTS_BYTES = 16 * 1024**2
MAX_SAMPLES = 10_000
MAX_TOKEN_BUDGET = 100_000_000
ROLES = ("system", "user", "assistant")
SYSTEM_INSTRUCTION = "Write only the requested response in your own voice."
USER_INSTRUCTION = "Respond in your own voice."


def refuse(message):
    raise SystemExit(f"train-adapter: {message}")


def checked_add(total, amount, maximum, label):
    if type(total) is not int or type(amount) is not int or amount < 0 \
            or total < 0 or total > maximum or amount > maximum - total:
        refuse(f"{label} exceeds its hard ceiling")
    return total + amount


def checked_multiply(left, right, maximum, label):
    if type(left) is not int or type(right) is not int or left < 0 or right < 0 \
            or (right and left > maximum // right):
        refuse(f"{label} exceeds its hard ceiling")
    return left * right


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
            raw.decode("utf-8"), object_pairs_hook=strict_object,
            parse_constant=nonfinite,
        )
    except (UnicodeDecodeError, ValueError) as error:
        refuse(f"{label} is not strict UTF-8 JSON")
        raise AssertionError from error


def refinement_digest(value):
    authority = {
        "domain": "neuma.refinement.value", "schemaVersion": 2, "value": value,
    }
    canonical = json.dumps(
        authority, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def same_stat(left, right):
    fields = (
        "st_dev", "st_ino", "st_size", "st_mode", "st_uid", "st_gid",
        "st_nlink", "st_mtime_ns", "st_ctime_ns",
    )
    return all(getattr(left, field) == getattr(right, field) for field in fields)


def same_inode(left, right):
    fields = (
        "st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink", "st_rdev",
    )
    return all(getattr(left, field) == getattr(right, field) for field in fields)


def descriptor_state(fd, access, label):
    if type(fd) is not int or not 3 <= fd <= 1_048_575:
        refuse(f"{label} descriptor is invalid")
    try:
        flags, observed = fcntl.fcntl(fd, fcntl.F_GETFL), os.fstat(fd)
    except OSError:
        refuse(f"{label} descriptor is unavailable")
    if flags & os.O_ACCMODE != access or not stat.S_ISREG(observed.st_mode):
        refuse(f"{label} descriptor authority is invalid")
    return observed


def validate_sample(raw):
    sample = parse_json(raw, "corpus sample")
    if not isinstance(sample, dict) or list(sample) != ["messages"] \
            or not isinstance(sample["messages"], list) \
            or len(sample["messages"]) != len(ROLES):
        refuse("corpus sample shape is invalid")
    for index, message in enumerate(sample["messages"]):
        if not isinstance(message, dict) or list(message) != ["role", "content"] \
                or message["role"] != ROLES[index] \
                or not isinstance(message["content"], str) or not message["content"]:
            refuse("corpus sample message is invalid")
    if sample["messages"][0]["content"] != SYSTEM_INSTRUCTION \
            or sample["messages"][1]["content"] != USER_INSTRUCTION:
        refuse("corpus sample contains non-subject prompt material")
    return sample


def load_corpus(args):
    before = descriptor_state(args.corpus_fd, os.O_RDONLY, "corpus")
    if stat.S_IMODE(before.st_mode) != 0o400 or before.st_uid != os.geteuid() \
            or before.st_gid != os.getegid() or before.st_nlink != 0 \
            or before.st_size != args.corpus_bytes:
        refuse("corpus descriptor metadata differs from its authority")
    samples, pending, digest, offset = [], bytearray(), hashlib.sha256(), 0
    while offset < args.corpus_bytes:
        try:
            chunk = os.pread(args.corpus_fd, min(1024**2, args.corpus_bytes - offset), offset)
        except OSError:
            refuse("corpus descriptor cannot be read")
        if not chunk:
            refuse("corpus descriptor ended before its declared bytes")
        digest.update(chunk)
        pending.extend(chunk)
        offset = checked_add(offset, len(chunk), args.corpus_bytes, "corpus")
        while b"\n" in pending:
            raw, _, remainder = pending.partition(b"\n")
            pending = bytearray(remainder)
            if not raw or len(raw) > MAX_SAMPLE_BYTES or len(samples) >= MAX_SAMPLES:
                refuse("corpus sample exceeds its exact line boundary")
            samples.append(validate_sample(raw))
        if len(pending) > MAX_SAMPLE_BYTES:
            refuse("corpus sample exceeds its exact line boundary")
    if pending or len(samples) != args.corpus_sample_count \
            or digest.hexdigest() != args.corpus_sha256 \
            or not same_stat(before, os.fstat(args.corpus_fd)):
        refuse("corpus bytes differ from the held authority")
    return samples


def write_facts(args, facts):
    before = descriptor_state(args.facts_fd, os.O_RDWR, "facts")
    if stat.S_IMODE(before.st_mode) != 0o600 or before.st_uid != os.geteuid() \
            or before.st_gid != os.getegid() or before.st_nlink != 1 or before.st_size != 0:
        refuse("facts descriptor metadata differs from its authority")
    try:
        raw = json.dumps(
            facts, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError):
        refuse("facts are not canonical JSON")
    if not raw or len(raw) > args.facts_maximum_bytes:
        refuse("facts exceed their hard byte ceiling")
    offset = 0
    while offset < len(raw):
        try:
            written = os.pwrite(args.facts_fd, raw[offset:], offset)
        except OSError:
            refuse("facts descriptor cannot be written")
        if written < 1:
            refuse("facts descriptor write stopped")
        offset += written
    try:
        os.fsync(args.facts_fd)
        after = os.fstat(args.facts_fd)
        repeated = os.pread(args.facts_fd, len(raw) + 1, 0)
    except OSError:
        refuse("facts descriptor cannot be verified")
    if not same_inode(before, after) or after.st_size != len(raw) or repeated != raw:
        refuse("facts descriptor changed while written")
