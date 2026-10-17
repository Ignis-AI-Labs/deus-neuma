/**
 * The custom-sampler graphs — FLUX.2 [klein] (text to image, edit) and the
 * controlled Z-Image lane (the DiT ControlNet). Pure.
 *
 * A module of its own because these families do not ride KSampler's shape
 * (klein) or add a model patch on top of it (the controlled lane); the shared
 * safety guard and the drift gate stay in `templates.js`.
 */
import { safePrefix } from './templates.js';

// The Z-Image loader ids — the same band `buildZImage` uses, because the
// controlled graph IS that graph with a patch between the UNET and the shift.
const ZI_CLIP = '40';
const ZI_VAE = '41';
const ZI_SHIFT = '42';

// ── THE FLUX.2 [klein] GRAPHS ───────────────────────────────────────────────
// A FOURTH family, and the first that does not ride KSampler. Copied node for
// node from ComfyUI's bundled `image_flux2_klein_text_to_image.json` (the
// "Distilled" subgraph) and `image_flux2_klein_image_edit_4b_distilled.json`,
// read 2026-10-13. The facts worth guessing wrong:
//   · sampling is the CUSTOM chain — RandomNoise + KSamplerSelect(euler) +
//     Flux2Scheduler + CFGGuider → SamplerCustomAdvanced. Flux2Scheduler needs
//     the output width/height: its sigma shift depends on resolution.
//   · the distilled model runs at guidance 1.0 with a ZEROED negative
//     (ConditioningZeroOut of the positive), not an empty-string encode.
//   · the latent is EmptyFlux2LatentImage — neither SDXL's nor SD3's.
//   · EDITING is ReferenceLatent: the source image's VAE latent is attached to
//     BOTH the positive and the zeroed negative. There is no denoise — the
//     output is a fresh latent that reads the reference, not a noised copy.
const FX_CLIP = '40';
const FX_VAE = '41';
const FX_GUIDER = '43';
const FX_SAMPLER = '44';
const FX_SIGMAS = '45';
const FX_NOISE = '46';
const SRC_IMAGE = '10';
const SRC_ENCODE = '11';
const SRC_SCALED = '12';
const REF_POS = '13';
const REF_NEG = '14';
const SRC_SIZE = '15';

// A phone photo is 12MP; the model wants ~1MP. Scaled with lanczos (the
// bundled template's nearest-exact aliases a downscale of a real face) and
// snapped to /16 so every latent shape divides cleanly.
const scaledSource = (imageName) => ({
  [SRC_IMAGE]: { class_type: 'LoadImage', inputs: { image: imageName } },
  [SRC_SCALED]: {
    class_type: 'ImageScaleToTotalPixels',
    inputs: { image: [SRC_IMAGE, 0], upscale_method: 'lanczos', megapixels: 1.0, resolution_steps: 16 },
  },
});

// The shared klein spine: loaders, prompt, zeroed negative, the custom sampler
// chain and the decode. `size` is either fixed numbers or GetImageSize edges.
const flux2Spine = (p, { positive, negative, width, height }) => ({
  '4': { class_type: 'UNETLoader', inputs: { unet_name: p.unetName, weight_dtype: 'default' } },
  [FX_CLIP]: { class_type: 'CLIPLoader', inputs: { clip_name: p.clipName, type: p.clipType } },
  [FX_VAE]: { class_type: 'VAELoader', inputs: { vae_name: p.vaeName } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: p.positive, clip: [FX_CLIP, 0] } },
  '7': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['6', 0] } },
  [FX_GUIDER]: { class_type: 'CFGGuider', inputs: { model: ['4', 0], positive, negative, cfg: 1.0 } },
  [FX_SAMPLER]: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
  [FX_SIGMAS]: { class_type: 'Flux2Scheduler', inputs: { steps: p.steps, width, height } },
  [FX_NOISE]: { class_type: 'RandomNoise', inputs: { noise_seed: p.seed } },
  '5': { class_type: 'EmptyFlux2LatentImage', inputs: { width, height, batch_size: 1 } },
  '3': {
    class_type: 'SamplerCustomAdvanced',
    inputs: {
      noise: [FX_NOISE, 0], guider: [FX_GUIDER, 0], sampler: [FX_SAMPLER, 0],
      sigmas: [FX_SIGMAS, 0], latent_image: ['5', 0],
    },
  },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: [FX_VAE, 0] } },
  '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: safePrefix(p.filenamePrefix) } },
});

/**
 * klein text to image.
 * @param {object} p validated scalars: positive, seed, steps, width, height,
 *   filenamePrefix, plus the model's unetName/clipName/clipType/vaeName.
 */
export const buildFlux2 = (p) => flux2Spine(p, {
  positive: ['6', 0], negative: ['7', 0], width: p.width, height: p.height,
});

// Extra reference photos (the same person from other angles) take a band of
// their own, five ids each: load, scale, encode, and the two reference links.
const MORE_REF_BASE = 70;
const MORE_REF_STRIDE = 5;

/**
 * klein edit: every reference photo becomes a reference latent on BOTH
 * conditionings, chained in order — the first is the source, the rest add
 * likeness. With `width`/`height` the output canvas is pinned (a portrait's
 * crop is its contract); without, it follows the scaled first image.
 * @param {object} p as buildFlux2, plus `imageNames` (engine-authoritative,
 *   from /upload/image; first = the source) and optional `width`/`height`.
 */
export const buildFlux2Edit = (p) => {
  const [first, ...more] = p.imageNames;
  const pinned = Number.isFinite(p.width) && Number.isFinite(p.height);
  const width = pinned ? p.width : [SRC_SIZE, 0];
  const height = pinned ? p.height : [SRC_SIZE, 1];
  const nodes = {
    ...scaledSource(first),
    ...(pinned ? {} : { [SRC_SIZE]: { class_type: 'GetImageSize', inputs: { image: [SRC_SCALED, 0] } } }),
    [SRC_ENCODE]: { class_type: 'VAEEncode', inputs: { pixels: [SRC_SCALED, 0], vae: [FX_VAE, 0] } },
    [REF_POS]: { class_type: 'ReferenceLatent', inputs: { conditioning: ['6', 0], latent: [SRC_ENCODE, 0] } },
    [REF_NEG]: { class_type: 'ReferenceLatent', inputs: { conditioning: ['7', 0], latent: [SRC_ENCODE, 0] } },
  };
  let positive = [REF_POS, 0];
  let negative = [REF_NEG, 0];
  more.forEach((imageName, i) => {
    const [load, scale, encode, pos, neg] = Array.from({ length: MORE_REF_STRIDE }, (_, k) => String(MORE_REF_BASE + i * MORE_REF_STRIDE + k));
    nodes[load] = { class_type: 'LoadImage', inputs: { image: imageName } };
    nodes[scale] = {
      class_type: 'ImageScaleToTotalPixels',
      inputs: { image: [load, 0], upscale_method: 'lanczos', megapixels: 1.0, resolution_steps: 16 },
    };
    nodes[encode] = { class_type: 'VAEEncode', inputs: { pixels: [scale, 0], vae: [FX_VAE, 0] } };
    nodes[pos] = { class_type: 'ReferenceLatent', inputs: { conditioning: positive, latent: [encode, 0] } };
    nodes[neg] = { class_type: 'ReferenceLatent', inputs: { conditioning: negative, latent: [encode, 0] } };
    positive = [pos, 0];
    negative = [neg, 0];
  });
  return { ...nodes, ...flux2Spine(p, { positive, negative, width, height }) };
};

// ── THE CONTROLLED Z-IMAGE GRAPH ────────────────────────────────────────────
// Copied from ComfyUI's bundled `image_z_image_turbo_fun_union_controlnet.json`
// (2026-10-13): the union patch is applied to the MODEL by
// QwenImageDiffsynthControlnet (it is a model patch, not a conditioning
// ControlNet), and the AuraFlow shift sits AFTER it. Turbo runs cfg 1 with a
// zeroed negative, res_multistep/simple, 8 steps. The template's Canny
// thresholds (0.1 / 0.32) are kept.
const ZC_PATCH = '47';
const ZC_CANNY = '57';
const ZC_CONTROL = '60';

/**
 * @param {object} p validated scalars: positive, seed, steps, strength,
 *   controlMode ('canny' | 'map'), imageName, filenamePrefix, plus the model's
 *   unetName/clipName/clipType/vaeName/shift and `patchName`.
 */
export const buildZImageControl = (p) => {
  const canny = p.controlMode !== 'map';
  const control = canny ? [ZC_CANNY, 0] : [SRC_SCALED, 0];
  return {
    ...scaledSource(p.imageName),
    ...(canny
      ? { [ZC_CANNY]: { class_type: 'Canny', inputs: { image: [SRC_SCALED, 0], low_threshold: 0.1, high_threshold: 0.32 } } }
      : {}),
    [SRC_SIZE]: { class_type: 'GetImageSize', inputs: { image: control } },
    '4': { class_type: 'UNETLoader', inputs: { unet_name: p.unetName, weight_dtype: 'default' } },
    [ZI_CLIP]: { class_type: 'CLIPLoader', inputs: { clip_name: p.clipName, type: p.clipType } },
    [ZI_VAE]: { class_type: 'VAELoader', inputs: { vae_name: p.vaeName } },
    [ZC_PATCH]: { class_type: 'ModelPatchLoader', inputs: { name: p.patchName } },
    [ZC_CONTROL]: {
      class_type: 'QwenImageDiffsynthControlnet',
      inputs: { model: ['4', 0], model_patch: [ZC_PATCH, 0], vae: [ZI_VAE, 0], image: control, strength: p.strength },
    },
    [ZI_SHIFT]: { class_type: 'ModelSamplingAuraFlow', inputs: { model: [ZC_CONTROL, 0], shift: p.shift } },
    '5': { class_type: 'EmptySD3LatentImage', inputs: { width: [SRC_SIZE, 0], height: [SRC_SIZE, 1], batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: p.positive, clip: [ZI_CLIP, 0] } },
    '7': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['6', 0] } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: [ZI_SHIFT, 0], seed: p.seed, steps: p.steps, cfg: 1.0,
        sampler_name: 'res_multistep', scheduler: 'simple',
        positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], denoise: 1.0,
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: [ZI_VAE, 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: safePrefix(p.filenamePrefix) } },
  };
};
