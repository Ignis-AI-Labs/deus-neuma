#!/usr/bin/env bash
# build-whisper-cuda.sh — the graphics-card build of the dictation engine an installed app downloads
# on Linux (backend/services/managed-stt-plan.js, GPU_ENGINES). whisper.cpp publishes no Linux GPU
# build, so the platform builds and hosts its own, reproducibly:
#
#   whisper.cpp tag b5454 (the processor build's tag), CUDA 13 (the host's toolkit, mounted read-only),
#   compiled in Ubuntu 22.04 so it needs only glibc 2.34, ggml linked in, the C++ runtime linked in, no OpenMP,
#   for NVIDIA cards from Turing (RTX 20) to Blackwell (RTX 50). The CUDA runtime is NOT shipped: the
#   app borrows libcudart/libcublas 13 from the Ollama it sets up (managed-stt-probe.js).
#
# Usage: scripts/speech/build-whisper-cuda.sh <work dir> [cuda toolkit dir]
# Output: <work dir>/whisper-cuda13-linux-x64.tar.gz and its SHA-256, to pin in GPU_ENGINES.
set -euo pipefail
WORK=${1:?work dir}
CUDA=${2:-$(readlink -f /usr/local/cuda)}
TAG=b5454
ARCHS='75-real;80-real;86-real;89-real;90-real;120-real;120-virtual'
mkdir -p "$WORK"
[ -d "$WORK/src" ] || git clone -q --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp "$WORK/src"
cat > "$WORK/inside.sh" <<INSIDE
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq build-essential git python3-pip >/dev/null
pip3 install -q cmake==3.31.6
export PATH=/usr/local/cuda/bin:\$PATH
cd /w/src
cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_CUDA=ON -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF \
  -DCMAKE_CUDA_ARCHITECTURES='$ARCHS' -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_SDL2=OFF \
  -DCMAKE_EXE_LINKER_FLAGS='-static-libstdc++ -static-libgcc'
cmake --build build --target whisper-server -j 16
INSIDE
# label=disable: the toolkit is mounted read-only and never relabelled
podman run --rm --security-opt label=disable -v "$WORK:/w" -v "$CUDA:/usr/local/cuda:ro" docker.io/library/ubuntu:22.04 bash /w/inside.sh
OUT="$WORK/whisper-cuda13-linux-x64"
rm -rf "$OUT" && mkdir -p "$OUT"
cp "$WORK/src/build/bin/whisper-server" "$WORK/src/LICENSE" "$OUT/"
{
  echo "whisper.cpp $TAG ($(git -C "$WORK/src" rev-parse HEAD)), whisper-server, CUDA $(basename "$CUDA"), Ubuntu 22.04, archs $ARCHS"
  echo "Needs at run time: an NVIDIA driver 580 or newer and libcudart.so.13, libcublas.so.13, libcublasLt.so.13 on LD_LIBRARY_PATH."
} > "$OUT/BUILD.txt"
tar -C "$WORK" -czf "$WORK/whisper-cuda13-linux-x64.tar.gz" whisper-cuda13-linux-x64
stat -c '%s bytes' "$WORK/whisper-cuda13-linux-x64.tar.gz"
sha256sum "$WORK/whisper-cuda13-linux-x64.tar.gz"
