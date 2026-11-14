// managed-stt-plan — dictation on a machine without the repo's Python speech server: whisper.cpp
// on the PROCESSOR, decided from the machine alone. Pure; managed-stt.js does the work.
//
// THE CAUSE IT ANSWERS (2026-11-09, a tester on an RTX 5070): […]. An
// installed app ships only voice-engines/engines.json (electron-builder.yml). The Python speech
// server, its downloader and its models are host-provisioned, so DOWNLOAD MODEL could never work
// there: the route's first act, a log folder inside the read-only install, threw. And a 12 GB card
// is already full with the model, so speech must not take graphics memory at all (Design note, 2026-11-09:
// […]).
//
// So an installed app downloads whisper.cpp's own processor build, pinned to the SHA-256 GitHub
// publishes, and a multilingual Whisper model from Hugging Face at a pinned revision. Both live in
// the app's data folder. The server runs on a third of the processor (4 to 8 threads), so the model
// and the rest of the machine keep their share.
//
// THE MODEL IS SIZED FOR A HELD KEY (2026-11-12): dictation works like ears, hold, release, and the
// words land in the box at once. Timed on whisper.cpp b5454 with this
// build's own server, a 4.5 s and a 14 s recording, the processor busy with the house and its
// agents: turbo 8 to 15 s a hold (4 s with a shortened audio window, which drops words past 15 s),
// small 1.7 to 3.1 s, base 0.4 to 0.8 s. Turbo is the ears model, and it is quick on a graphics card,
// never on a processor; base keeps a release as quick as ears.

export const WHISPER_CPP_BUILD = 'b5454';
const RELEASE = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CPP_BUILD}`;

// The processor builds, one per system (the Windows one carries OpenBLAS for the encoder's math).
const ENGINES = Object.freeze({
  'linux-x64': Object.freeze({ label: 'whisper.cpp', name: 'whisper-bin-ubuntu-x64.tar.gz', size: 10_364_195, sha256: 'a72becf15d7917f990f6313867a52638b82b7f9ef237fb0c980dac56a135781c', format: 'tar.gz', bin: 'whisper-bin-ubuntu-x64/whisper-server' }),
  'win32-x64': Object.freeze({ label: 'whisper.cpp', name: 'whisper-blas-bin-x64.zip', size: 21_715_607, sha256: 'b1158bd10edf92c9799149a6fc5d3e58da3f495241d6fb3423088130e88ffbf3', format: 'zip', bin: 'Release/whisper-server.exe' }),
});

/** The pinned whisper.cpp build for this system, or null where none is published. Pure. */
export const sttEngineFor = (platform, arch) => {
  const e = ENGINES[`${platform}-${arch}`];
  return e ? Object.freeze({ ...e, url: `${RELEASE}/${e.name}` }) : null;
};

// THE GRAPHICS-CARD BUILD, where the card has room for it (managed-stt-device.js decides). whisper.cpp
// publishes none for Linux, so the platform builds and hosts its own from the same tag:
// scripts/speech/build-whisper-cuda.sh (CUDA 13, Ubuntu 22.04's glibc, Turing to Blackwell). It
// borrows the CUDA 13 runtime from the Ollama the platform sets up rather than shipping it.
const GPU_RELEASE = `https://github.com/Ignis-AI-Labs/deus-neuma/releases/download/speech-whisper.cpp-${WHISPER_CPP_BUILD}-cuda13`;
const GPU_ENGINES = Object.freeze({
  'linux-x64': Object.freeze({ label: 'whisper.cpp (CUDA 13)', name: 'whisper-cuda13-linux-x64.tar.gz', size: 130_623_323, sha256: 'a81df78fdb0b59c705fef0628717cd82082359f976e02b3a31700b01a46c2068', format: 'tar.gz', bin: 'whisper-cuda13-linux-x64/whisper-server' }),
});

/** The platform's graphics-card build for this system, or null where there is none. Pure. */
export const sttGpuEngineFor = (platform, arch) => {
  const e = GPU_ENGINES[`${platform}-${arch}`];
  return e ? Object.freeze({ ...e, url: `${GPU_RELEASE}/${e.name}` }) : null;
};

const MODEL_REPO = 'ggerganov/whisper.cpp';
const MODEL_REV = '5359861c739e955e79d9a303bcbc70fb988958b1';
const model = (name, size, sha256, label) => Object.freeze({
  label, name, size, sha256, url: `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REV}/${name}`,
});
// Multilingual (Thai included), MIT. The SHA-256 is Hugging Face's own (x-linked-etag at this revision).
export const STT_MODEL = model('ggml-base-q5_1.bin', 59_707_625, '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898', 'Whisper base');
// On the graphics card: turbo, the model ears runs.
export const STT_GPU_MODEL = model('ggml-large-v3-turbo-q5_0.bin', 574_041_195, '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2', 'Whisper large-v3 turbo');

/**
 * Threads the speech server may use: a third of the cores, at least 4 (or every core but one on a
 * smaller machine), at most 8, so a dictation never takes the processor from everything else. Pure.
 * @param {number} cores
 */
export const sttThreads = (cores) => {
  const n = Math.max(1, Math.floor(Number(cores) || 1));
  return Math.max(Math.min(4, Math.max(1, n - 1)), Math.min(8, Math.floor(n / 3)));
};

/**
 * What setting up dictation here takes, or { supported: false } where no build is published. On the
 * graphics card the processor's engine and model are set up too: the card's server falls back to
 * them if it cannot start. `ready` is the processor's pair (dictation works); `cardReady` is the
 * card's pair beside it, so a machine already dictating never stops for the card's download. Pure.
 * @param {{platform: string, arch: string, cores: number, installed: boolean, modelPresent: boolean,
 *   freeBytes: number|null, device?: 'gpu'|'processor', gpuInstalled?: boolean, gpuModelPresent?: boolean}} machine
 */
export const sttPlan = ({ platform, arch, cores, installed, modelPresent, freeBytes, device = 'processor', gpuInstalled = false, gpuModelPresent = false }) => {
  const engine = sttEngineFor(platform, arch);
  if (!engine) return Object.freeze({ supported: false, reason: `There is no whisper.cpp build for ${platform} on ${arch}.` });
  const gpuEngine = device === 'gpu' ? sttGpuEngineFor(platform, arch) : null;
  const onCard = Boolean(gpuEngine);
  const m = onCard ? STT_GPU_MODEL : STT_MODEL;
  const steps = [];
  if (!installed) steps.push({ id: 'download', label: `Download whisper.cpp ${WHISPER_CPP_BUILD}`, bytes: engine.size });
  if (!modelPresent) steps.push({ id: 'pull', label: `Download ${STT_MODEL.label}`, bytes: STT_MODEL.size });
  if (onCard && !gpuInstalled) steps.push({ id: 'download-gpu', label: `Download ${gpuEngine.label}`, bytes: gpuEngine.size });
  if (onCard && !gpuModelPresent) steps.push({ id: 'pull-gpu', label: `Download ${STT_GPU_MODEL.label}`, bytes: STT_GPU_MODEL.size });
  const downloadBytes = steps.reduce((n, s) => n + s.bytes, 0);
  // room for each archive beside what it unpacks to, and each model beside its .part
  const needBytes = Math.round(steps.reduce((n, s) => n + s.bytes * (s.id.startsWith('download') ? 4 : 1.1), 0));
  return Object.freeze({
    supported: true,
    engine: 'whisper.cpp',
    build: WHISPER_CPP_BUILD,
    device: onCard ? 'gpu' : 'processor',
    model: m,
    threads: sttThreads(cores),
    steps: Object.freeze(steps.map((s) => Object.freeze(s))),
    downloadBytes,
    needBytes,
    enoughDisk: freeBytes == null || freeBytes >= needBytes,
    ready: installed && modelPresent,
    cardReady: onCard && gpuInstalled && gpuModelPresent,
  });
};

/** The engine's arguments: loopback only, its share of the processor, every language; the card only when asked. Pure. */
export const sttServerArgs = ({ modelPath, threads, port, gpu = false }) => Object.freeze([
  '-m', modelPath, '-t', String(threads), '--host', '127.0.0.1', '--port', String(port), '-l', 'auto', ...(gpu ? [] : ['-ng']),
]);
