#!/usr/bin/env bash
# The measured matrix behind the spike report (16 clips per config: c01-greet, c02-tease,
# c10-ramble, r01-summary x Hannah, James x 2 takes). sweep.sh pins each process to cores
# 0..T-1 (the P-cores on this Core Ultra 9 285K) and waits for them to be mostly idle first.
set -u
cd "$(dirname "$0")"
BEST="--lm ort --pipeline --flow-steps 1 --flow-prompt 100 --flow-window 50 --first-tokens 20 --flat-chunks 2"
for T in 8 4; do
  BENCH_EXTRA="--save --seam-ref" ./sweep.sh $T "$BEST --tag best-flat2-cos-t$T"
  BENCH_EXTRA="--save" ./sweep.sh $T \
    "${BEST/--flow-steps 1/--flow-steps 2} --tag 2step-flat2-cos-t$T" \
    "${BEST/--lm ort/--lm torch} --tag torchlm-flat2-cos-t$T" \
    "--lm ort --mode clause --tag clause-t$T" \
    "--lm ort --mode whole --tag whole-t$T"
done
# Whisper check (faster-whisper large-v3, CPU int8), off the benchmark cores:
ASR_THREADS=8 taskset -c 8-23 ../whisper/.venv/bin/python whisper_check.py best-flat2-cos-t8 best-flat2-cos-t4 whole-t8
