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
// the app's data folder. The server runs only while dictation is used, on a third of the processor
// (4 to 8 threads), so the model and the rest of the machine keep their share.

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

const MODEL_REPO = 'ggerganov/whisper.cpp';
const MODEL_REV = '5359861c739e955e79d9a303bcbc70fb988958b1';
const model = (name, size, sha256, label) => Object.freeze({
  label, name, size, sha256, url: `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REV}/${name}`,
});
// Both multilingual (Thai included), MIT. The turbo build on a processor with room for it; the small
// one where a third of the processor is only a few cores, so a held key still reads back quickly.
export const STT_MODELS = Object.freeze({
  turbo: model('ggml-large-v3-turbo-q5_0.bin', 574_041_195, '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2', 'Whisper large-v3 turbo'),
  small: model('ggml-small-q5_1.bin', 190_085_487, 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb', 'Whisper small'),
});

/**
 * Threads the speech server may use: a third of the cores, at least 4 (or every core but one on a
 * smaller machine), at most 8, so a dictation never takes the processor from everything else. Pure.
 * @param {number} cores
 */
export const sttThreads = (cores) => {
  const n = Math.max(1, Math.floor(Number(cores) || 1));
  return Math.max(Math.min(4, Math.max(1, n - 1)), Math.min(8, Math.floor(n / 3)));
};

/** The model for this processor. Pure. */
export const sttModelFor = (cores) => (Number(cores) >= 12 ? STT_MODELS.turbo : STT_MODELS.small);

/**
 * What setting up dictation here takes, or { supported: false } where no build is published. Pure.
 * @param {{platform: string, arch: string, cores: number, installed: boolean, modelPresent: boolean, freeBytes: number|null}} machine
 */
export const sttPlan = ({ platform, arch, cores, installed, modelPresent, freeBytes }) => {
  const engine = sttEngineFor(platform, arch);
  if (!engine) return Object.freeze({ supported: false, reason: `There is no whisper.cpp build for ${platform} on ${arch}.` });
  const m = sttModelFor(cores);
  const steps = [];
  if (!installed) steps.push({ id: 'download', label: `Download whisper.cpp ${WHISPER_CPP_BUILD}`, bytes: engine.size });
  if (!modelPresent) steps.push({ id: 'pull', label: `Download ${m.label}`, bytes: m.size });
  const downloadBytes = steps.reduce((n, s) => n + s.bytes, 0);
  // room for the archive beside what it unpacks to, and the model beside its .part
  const needBytes = Math.round((installed ? 0 : engine.size * 4) + (modelPresent ? 0 : m.size * 1.1));
  return Object.freeze({
    supported: true,
    engine: 'whisper.cpp',
    build: WHISPER_CPP_BUILD,
    model: m,
    threads: sttThreads(cores),
    steps: Object.freeze(steps.map((s) => Object.freeze(s))),
    downloadBytes,
    needBytes,
    enoughDisk: freeBytes == null || freeBytes >= needBytes,
    ready: installed && modelPresent,
  });
};

/** The engine's arguments: loopback only, the processor's share, every language, no GPU. Pure. */
export const sttServerArgs = ({ modelPath, threads, port }) => Object.freeze([
  '-m', modelPath, '-t', String(threads), '--host', '127.0.0.1', '--port', String(port), '-l', 'auto', '-ng',
]);
