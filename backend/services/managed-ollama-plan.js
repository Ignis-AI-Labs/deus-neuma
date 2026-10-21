// managed-ollama-plan — what the platform installs for a person who has no model server,
// decided from the machine alone. Pure: no I/O; managed-ollama.js does the work.
//
// THE STANDARD (Design note, 2026-10-22: an installer checks what the person needs, says what is
// missing, and installs it for them when it can. A first run with no local model server used to
// end at […], a dead end for anyone who has never heard of
// one. Now the platform offers to set one up: Ollama (it drives NVIDIA and AMD cards and the
// processor on Linux and Windows, and pulls a model straight from Hugging Face), kept under
// the platform's own data root, no admin rights, and the model the capacity check already
// recommends for this machine (substrate-setup.js). The first-run discovery then adopts the
// running server as it adopts any other (provider-discovery.js pickAutoAdopt).
//
// Why Ollama and not the supervised llama-server: the supervisor launches only with a physical
// NVIDIA binding and a Linux-shaped child environment (serving-launch-config.js), so it cannot
// serve an AMD card, a processor-only machine or any Windows PC.
//
// The build is PINNED with the SHA-256 GitHub publishes for each file: a download that does not
// hash to these bytes is discarded, never run. Moving the pin is a reviewed commit.

export const OLLAMA_VERSION = '0.40.7';
// The oldest Ollama trusted with the recommended models: the pinned build. An older one is not
// used (proven 2026-10-22: Ollama 0.24.0 refuses the Qwen3.8 GGUF the capacity check
// recommends, […]), so the platform sets up its own.
export const MIN_OLLAMA_VERSION = OLLAMA_VERSION;
export const OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';
// Where the platform's own server answers when the usual port holds an outdated or foreign one
export const OLLAMA_ALT_ENDPOINT = 'http://127.0.0.1:11435';
const RELEASE = `https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}`;

const ASSETS = Object.freeze({
  'linux-x64': Object.freeze({
    name: 'ollama-linux-amd64.tar.zst',
    size: 1_505_607_169,
    sha256: '7f082e625b4c334df84ed1558fe282d6d8091fe3545790aef30b3a9c50d44d41',
    format: 'tar.zst',
    bin: 'bin/ollama',
  }),
  'win32-x64': Object.freeze({
    name: 'ollama-windows-amd64.zip',
    size: 1_582_514_985,
    sha256: 'e6527768c53e85ec4596495fb0f035ef07f437b4b591ebc3581684699a4668f4',
    format: 'zip',
    bin: 'ollama.exe',
  }),
});

const GB = 1_000_000_000;
// room for the archive while it unpacks, the unpacked server, and the model's own headroom
const UNPACK_FACTOR = 2.2;
const MODEL_HEADROOM = 1.1;

/** The pinned Ollama download for this OS and CPU, or null where none is published. Pure. */
export const ollamaAssetFor = (platform, arch) => {
  const asset = ASSETS[`${platform}-${arch}`];
  return asset ? Object.freeze({ ...asset, url: `${RELEASE}/${asset.name}` }) : null;
};

/** Is version a at least version b (x.y.z)? An unreadable version is not. Pure. */
export const versionAtLeast = (a, b) => {
  const parse = (v) => (String(v || '').match(/(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
  const [x, y] = [parse(a), parse(b)];
  if (x.length !== 3 || y.length !== 3) return false;
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i];
  return true;
};

/** The Ollama name of a recommended Hugging Face GGUF: hf.co/<repo>:<quant>. Pure. */
export const ollamaModelRef = (recommendation) => {
  const source = recommendation?.source;
  const quant = recommendation?.quant;
  if (typeof source !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(source)) return null;
  if (typeof quant !== 'string' || !/^[\w.-]+$/.test(quant)) return null;
  return `hf.co/${source}:${quant}`;
};

// The quantization names Hugging Face serves to Ollama (llama.cpp's standard schemes). A custom
// one is refused at the manifest (proven 2026-10-22: Q8_K_P, […]).
const PULLABLE_QUANT = /^(Q[2-8]_K(_[SML])?|Q[4-8]_[01]|IQ[1-4]_(XXS|XS|S|M|NL)|BF16|F16|F32|TQ[12]_0|MXFP4)$/i;

/** Can Ollama pull this choice from Hugging Face? Pure. */
export const ollamaPullable = (choice) => Boolean(ollamaModelRef(choice)) && PULLABLE_QUANT.test(choice.quant);

/**
 * The model to set up: the recommendation when Ollama can pull it, else the first of the
 * recommendation's own options (best first) that it can, with the reason. Pure.
 */
export const pullableChoice = (recommendation) => {
  if (!recommendation?.model) return { choice: null, note: null };
  if (ollamaPullable(recommendation)) return { choice: recommendation, note: null };
  const next = (recommendation.options || []).find(ollamaPullable) || null;
  return {
    choice: next,
    note: next
      ? `The model matched to this machine, ${recommendation.model} (${recommendation.quant}), uses a quantization Ollama cannot download, so Deus Neuma sets up the next best: ${next.model}. You can serve ${recommendation.model} later with llama.cpp or LM Studio.`
      : null,
  };
};

/**
 * What setting up a model server on this machine would take. Pure.
 * @param {{platform: string, arch: string, recommendation: object|null,
 *   running: {up: boolean, version: string|null, models: string[]},
 *   system: {bin: string, version: string|null}|null, managedInstalled: boolean, freeBytes: number|null}} machine
 *   running: what answers on the usual port; system: an Ollama installed outside the platform
 */
export const installPlan = ({ platform, arch, recommendation: matched, running, system, managedInstalled, freeBytes }) => {
  const { choice: recommendation, note: choiceNote } = pullableChoice(matched);
  const ref = ollamaModelRef(recommendation);
  if (!ref) {
    return Object.freeze({ supported: false, reason: matched?.why || 'This machine is below the floor for a local model, so there is no model to set up.' });
  }
  const asset = ollamaAssetFor(platform, arch);
  const runningOk = Boolean(running?.up && versionAtLeast(running.version, MIN_OLLAMA_VERSION));
  const systemOk = Boolean(system && versionAtLeast(system.version, MIN_OLLAMA_VERSION));
  const notes = choiceNote ? [choiceNote] : [];
  if (running?.up && !runningOk) notes.push(`An Ollama${running.version ? ` ${running.version}` : ''} is running here, too old for this model (it needs ${MIN_OLLAMA_VERSION} or newer). Deus Neuma sets up its own beside it and leaves yours as it is.`);
  else if (system && !systemOk) notes.push(`An older Ollama${system.version ? ` (${system.version})` : ''} is installed here, too old for this model. Deus Neuma sets up its own ${OLLAMA_VERSION} beside it and leaves yours as it is.`);
  const server = runningOk ? 'running' : systemOk && !running?.up ? 'installed' : managedInstalled ? 'managed' : 'download';
  if (server === 'download' && !asset) {
    return Object.freeze({ supported: false, reason: `There is no Ollama build for ${platform} on ${arch}. Install a model server yourself (Ollama ${MIN_OLLAMA_VERSION} or newer, LM Studio or llama.cpp), then RECHECK.` });
  }
  // the usual port is taken by an Ollama the platform will not use: its own answers on the next one
  const endpoint = running?.up && !runningOk ? OLLAMA_ALT_ENDPOINT : OLLAMA_ENDPOINT;
  const haveModel = runningOk && (running.models || []).some((m) => m.toLowerCase() === ref.toLowerCase());
  const modelBytes = Math.round((Number(recommendation.sizeGB) || 0) * GB);
  const steps = [];
  if (server === 'download') steps.push({ id: 'download', label: `Download Ollama ${OLLAMA_VERSION}`, bytes: asset.size });
  if (server === 'download') steps.push({ id: 'unpack', label: 'Unpack it', bytes: 0 });
  if (server !== 'running') steps.push({ id: 'start', label: 'Start the model server', bytes: 0 });
  if (!haveModel) steps.push({ id: 'pull', label: `Download ${recommendation.model} (${recommendation.quant})`, bytes: modelBytes });
  const needBytes = Math.round((server === 'download' ? asset.size * UNPACK_FACTOR : 0) + (haveModel ? 0 : modelBytes * MODEL_HEADROOM));
  return Object.freeze({
    supported: true,
    server,
    endpoint,
    notes: Object.freeze(notes),
    model: Object.freeze({ ref, name: recommendation.model, quant: recommendation.quant, sizeGB: recommendation.sizeGB, ready: haveModel }),
    steps: Object.freeze(steps.map((s) => Object.freeze(s))),
    downloadBytes: steps.reduce((n, s) => n + s.bytes, 0),
    needBytes,
    freeBytes: freeBytes ?? null,
    enoughDisk: freeBytes == null || freeBytes >= needBytes,
  });
};

/** One line of Ollama's streamed /api/pull: status, and bytes when it reports them. Pure. */
export const pullProgress = (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return null; }
  if (!msg || typeof msg !== 'object') return null;
  if (msg.error) return Object.freeze({ error: String(msg.error) });
  return Object.freeze({
    status: String(msg.status || ''),
    completed: Number.isFinite(msg.completed) ? msg.completed : null,
    total: Number.isFinite(msg.total) ? msg.total : null,
  });
};

/** Bytes as a person reads them. Pure. */
export const humanBytes = (n) => {
  if (!Number.isFinite(n) || n < 0) return '?';
  if (n >= GB) return `${(n / GB).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / 1_000_000))} MB`;
};
