// managed-engine-plan — the fast engine the platform sets up on a Linux PC with an NVIDIA card,
// decided from the machine alone. Pure: no I/O; managed-engine.js does the work.
//
// THE HOUSE'S SPEED FOR EVERY OPERATOR (Design note, 2026-11-09: […]). The house serves through llama.cpp under the platform's own supervisor:
//   - the context pool is fitted to the card (serving-fit.js)
//   - it holds parallel slots
//   - it guesses ahead with the model's own MTP head
//   - DFlash2 runs where the engine has replay (serving-drafter.js)
// Ollama runs its own llama-server inside itself, with one slot and its own launch, so none of
// that reached a person who set up a model here. Where the supervisor can serve (Linux x64, an
// NVIDIA card), the setup now installs llama.cpp and the supervisor runs it. Everywhere else the
// Ollama path stands (managed-ollama-plan.js).
//
// The engine is PINNED like Ollama: an upstream release, each archive checked against the SHA-256
// GitHub publishes for it. The build ships its CUDA runtime as a second archive. Both unpack into
// one folder, because the server looks for its libraries beside itself (RUNPATH $ORIGIN). So the
// person needs only the NVIDIA driver, not a CUDA toolkit. Moving the pin is a reviewed commit.
// The next pin is the release that carries recurrent replay (llama.cpp PR #31669); with it, the
// DFlash2 drafter already beside the model turns on by itself.
//
// The model files are pinned the same way: a Hugging Face revision, and each file's size and
// SHA-256. Every 27B file below carries the MTP head (qwen35.nextn_predict_layers = 1, read from
// each header 2026-11-09). ISTA's 3-bit builds pin their -mtp files for that reason.

export const LLAMA_CPP_BUILD = 'b12212';
export const LLAMA_CPP_COMMIT = 'd78f4255d4d27ebef8dfd27f58f9ee3c8e4b7afb';
const RELEASE = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_BUILD}`;

const archive = (label, name, size, sha256) => Object.freeze({ label, name, size, sha256, format: 'tar.gz', url: `${RELEASE}/${name}` });

// Newest CUDA first. A driver takes the newest build whose CUDA major it runs; within one major,
// a newer runtime runs on an older driver (CUDA minor-version compatibility). CUDA 13 dropped the
// cards before Turing, and the floor below keeps both builds to Turing and newer.
const VARIANTS = Object.freeze([
  Object.freeze({
    id: 'cuda-13.5', cuda: '13.5', minDriver: 580,
    engine: archive('llama.cpp', 'llama-b12212-bin-ubuntu-cuda-13.5-x64.tar.gz', 169_836_844, 'f565eb0396877b3a101265e0e84e4ef3a5ed2ec70eebbb18b9a1462cefe790c2'),
    runtime: archive('CUDA runtime', 'cudart-llama-b12212-bin-ubuntu-cuda-13.5-x64.tar.gz', 444_078_944, '139de937cf44e5e4ef6e7443fc9d766b01835a6b176677bb434b5d7e8871933a'),
  }),
  Object.freeze({
    id: 'cuda-12.8', cuda: '12.8', minDriver: 570,
    engine: archive('llama.cpp', 'llama-b12212-bin-ubuntu-cuda-12.8-x64.tar.gz', 188_258_753, 'b934629500b2eeab1256ccade67212fc33c70be0d09b3229751315a125c8b253'),
    runtime: archive('CUDA runtime', 'cudart-llama-b12212-bin-ubuntu-cuda-12.8-x64.tar.gz', 594_371_409, '23978b289b8864681eadc94ca0edde565833dc50e5cb5b32d20b8df33e783b41'),
  }),
]);

/** Turing (RTX 20) and newer: the oldest card both builds serve. */
export const MIN_COMPUTE = 7.5;

/** The driver's major version ('615.71.09' → 615), or NaN. Pure. */
export const driverMajor = (driver) => Number.parseInt(String(driver ?? '').trim(), 10);

/**
 * The engine build for this machine, or null where the supervisor cannot serve it (the Ollama
 * path stands). Pure.
 * @param {{platform: string, arch: string, gpu: {vendor?: string, unified?: boolean, driver?: string}|null, computeCap: number|null}} machine
 */
export const engineVariantFor = ({ platform, arch, gpu, computeCap }) => {
  if (platform !== 'linux' || arch !== 'x64') return null;
  if (gpu?.vendor !== 'nvidia' || gpu.unified) return null;
  if (!(Number(computeCap) >= MIN_COMPUTE)) return null;
  const major = driverMajor(gpu.driver);
  return VARIANTS.find((v) => major >= v.minDriver) || null;
};

const hf = (repo, revision, name, size, sha256) => Object.freeze({
  label: name, repo, revision, name, size, sha256, url: `https://huggingface.co/${repo}/resolve/${revision}/${encodeURIComponent(name)}`,
});

/** The DFlash2 block drafter for Qwen3.8-27B (z-lab, Apache-2.0), byte-identical to the house's. */
export const DRAFTER = hf('z-lab/Qwen3.8-27B-DFlash2-GGUF', '2d9571f8ce46e151f61c6499c99dee6079e1d610',
  'Qwen3.8-27B-DFlash2-Q8_0.gguf', 2_056_414_816, 'c18e800daedc59ca68fd13b6a856d795746af6d399a9279ac6a277d1d422f87e');

// The files each recommended choice is served from, keyed by its source and quant
// (substrate-setup.js CHOICES). The drafter rides the tiers of 32 GB and up, the cards where it was
// measured with room to spare. A choice that is not here keeps the Ollama path.
const HAUHAU = 'HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF';
const HAUHAU_REV = '993a5971fda8f30dd1b7eb2654792ba4415c7460';
const UNSLOTH = 'unsloth/Qwen3.8-27B-GGUF';
const UNSLOTH_REV = '4ca720788d1e01f1bff70c033e0d0028fd02e502';
const LMSTUDIO = 'lmstudio-community/Qwen3.8-27B-GGUF';
const LMSTUDIO_REV = '5a7da681f60570ab5b439a587e912d2e5eddb582';
const ISTA = 'ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF';
const ISTA_REV = 'd562806dbafae37109975e970aae91b43e73b440';
const ISTA_MMPROJ = hf(ISTA, ISTA_REV, 'mmproj-Qwen3.8-27B-BF16.gguf', 931_146_528, '13cb7bebccbd04afc8f4090cb949ecf8937cdf7377c5799b1a0c594e7c0d3e16');
// Our own model (Design note, 2026-11-09: […]), published by Ignis AI Labs.
// The revision is the upload's own commit; every file is checked against its SHA-256 on arrival.
export const T4 = 'IgnisAILabs/Qwen3.8-27B-Neuma-T4-GGUF';
const T4_REV = '7c360edd681047e3c62bec35f9de99a733235462';
const T4_FILE = (quant, size, sha256) => hf(T4, T4_REV, `Qwen3.8-27B-Neuma-T4-${quant}.gguf`, size, sha256);
const T4_MMPROJ = hf(T4, T4_REV, 'mmproj-Qwen3.8-27B-Neuma-T4-BF16.gguf', 931_145_888, 'de2a49866988ea272c43dc2a43ee2662c25725a717ca5b9059ea420a97f53fe8');
const DISTILL = 'empero-ai/Qwen3.8-4B-Distill-GGUF';
const DISTILL_REV = '391fc7d103e3942a408def3e4f51c2f85d464417';

const MODEL_FILES = Object.freeze({
  // T4, card by card (measured 2026-11-09): 48 GB+ Q6_K, 32 GB IQ4_XS, 24 GB IQ3_M on the engine; the
  // 12 and 16 GB builds (IQ3_XXS, IQ3_M) do not fit the full-GPU launch and take the Ollama path
  // (engineFits), which reads these same files from the same repository.
  [`${T4}:Q6_K`]: Object.freeze({ folder: 'qwen3.8-27b-neuma-t4-q6_k', model: T4_FILE('Q6_K', 22_533_850_848, '66cf8a045f327fdb6c8376989251b3576a8bf36c9999fb6da36c536303505bd4'), mmproj: T4_MMPROJ, drafter: DRAFTER }),
  [`${T4}:IQ4_XS`]: Object.freeze({ folder: 'qwen3.8-27b-neuma-t4-iq4_xs', model: T4_FILE('IQ4_XS', 15_533_827_808, 'f0a43dae1ceff2c716ca45983be31a846117a673750090a19aa09947c995f0fb'), mmproj: T4_MMPROJ, drafter: DRAFTER }),
  [`${T4}:IQ3_M`]: Object.freeze({ folder: 'qwen3.8-27b-neuma-t4-iq3_m', model: T4_FILE('IQ3_M', 13_032_195_808, 'f8a66ba6cbfae79a3e6ac6edbf431745fb3b3104d46bdc1aad26a2db67c1e3ac'), mmproj: T4_MMPROJ, drafter: null }),
  [`${T4}:IQ3_XXS`]: Object.freeze({ folder: 'qwen3.8-27b-neuma-t4-iq3_xxs', model: T4_FILE('IQ3_XXS', 11_637_692_128, '75e4d0e48feb947c9b790e004a501c3efb45741b83fbd9160eb92dcf3c7d7a2e'), mmproj: T4_MMPROJ, drafter: null }),
  [`${HAUHAU}:Q8_K_P`]: Object.freeze({
    folder: 'qwen3.8-27b-hauhaucs-q8_k_p',
    model: hf(HAUHAU, HAUHAU_REV, 'Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf', 31_457_990_784, '4e7735df4d1e2ec721f2551f531b815702a2f89123238c564797eda4b0304bc2'),
    mmproj: hf(HAUHAU, HAUHAU_REV, 'mmproj-Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-BF16.gguf', 931_146_624, '5681b690bcb8eb10cd28d62d078cb4e01521a3ea4880a3fc7d54de72de2dd142'),
    drafter: DRAFTER,
  }),
  [`${UNSLOTH}:Q6_K`]: Object.freeze({
    folder: 'qwen3.8-27b-q6_k',
    model: hf(UNSLOTH, UNSLOTH_REV, 'Qwen3.8-27B-UD-Q6_K.gguf', 21_983_677_344, 'c9c206812fbe4ac7b76a729e25928b63f2ae89d37f69da7a71c20aec763cd436'),
    mmproj: hf(UNSLOTH, UNSLOTH_REV, 'mmproj-BF16.gguf', 931_146_432, '83ee4f4f205fa514161778c41df1ea14144faa0f713510893b63c2395f5c2d53'),
    drafter: DRAFTER,
  }),
  [`${LMSTUDIO}:Q4_K_M`]: Object.freeze({
    folder: 'qwen3.8-27b-q4_k_m',
    model: hf(LMSTUDIO, LMSTUDIO_REV, 'Qwen3.8-27B-Q4_K_M.gguf', 16_810_714_336, 'e00082f779fa385cee8c68a3ec8833a75778cc87272240b942f74e0b8243e520'),
    mmproj: hf(LMSTUDIO, LMSTUDIO_REV, 'mmproj-Qwen3.8-27B-BF16.gguf', 931_145_856, '97ba9d70e7407f08c880def231fd360a312c76d0053387733f10dcf6affd75a1'),
    drafter: null,
  }),
  [`${ISTA}:IQ3_S`]: Object.freeze({
    folder: 'qwen3.8-27b-gsq-rco-iq3_s',
    model: hf(ISTA, ISTA_REV, 'Qwen3.8-27B-GSQ-RCO-IQ3_S-mtp.gguf', 12_120_016_960, '58fd826723939933dc86f45b7fe04545cbc2de1c70f6fe2cdd3858c87a98c12f'),
    mmproj: ISTA_MMPROJ,
    drafter: null,
  }),
  [`${ISTA}:IQ3_XXS`]: Object.freeze({
    folder: 'qwen3.8-27b-gsq-rco-iq3_xxs',
    model: hf(ISTA, ISTA_REV, 'Qwen3.8-27B-GSQ-RCO-IQ3_XXS-mtp.gguf', 10_442_827_840, '63f29a2189a6b4cc31f81e093d3856ad293a5583114439f41ae1ed7af4093262'),
    mmproj: ISTA_MMPROJ,
    drafter: null,
  }),
  [`${DISTILL}:Q4_K_M`]: Object.freeze({
    folder: 'qwen3.8-4b-distill-q4_k_m',
    model: hf(DISTILL, DISTILL_REV, 'Qwen3.8-4B-Q4_K_M.gguf', 2_783_446_304, 'dec96e8cf2e11b613bb46513dec485377f9ca5a351e71712ee0e244f287c6790'),
    mmproj: null,
    drafter: null,
  }),
});

/** The pinned files a recommended choice is served from, or null. Pure. */
export const modelFilesFor = (choice) => MODEL_FILES[`${choice?.source}:${choice?.quant}`] || null;

const MiB = 1024 * 1024;
// What our launch holds beyond the weights at a 16K pool, the least a birth needs: measured on the rig
// 2026-11-09 for every T4 build (neuma-research inference-speed/runs/fitprobe-20261109T140823Z.json,
// the production argv, 6 slots): ~6.26 GB with the vision projector and the MTP draft, ~5.1 GB without
// the projector. The drafter, where one rides, adds its file and its draft context.
const OVER_WEIGHTS_MIB = Object.freeze({ projector: 6260, bare: 5120 });
// the desktop's own share of the card, and the fit's margin (serving-fit.js FIT_MARGIN_MIB)
const DESKTOP_MIB = 600;
const MARGIN_MIB = 512;
const SHARE = 0.85;

/** MiB the served model holds at a 16K pool, by what is beside it. Pure. */
export const servedMiB = (files) => Math.ceil(files.model.size / MiB)
  + (files.mmproj ? OVER_WEIGHTS_MIB.projector : OVER_WEIGHTS_MIB.bare)
  + (files.drafter ? Math.ceil(files.drafter.size / MiB) + 2048 : 0);

/**
 * Does our full-GPU launch fit this card under the default share, at a pool a birth can use? A card it
 * does not fit takes the Ollama path, which can put part of the model on the processor. Before this
 * check a 16 or 24 GB card was handed the engine and failed at load (2026-11-09). Pure.
 * @param {object} files - modelFilesFor()
 * @param {{vramGB?: number}|null} gpu
 */
export const engineFits = (files, gpu) => Number(gpu?.vramGB) > 0
  && servedMiB(files) + DESKTOP_MIB + MARGIN_MIB <= gpu.vramGB * 1024 * SHARE;

/** Every file a choice downloads, model first, each once. Pure. */
export const filesOf = (files) => [files.model, files.mmproj, files.drafter].filter(Boolean);

// room for both archives while they unpack, and for the model files beside their .part
const UNPACK_FACTOR = 2.2;
const MODEL_HEADROOM = 1.1;

/**
 * What setting up the fast engine on this machine would take, or null where it does not apply
 * (the Ollama path decides). Pure.
 * @param {{platform: string, arch: string, gpu: object|null, computeCap: number|null,
 *   recommendation: object|null, installed: boolean, present: ReadonlyArray<string>,
 *   freeBytes: number|null, verify?: boolean}} machine
 *   installed: this build's engine is on disk; present: the names of the choice's files already in
 *   its folder at their full size (each was checked against its SHA-256 when it arrived)
 */
export const enginePlan = ({ platform, arch, gpu, computeCap, recommendation, installed, present = [], freeBytes, verify = true }) => {
  const variant = engineVariantFor({ platform, arch, gpu, computeCap });
  const files = recommendation?.model && recommendation.mode === 'gpu' ? modelFilesFor(recommendation) : null;
  // the card, or the operator's smaller model budget (NEUMA_MODEL_BUDGET_GB) where one is set
  const card = { vramGB: Math.min(Number(gpu?.vramGB) || 0, Number(recommendation.budgetGB) || Infinity) };
  if (!variant || !files || !engineFits(files, card)) return null;
  const missing = filesOf(files).filter((f) => !present.includes(f.name));
  const steps = [];
  if (!installed) {
    steps.push({ id: 'download', label: `Download llama.cpp ${LLAMA_CPP_BUILD} (CUDA ${variant.cuda})`, bytes: variant.engine.size });
    steps.push({ id: 'runtime', label: `Download the CUDA ${variant.cuda} runtime`, bytes: variant.runtime.size });
    steps.push({ id: 'unpack', label: 'Unpack them', bytes: 0 });
  }
  if (missing.includes(files.model)) steps.push({ id: 'pull', label: `Download ${recommendation.model} (${recommendation.quant})`, bytes: files.model.size });
  if (files.mmproj && missing.includes(files.mmproj)) steps.push({ id: 'projector', label: 'Download its vision projector', bytes: files.mmproj.size });
  if (files.drafter && missing.includes(files.drafter)) steps.push({ id: 'drafter', label: 'Download the DFlash2 drafter', bytes: files.drafter.size });
  if (verify) steps.push({ id: 'verify', label: 'Check that it answers', bytes: 0 });
  const archiveBytes = installed ? 0 : variant.engine.size + variant.runtime.size;
  const fileBytes = missing.reduce((n, f) => n + f.size, 0);
  const needBytes = Math.round(archiveBytes * UNPACK_FACTOR + fileBytes * MODEL_HEADROOM);
  return Object.freeze({
    supported: true,
    engine: 'llama.cpp',
    build: LLAMA_CPP_BUILD,
    variant: variant.id,
    server: installed ? 'engine-installed' : 'engine-download',
    managed: true,
    notes: Object.freeze([
      'On this PC the model runs on llama.cpp, the engine Deus Neuma\'s own house runs on. It fits the model to your graphics card, holds several conversations at once, and guesses ahead with the model\'s own built-in predictor, so it writes faster.',
    ]),
    model: Object.freeze({ ref: files.model.name, name: recommendation.model, quant: recommendation.quant, sizeGB: recommendation.sizeGB, ready: missing.length === 0 }),
    folder: files.folder,
    steps: Object.freeze(steps.map((s) => Object.freeze(s))),
    downloadBytes: steps.reduce((n, s) => n + s.bytes, 0),
    needBytes,
    freeBytes: freeBytes ?? null,
    enoughDisk: freeBytes == null || freeBytes >= needBytes,
    gpuDriver: null,
  });
};

/** The variant's two archives, or null for a build this plan does not know. Pure. */
export const engineArchives = (variantId) => {
  const v = VARIANTS.find((x) => x.id === variantId);
  return v ? Object.freeze({ engine: v.engine, runtime: v.runtime }) : null;
};

/**
 * The sentence a finished setup ends on. Pure.
 * @param {{name: string, loaded: boolean}} done
 */
export const engineDoneLine = ({ name, loaded }) => (loaded
  ? `${name} is ready on llama.cpp ${LLAMA_CPP_BUILD}.`
  : `${name} is downloaded and llama.cpp ${LLAMA_CPP_BUILD} is ready. The model loads when Deus Neuma first opens, not before.`);
