#!/usr/bin/env bash
# The one ONNX graph the default (best) path needs: Nano's GPT-2 LM, INT8 weight-only, ORT fused ops.
# Source: https://huggingface.co/KitsuMate/chatterbox-nano-v2-onnx (MIT; built from
# ResembleAI/chatterbox-nano rev 71ccd1d0). curl, not the hf CLI (it hangs on this machine).
set -eu
cd "$(dirname "$0")"
# Pinned to the revision engines.json downloads (audit 2026-10-28 L-02): the checksums file came
# from the same moving branch as the files it checks, so `main` proved nothing.
REV=851210533a5bcb4ad78e3ada6d527482dd1a31e7
mkdir -p _onnx/v2/onnx
for f in LICENSE SHA256SUMS onnx/language_model_int8_mixed.onnx onnx/language_model_int8_mixed.onnx.data; do
  [ -s "_onnx/v2/$f" ] || curl -sSfL --retry 3 -o "_onnx/v2/$f" "https://huggingface.co/KitsuMate/chatterbox-nano-v2-onnx/resolve/$REV/$f"
done
cd _onnx/v2 && grep -E "language_model_int8_mixed|LICENSE" SHA256SUMS | sha256sum -c -
