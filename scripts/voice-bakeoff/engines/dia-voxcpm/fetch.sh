#!/usr/bin/env bash
# Fetch model weights with curl into the Hugging Face cache layout
# (<HF_HOME>/hub/models--org--name/snapshots/<sha>/<file> + refs/main), so the
# libraries load them offline. The `hf` CLI / hub client is known to hang here.
set -euo pipefail
HF_HOME="${HF_HOME:-$(cd "$(dirname "$0")/../../../../voice-engines/_models/_hf_cache" && pwd)}"
HUB="$HF_HOME/hub"

fetch_repo() {
  local repo="$1"; shift
  local sha
  sha=$(curl -sf --max-time 60 "https://huggingface.co/api/models/$repo" | python3 -c 'import json,sys;print(json.load(sys.stdin)["sha"])')
  local dir="$HUB/models--${repo//\//--}"
  mkdir -p "$dir/snapshots/$sha" "$dir/refs"
  printf '%s' "$sha" > "$dir/refs/main"
  for f in "$@"; do
    local dst="$dir/snapshots/$sha/$f"
    if [[ -s "$dst" ]]; then echo "have $repo/$f"; continue; fi
    echo "get  $repo/$f"
    curl -fL --retry 5 --retry-delay 3 -C - --max-time 3600 -o "$dst.part" \
      "https://huggingface.co/$repo/resolve/$sha/$f"
    mv "$dst.part" "$dst"
  done
}

case "${1:-all}" in
  dia2|all)
    fetch_repo nari-labs/Dia2-2B config.json dia2_assets.json model.safetensors tokenizer.json \
      tokenizer_config.json special_tokens_map.json added_tokens.json vocab.json merges.txt
    fetch_repo kyutai/mimi config.json preprocessor_config.json model.safetensors
    fetch_repo openai/whisper-large-v3 config.json generation_config.json preprocessor_config.json \
      tokenizer.json tokenizer_config.json vocab.json merges.txt added_tokens.json \
      special_tokens_map.json normalizer.json model.safetensors
    ;;&
  voxcpm|all)
    fetch_repo openbmb/VoxCPM2 config.json audiovae.pth model.safetensors special_tokens_map.json \
      tokenization_voxcpm2.py tokenizer.json tokenizer_config.json
    ;;
esac
