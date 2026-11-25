/**
 * FLUX 3 Image Klein — the FIFTH family (Design note, 2026-11-20: […]; Metidar had found it and could not install it).
 * Black Forest Labs' open 5.6B model, released 2026-10-15; the engine at the pin (v0.41.0) already carries its model
 * code and the `flux3` text-encoder type (comfy/ldm/flux3, nodes.py CLIPLoader), so no engine move is needed.
 *
 * THE GRAPH is ComfyUI's own bundled `image_flux3_klein_distilled_t2i.json` (comfyui-workflow-templates 0.11.84, the
 * […] subgraph), node for node, read 2026-11-20: UNETLoader + CLIPLoader(type
 * flux3) + an empty-string negative encode + EmptyFlux2LatentImage → KSampler (euler, simple, cfg 1 — the distilled
 * model's) → VAEDecode. Its optional prompt upsampler (a 9B text model) is left out: the being writes the full prompt.
 * Every class is already on the drift gate (templates.js PACK_NODE_CLASSES).
 *
 * THE FILES come from the gated publisher repo, installed by a neuma (intents/forge-install.js): each names where it
 * comes from, so list_pipelines can say exactly which installs a pipeline still waits for. The SHA-256 of each is the
 * publisher's, checked on download (model-install.js) — the repo is gated, so it is read with the house's token then,
 * not pinned here. The VAE is the FLUX.2 family's, already on this machine for klein 4B.
 *
 * LICENCE: the FLUX Kommunity License v1.0 — commercial outputs free under US$5M yearly revenue; it bars unlawful
 * content (child sexual abuse material, non-consensual intimate imagery, others' likeness) and asks for content
 * filtering, which the prompt screen is (prompt-screen.js). Pure.
 */
import { safePrefix } from './templates.js';

const REPO = 'black-forest-labs/flux-3-image-klein-comfy';

export const FLUX3_MODELS = Object.freeze({
  'flux3-klein': Object.freeze({
    id: 'flux3-klein',
    label: 'FLUX 3 Image Klein (distilled, int8)',
    family: 'flux3',
    unetName: 'flux3-image-klein-int8-convrot.safetensors',
    clipName: 'qwen3vl_4b_int8_convrot.safetensors',
    clipType: 'flux3',
    vaeName: 'flux2-vae.safetensors',
    sha256: null, // the publisher's, checked at install (model-install.js) — see above
    bytes: 5827874779,
    files: Object.freeze([
      Object.freeze({ folder: 'diffusion_models', name: 'flux3-image-klein-int8-convrot.safetensors', install: Object.freeze({ repo: REPO, file: 'diffusion_models/flux3-image-klein-int8-convrot.safetensors' }) }),
      Object.freeze({ folder: 'text_encoders', name: 'qwen3vl_4b_int8_convrot.safetensors', install: Object.freeze({ repo: REPO, file: 'text_encoders/qwen3vl_4b_int8_convrot.safetensors' }) }),
      Object.freeze({ folder: 'vae', name: 'flux2-vae.safetensors', install: Object.freeze({ repo: REPO, file: 'vae/flux2-vae.safetensors' }) }),
    ]),
  }),
});

/**
 * The FLUX 3 pipelines, frozen into the one manifest by pack-registry.js (slot vocabularies handed in, one way).
 * @param {object} PROMPT_SLOTS
 * @param {object} SAMPLER_SLOTS
 * @param {object} SIZE_SLOTS
 */
export const buildFlux3Pipelines = (PROMPT_SLOTS, SAMPLER_SLOTS, SIZE_SLOTS) => Object.freeze({
  // Distilled: guidance is the model's (cfg 1) and the negative is an empty encode, so neither is a slot.
  'still.flux3.txt2img': Object.freeze({
    id: 'still.flux3.txt2img',
    kind: 'still',
    label: 'FLUX 3 Image Klein — text to image',
    description: 'The newest FLUX (Black Forest Labs, Oct 2026): sharp, high-adherence stills in 4-16 steps. Reads full sentences — describe the scene, subject, light, lens and mood in prose; it renders text well. No negative prompt: say what you want. Licence: FLUX Kommunity (free for commercial use under US$5M a year; nothing unlawful).',
    template: 'flux3',
    modelId: 'flux3-klein',
    slots: Object.freeze({
      positive: PROMPT_SLOTS.positive,
      ...SIZE_SLOTS,
      seed: SAMPLER_SLOTS.seed,
      steps: Object.freeze({ type: 'int', min: 4, max: 16, default: 15 }),
    }),
  }),
});

/**
 * The FLUX 3 Image Klein text-to-image graph (API format). Pure.
 * @param {{positive: string, seed: number, steps: number, width: number, height: number, filenamePrefix: string,
 *   unetName: string, clipName: string, clipType: string, vaeName: string}} p
 */
export const buildFlux3 = (p) => ({
  '4': { class_type: 'UNETLoader', inputs: { unet_name: p.unetName, weight_dtype: 'default' } },
  '40': { class_type: 'CLIPLoader', inputs: { clip_name: p.clipName, type: p.clipType } },
  '41': { class_type: 'VAELoader', inputs: { vae_name: p.vaeName } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: p.positive, clip: ['40', 0] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['40', 0] } },
  '5': { class_type: 'EmptyFlux2LatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } },
  '3': {
    class_type: 'KSampler',
    inputs: {
      model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      seed: p.seed, steps: p.steps, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
    },
  },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['41', 0] } },
  '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: safePrefix(p.filenamePrefix) } },
});

/** pure — the files a pipeline's model needs, each with the install that brings it ([] when it declares none). */
export const pipelineFiles = (model) => (Array.isArray(model?.files) ? model.files : []);
