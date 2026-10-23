// managed-ollama-plan — what the platform installs for a person who has no model server,
// decided from the machine alone. Pure: no I/O; managed-ollama.js does the work.
//
// THE INSTALL STANDARD (2026-10-22): an installer checks what the person needs, says what is
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

/**
 * The platform's own server endpoints: the usual one, and the next port for when the usual one
 * is held by an Ollama the platform will not use. An override (NEUMA_OLLAMA_ENDPOINT, read by
 * managed-ollama.js) moves both; anything but a loopback http URL is ignored. Pure.
 */
export const managedEndpoints = (override) => {
  const m = /^http:\/\/(127\.0\.0\.1|localhost):(\d{2,5})\/?$/.exec(String(override || '').trim());
  const port = m ? Number(m[2]) : NaN;
  if (!(port >= 1024 && port < 65535)) return Object.freeze({ usual: OLLAMA_ENDPOINT, alt: OLLAMA_ALT_ENDPOINT });
  return Object.freeze({ usual: `http://127.0.0.1:${port}`, alt: `http://127.0.0.1:${port + 1}` });
};

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
 *   own?: {endpoint: string, up: boolean, version: string|null, models: string[]}|null,
 *   system: {bin: string, version: string|null}|null, managedInstalled: boolean, freeBytes: number|null}} machine
 *   running: what answers on the usual port; own: what answers where the platform's own server
 *   was set up (its record); system: an Ollama installed outside the platform; managedInstalled:
 *   the platform's own server is on disk; endpoints: the platform's usual + next endpoint;
 *   gpuGuard: the driver guard (gpu-driver-guard.js), carried for the screen when it has words
 */
export const installPlan = ({ platform, arch, recommendation: matched, running, own = null, system, managedInstalled, freeBytes, endpoints = managedEndpoints(), gpuGuard = null }) => {
  const { choice: recommendation, note: choiceNote } = pullableChoice(matched);
  const ref = ollamaModelRef(recommendation);
  if (!ref) {
    return Object.freeze({ supported: false, reason: matched?.why || 'This machine is below the floor for a local model, so there is no model to set up.' });
  }
  const asset = ollamaAssetFor(platform, arch);
  const ok = (s) => Boolean(s?.up && versionAtLeast(s.version, MIN_OLLAMA_VERSION));
  const ownOk = ok(own);
  const runningOk = ok(running);
  const systemOk = Boolean(system && versionAtLeast(system.version, MIN_OLLAMA_VERSION));
  const notes = choiceNote ? [choiceNote] : [];
  if (!ownOk && running?.up && !runningOk) notes.push(`An Ollama${running.version ? ` ${running.version}` : ''} is running here, too old for this model (it needs ${MIN_OLLAMA_VERSION} or newer). Deus Neuma sets up its own beside it and leaves yours as it is.`);
  else if (!ownOk && !runningOk && system && !systemOk) notes.push(`An older Ollama${system.version ? ` (${system.version})` : ''} is installed here, too old for this model. Deus Neuma sets up its own ${OLLAMA_VERSION} beside it and leaves yours as it is.`);
  const server = ownOk || runningOk ? 'running' : systemOk && !running?.up ? 'installed' : managedInstalled ? 'managed' : 'download';
  if (server === 'download' && !asset) {
    return Object.freeze({ supported: false, reason: `There is no Ollama build for ${platform} on ${arch}. Install a model server yourself (Ollama ${MIN_OLLAMA_VERSION} or newer, LM Studio or llama.cpp), then RECHECK.` });
  }
  // The platform's own server keeps the address it was set up on. A new one never shares the usual
  // port with an Ollama the platform will not use: not one running there now, and not an outdated
  // one installed here, whose own service can take that port at any boot.
  const ownPort = own?.endpoint && !own.up ? own.endpoint
    : running?.up || (system && !systemOk) ? endpoints.alt : endpoints.usual;
  const endpoint = ownOk ? own.endpoint : runningOk || server === 'installed' ? endpoints.usual : ownPort;
  const live = ownOk ? own : running;
  const haveModel = (ownOk || runningOk) && (live.models || []).some((m) => m.toLowerCase() === ref.toLowerCase());
  const modelBytes = Math.round((Number(recommendation.sizeGB) || 0) * GB);
  const steps = [];
  if (server === 'download') steps.push({ id: 'download', label: `Download Ollama ${OLLAMA_VERSION}`, bytes: asset.size });
  if (server === 'download') steps.push({ id: 'unpack', label: 'Unpack it', bytes: 0 });
  if (server !== 'running') steps.push({ id: 'start', label: 'Start the model server', bytes: 0 });
  if (!haveModel) steps.push({ id: 'pull', label: `Download ${recommendation.model} (${recommendation.quant})`, bytes: modelBytes });
  steps.push({ id: 'verify', label: 'Check that it answers', bytes: 0 });
  const needBytes = Math.round((server === 'download' ? asset.size * UNPACK_FACTOR : 0) + (haveModel ? 0 : modelBytes * MODEL_HEADROOM));
  return Object.freeze({
    supported: true,
    server,
    // the platform's own server: started at every boot, its models kept under its own home
    managed: server === 'download' || server === 'managed' || ownOk,
    endpoint,
    notes: Object.freeze(notes),
    model: Object.freeze({ ref, name: recommendation.model, quant: recommendation.quant, sizeGB: recommendation.sizeGB, ready: haveModel }),
    steps: Object.freeze(steps.map((s) => Object.freeze(s))),
    downloadBytes: steps.reduce((n, s) => n + s.bytes, 0),
    needBytes,
    freeBytes: freeBytes ?? null,
    enoughDisk: freeBytes == null || freeBytes >= needBytes,
    gpuDriver: gpuGuard?.line ? gpuGuard : null,
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
  // nothing is 0 MB, never "1 MB" (a plan with nothing to download read "DOWNLOAD 1 MB", 2026-10-23)
  return `${n > 0 ? Math.max(1, Math.round(n / 1_000_000)) : 0} MB`;
};

/**
 * The environment the platform's own `ollama serve` runs with, beside its address and models
 * folder. Pure.
 * - The window: its default is the one every request names, so no request reloads the model.
 * - One model, one slot (2026-10-23): a second model or a second slot is a second share of the
 *   card; the being runs one turn at a time. The person's own setting, if they made one, stands.
 * - A card held by the driver guard (gpu-driver-guard.js) is hidden from the server: CUDA sees no
 *   device and the Vulkan path is off, so the model is loaded on the processor only.
 * @param {{window: number, holdGpu?: boolean, env?: Record<string, string|undefined>}} input
 * @returns {Readonly<Record<string, string>>} the keys to set
 */
export const managedServeEnv = ({ window, holdGpu = false, env = {} }) => Object.freeze({
  OLLAMA_CONTEXT_LENGTH: String(window),
  OLLAMA_NUM_PARALLEL: env.OLLAMA_NUM_PARALLEL || '1',
  OLLAMA_MAX_LOADED_MODELS: env.OLLAMA_MAX_LOADED_MODELS || '1',
  ...(holdGpu ? { CUDA_VISIBLE_DEVICES: '-1', OLLAMA_VULKAN: '0' } : {}),
});
