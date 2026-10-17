#!/usr/bin/env python3
"""Isolated QLoRA trainer over one closed snapshot and held corpus/facts channels."""

import argparse
import math
import os
import random
import re
from datetime import datetime, timezone
from pathlib import Path
from trainer_channel_authority import (
    MAX_CORPUS_BYTES,
    MAX_FACTS_BYTES,
    MAX_SAMPLES,
    MAX_TOKEN_BUDGET,
    checked_add,
    checked_multiply,
    load_corpus,
    parse_json,
    refinement_digest,
    write_facts,
)
from trainer_snapshot_authority import (
    ATTENTION_SUFFIXES,
    SAFE_SUFFIXES,
    SnapshotRefusal,
    has_target_suffix,
    verify_snapshot_authority,
)

SNAPSHOT_ROOT = Path("/snapshot")
MAX_TARGETS = 1024
MAX_TARGET_BYTES = 512
MAX_STEPS = 24 * MAX_SAMPLES
MAX_SEED = 0xFFFF_FFFF
SHA256 = re.compile(r"^[0-9a-f]{64}$")
GPU_UUID = re.compile(r"^GPU-[A-F0-9-]{8,80}$")
CUBLAS_WORKSPACE_CONFIG = ":4096:8"
GPU_LEASE_KEYS = sorted((
    "schemaVersion", "gpuUuid", "cudaVisibleDevices", "nvidiaVisibleDevices",
    "deviceDescriptorsSha256", "gpuLeaseSha256", "trainingPlanSha256",
    "jobSha256", "issuedAt", "expiresAt", "generation", "gpuBindingSha256",
))


def refuse(message):
    raise SystemExit(f"train-adapter: {message}")


def parse_args():
    parser = argparse.ArgumentParser(description="Train one refinement adapter")
    parser.add_argument("--corpus-fd", required=True, type=int)
    parser.add_argument("--corpus-sha256", required=True)
    parser.add_argument("--corpus-bytes", required=True, type=int)
    parser.add_argument("--corpus-sample-count", required=True, type=int)
    parser.add_argument("--out", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--facts-fd", required=True, type=int)
    parser.add_argument("--facts-maximum-bytes", required=True, type=int)
    parser.add_argument("--snapshot-manifest-fd", required=True, type=int)
    parser.add_argument("--snapshot-manifest-sha256", required=True)
    parser.add_argument("--gpu-lease-json")
    parser.add_argument("--expected-token-budget", type=int)
    parser.add_argument("--template", required=True, choices=["gemma-channel", "chat"])
    parser.add_argument("--epochs", required=True, type=int)
    parser.add_argument("--lr", required=True, type=float)
    parser.add_argument("--rank", required=True, type=int)
    parser.add_argument("--alpha", required=True, type=float)
    parser.add_argument("--dropout", required=True, type=float)
    parser.add_argument("--max-length", required=True, type=int)
    parser.add_argument("--minimum-completion-tokens", required=True, type=int)
    parser.add_argument("--seed", required=True, type=int)
    parser.add_argument(
        "--target-policy", required=True,
        choices=["text-attention-projections-v1", "exact-module-list-v1"],
    )
    parser.add_argument("--target-modules-json")
    parser.add_argument("--load-4bit", action="store_true")
    parser.add_argument("--inspect-only", action="store_true")
    return parser.parse_args()




def requested_targets(raw):
    if raw is None:
        return None
    targets = parse_json(raw.encode("utf-8"), "target modules")
    if not isinstance(targets, list) or not 1 <= len(targets) <= MAX_TARGETS \
            or targets != sorted(targets) or len(set(targets)) != len(targets) \
            or any(not isinstance(name, str) or not name or name != name.strip()
                   or len(name.encode("utf-8")) > MAX_TARGET_BYTES
                   or any(ord(char) < 32 or ord(char) == 127 for char in name)
                   for name in targets):
        refuse("target modules must be one bounded canonical string array")
    return targets


def canonical_instant(value):
    if not isinstance(value, str) or re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value) is None:
        return None
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(
            tzinfo=timezone.utc,
        )
    except ValueError:
        return None
    canonical = parsed.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    return parsed if canonical == value else None


def gpu_lease(raw, inspection):
    if inspection:
        if raw is not None or os.environ.get("CUDA_VISIBLE_DEVICES", "") \
                or os.environ.get("NVIDIA_VISIBLE_DEVICES", ""):
            refuse("inspection must not receive GPU lease authority")
        return None
    if raw is None:
        refuse("training requires GPU lease authority")
    value = parse_json(raw.encode("utf-8"), "GPU lease authority")
    issued = canonical_instant(value.get("issuedAt")) if isinstance(value, dict) else None
    expires = canonical_instant(value.get("expiresAt")) if isinstance(value, dict) else None
    digests = (
        "deviceDescriptorsSha256", "gpuBindingSha256", "gpuLeaseSha256",
        "jobSha256", "trainingPlanSha256",
    )
    if not isinstance(value, dict) or sorted(value) != GPU_LEASE_KEYS \
            or value["schemaVersion"] != 1 or type(value["generation"]) is not int \
            or not 1 <= value["generation"] <= 9_007_199_254_740_991 \
            or not isinstance(value["gpuUuid"], str) \
            or GPU_UUID.fullmatch(value["gpuUuid"]) is None \
            or value["cudaVisibleDevices"] != value["gpuUuid"] \
            or value["nvidiaVisibleDevices"] != value["gpuUuid"] \
            or os.environ.get("CUDA_VISIBLE_DEVICES") != value["gpuUuid"] \
            or os.environ.get("NVIDIA_VISIBLE_DEVICES") != value["gpuUuid"] \
            or any(not isinstance(value[field], str) or SHA256.fullmatch(value[field]) is None
                   for field in digests) or issued is None or expires is None \
            or expires <= issued or expires <= datetime.now(timezone.utc):
        refuse("GPU lease authority shape is invalid")
    portable = {field: value[field] for field in GPU_LEASE_KEYS if field != "gpuLeaseSha256"}
    if refinement_digest({
            "kind": "refinement-gpu-lease-v1", "lease": portable,
    }) != value["gpuLeaseSha256"]:
        refuse("GPU lease authority digest is invalid")
    return value


def validate_contract(args):
    integers = (
        (args.epochs, 1, 24, "epochs"), (args.rank, 1, 64, "rank"),
        (args.max_length, 2, 8192, "max length"),
        (args.minimum_completion_tokens, 1, 8192, "completion minimum"),
        (args.seed, 0, MAX_SEED, "seed"),
        (args.corpus_bytes, 1, MAX_CORPUS_BYTES, "corpus bytes"),
        (args.corpus_sample_count, 1, MAX_SAMPLES, "corpus sample count"),
        (args.facts_maximum_bytes, 1, MAX_FACTS_BYTES, "facts bytes"),
    )
    if any(type(value) is not int or value < minimum or value > maximum
           for value, minimum, maximum, _label in integers):
        refuse("integer training authority is outside its hard bounds")
    if args.minimum_completion_tokens >= args.max_length \
            or not math.isfinite(args.lr) or not 0 < args.lr <= 1 \
            or not math.isfinite(args.alpha) or not 0 < args.alpha <= 512 \
            or not math.isfinite(args.dropout) or not 0 <= args.dropout < 1:
        refuse("floating training authority is outside its hard bounds")
    if args.base != str(SNAPSHOT_ROOT):
        refuse("base must be the closed /snapshot mount")
    expected_output = "/work/unused-adapter" if args.inspect_only else "/work/adapter-hf"
    if args.out != expected_output:
        refuse("output must be the reserved work authority")
    if SHA256.fullmatch(args.corpus_sha256) is None \
            or SHA256.fullmatch(args.snapshot_manifest_sha256) is None:
        refuse("input authority digest is invalid")
    if args.inspect_only and args.expected_token_budget is not None:
        refuse("inspection must not receive a completed token budget")
    if not args.inspect_only and (
            type(args.expected_token_budget) is not int
            or not 1 <= args.expected_token_budget <= MAX_TOKEN_BUDGET):
        refuse("training requires one bounded inspected token budget")
    return checked_multiply(
        args.epochs, args.corpus_sample_count, MAX_STEPS, "training steps",
    )




def text_tower_targets(model, exact=None):
    eligible = {
        name for name, module in model.named_modules()
        if type(module).__name__ in ("Linear", "Linear4bit")
        and has_target_suffix(name, SAFE_SUFFIXES)
        and "vision" not in name and "audio" not in name
    }
    attention = {name for name in eligible if has_target_suffix(name, ATTENTION_SUFFIXES)}
    targets = sorted(attention if exact is None else exact)
    if not targets or len(targets) > MAX_TARGETS \
            or any(name not in eligible or len(name.encode("utf-8")) > MAX_TARGET_BYTES
                   for name in targets):
        refuse("unsafe or absent exact target module")
    return targets


def encode(tokenizer, sample, template, max_length, minimum_completion_tokens):
    messages = sample["messages"]
    prompt = tokenizer.apply_chat_template(
        messages[:-1], tokenize=False, add_generation_prompt=True,
    )
    full_text = tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=False,
    )
    subject_output = messages[-1]["content"]
    subject_begin = len(prompt) if isinstance(prompt, str) else -1
    subject_end = subject_begin + len(subject_output)
    if template not in ("gemma-channel", "chat") or not isinstance(full_text, str) \
            or subject_begin < 1 or subject_end > len(full_text) \
            or not full_text.startswith(prompt) \
            or full_text[subject_begin:subject_end] != subject_output:
        refuse("rendered completion does not preserve explicit subject-output boundaries")
    completion_begin, completion_end = subject_begin, len(full_text)
    encoded = tokenizer(full_text, add_special_tokens=False, return_offsets_mapping=True)
    full_ids, offsets = encoded.input_ids, encoded.offset_mapping
    if not full_ids or len(full_ids) != len(offsets) \
            or any(type(token_id) is not int or token_id < 0 for token_id in full_ids):
        refuse("tokenizer did not return exact full-text token identities")
    prefix_ids, completion_ids, phase, previous_end = [], [], "prefix", 0
    for token_id, offset in zip(full_ids, offsets):
        if not isinstance(offset, (list, tuple)) or len(offset) != 2 \
                or any(type(value) is not int for value in offset):
            refuse("tokenizer returned invalid full-text offsets")
        start, end = offset
        if start < previous_end or end <= start or end > completion_end:
            refuse("tokenizer returned non-monotonic full-text offsets")
        previous_end = end
        if end <= completion_begin and phase == "prefix":
            prefix_ids.append(token_id)
        elif start >= completion_begin:
            phase = "completion"
            completion_ids.append(token_id)
        else:
            refuse("token spans the explicit prefix/completion boundary")
    if len(completion_ids) < minimum_completion_tokens:
        refuse("sample has fewer completion tokens than the declared minimum")
    kept_completion = completion_ids[:max_length - 1]
    kept_prefix = prefix_ids[-(max_length - len(kept_completion)):]
    if not kept_prefix or len(kept_completion) < minimum_completion_tokens:
        refuse("completion-only supervision retained too few bounded tokens")
    input_ids = kept_prefix + kept_completion
    labels = [-100] * len(kept_prefix) + kept_completion
    if sum(label != -100 for label in labels[1:]) != len(kept_completion):
        refuse("causal shift changed the supervised completion boundary")
    return input_ids, labels, {
        "prefixTokens": len(kept_prefix), "completionTokens": len(kept_completion),
    }


def completion_profile(encoded, minimum_completion_tokens):
    counts = [facts["completionTokens"] for _ids, _labels, facts in encoded]
    prefixes = [facts["prefixTokens"] for _ids, _labels, facts in encoded]
    aggregate = 0
    for count in counts:
        aggregate = checked_add(aggregate, count, MAX_TOKEN_BUDGET, "completion tokens")
    profile = {
        "minimumRequired": minimum_completion_tokens, "perSample": counts,
        "prefixPerSample": prefixes, "minimumObserved": min(counts),
        "aggregate": aggregate,
    }
    return profile, refinement_digest(profile)


def configure_determinism(seed):
    if os.environ.get("PYTHONHASHSEED") != str(seed) \
            or os.environ.get("CUBLAS_WORKSPACE_CONFIG") != CUBLAS_WORKSPACE_CONFIG:
        refuse("determinism environment differs from the approved execution")
    import numpy
    import torch
    from transformers import set_seed
    try:
        random.seed(seed)
        numpy.random.seed(seed)
        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        set_seed(seed, deterministic=True)
        torch.use_deterministic_algorithms(True, warn_only=False)
        torch.set_deterministic_debug_mode("error")
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
    except (AttributeError, RuntimeError, TypeError, ValueError):
        refuse("strict deterministic training is unavailable")
    if not torch.are_deterministic_algorithms_enabled() \
            or torch.is_deterministic_algorithms_warn_only_enabled() \
            or torch.backends.cudnn.benchmark or not torch.backends.cudnn.deterministic:
        refuse("strict deterministic training was not applied")
    facts = {
        "cublasWorkspaceConfig": CUBLAS_WORKSPACE_CONFIG,
        "deterministicAlgorithms": True, "cudnnBenchmark": False,
        "cudnnDeterministic": True, "pythonHashSeed": str(seed), "seed": seed,
        "torchSeed": seed, "transformersSeed": seed, "numpySeed": seed,
    }
    return torch, facts


def main():
    args = parse_args()
    steps = validate_contract(args)
    exact_targets = requested_targets(args.target_modules_json)
    if exact_targets is not None and args.target_policy == "text-attention-projections-v1" \
            and any(not has_target_suffix(name, ATTENTION_SUFFIXES) for name in exact_targets):
        refuse("text-attention policy accepts only explicit q/k/v/o modules")
    if exact_targets is None and args.target_policy == "exact-module-list-v1":
        refuse("exact-module-list-v1 requires target modules")
    lease = gpu_lease(args.gpu_lease_json, args.inspect_only)
    if not args.inspect_only and (
            os.environ.get("PYTHONHASHSEED") != str(args.seed)
            or os.environ.get("CUBLAS_WORKSPACE_CONFIG") != CUBLAS_WORKSPACE_CONFIG):
        refuse("determinism environment differs from the approved execution")
    try:
        snapshot = verify_snapshot_authority(
            args.snapshot_manifest_fd, args.snapshot_manifest_sha256,
            SNAPSHOT_ROOT, exact_targets,
        )
    except SnapshotRefusal as error:
        refuse(str(error))
    samples = load_corpus(args)
    print(f"corpus samples: {len(samples)}", flush=True)
    torch, determinism = (None, None) if args.inspect_only \
        else configure_determinism(args.seed)
    from transformers import AutoTokenizer
    print("loading tokenizer", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(
        str(SNAPSHOT_ROOT), local_files_only=True, trust_remote_code=False, use_fast=True,
    )
    if not tokenizer.is_fast:
        refuse("tokenizer does not expose exact completion offsets")
    snapshot.verify_stable()
    print(f"encoding {len(samples)} samples", flush=True)
    encoded = [
        encode(tokenizer, sample, args.template, args.max_length,
               args.minimum_completion_tokens)
        for sample in samples
    ]
    profile, profile_sha256 = completion_profile(
        encoded, args.minimum_completion_tokens,
    )
    snapshot.verify_stable()
    token_budget = 0
    for ids, _labels, _facts in encoded:
        token_budget = checked_add(token_budget, len(ids), MAX_TOKEN_BUDGET, "token budget")
    if args.expected_token_budget is not None and token_budget != args.expected_token_budget:
        refuse("encoded token budget differs from approved inspection")
    common_facts = {
        "tokenBudget": token_budget, "completionTokenProfile": profile,
        "completionTokenProfileSha256": profile_sha256,
        "snapshotManifestSha256": snapshot.manifest_sha256,
        **({"gpuLease": lease, "determinism": determinism} if lease is not None else {}),
    }
    if args.inspect_only:
        write_facts(args, {**common_facts, **snapshot.model_facts})
        return
    from transformers import AutoModelForCausalLM, BitsAndBytesConfig
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    data = [
        (torch.tensor([ids]), torch.tensor([labels]))
        for ids, labels, _facts in encoded
    ]
    load_kwargs = {
        "device_map": "cuda", "low_cpu_mem_usage": True, "local_files_only": True,
        "trust_remote_code": False, "use_safetensors": True,
    }
    if args.load_4bit:
        load_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_quant_type="nf4",
        )
    else:
        load_kwargs["dtype"] = torch.bfloat16
    print("loading base weights: /snapshot", flush=True)
    model = AutoModelForCausalLM.from_pretrained(str(SNAPSHOT_ROOT), **load_kwargs)
    snapshot.verify_stable()
    quantized = bool(getattr(model, "is_quantized", False)) and any(
        type(module).__name__ in ("Linear4bit", "Linear8bitLt")
        for module in model.modules()
    )
    if bool(args.load_4bit) != quantized:
        refuse("applied quantization does not match requested configuration")
    if quantized:
        model = prepare_model_for_kbit_training(model)
    model.gradient_checkpointing_enable()
    model.enable_input_require_grads()
    targets = text_tower_targets(model, exact_targets)
    if targets != snapshot.model_facts["targetModules"]:
        refuse("loaded model targets differ from inspected snapshot targets")
    model = get_peft_model(model, LoraConfig(
        r=args.rank, lora_alpha=args.alpha, lora_dropout=args.dropout,
        task_type="CAUSAL_LM", target_modules=targets,
    ))
    model.train()
    optimizer = torch.optim.AdamW(
        (parameter for parameter in model.parameters() if parameter.requires_grad),
        lr=args.lr, betas=(0.9, 0.999), eps=1e-8, weight_decay=0.01, amsgrad=False,
    )
    print(f"training: {steps} steps", flush=True)
    for step in range(steps):
        ids, labels = data[step % len(data)]
        loss = model(input_ids=ids.to("cuda"), labels=labels.to("cuda")).loss
        loss.backward()
        optimizer.step()
        optimizer.zero_grad()
        print(f"step {step + 1}/{steps} loss {loss.item():.3f}", flush=True)
    out = Path(args.out)
    out.mkdir(mode=0o700, parents=False, exist_ok=False)
    model.save_pretrained(out, safe_serialization=True)
    snapshot.verify_stable()
    if gpu_lease(args.gpu_lease_json, False) != lease:
        refuse("GPU lease authority changed during training")
    write_facts(args, {
        **common_facts, "targetModules": targets,
        "load4bitApplied": quantized,
    })
    print(f"SAVED {out}", flush=True)


if __name__ == "__main__":
    main()
