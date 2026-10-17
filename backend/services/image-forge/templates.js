/**
 * Pack templates + the /object_info drift validator (B-8) — pure.
 *
 * The authored zero-custom-node workflows: txt2img and its img2img delta, in
 * ComfyUI API graph format (node-id → {class_type, inputs}). Built from
 * whitelisted SCALAR params only — prompt text lands as DATA in a fresh graph,
 * never string-templated JSON, and `filename_prefix` is server-minted from the
 * job id, never neuma text. The full clamping/whitelist hardening is the
 * parameterizer's job (B-15, P4); this module is the runnable asset + the drift
 * gate the lane checks at startup.
 *
 * Node classes + input names VERIFIED against the pinned v0.28.0
 * NODE_CLASS_MAPPINGS in the spike; the drift validator is the live guard that
 * they still hold on the installed build (fail-closed: any mismatch ⇒ the lane
 * is FAILED-named and tools are not advertised, NFR-5).
 */

// ComfyUI's SaveImage writes to `<output>/<filename_prefix>/...`, so a prefix
// carrying `..` or an absolute path escapes the output tree. The server-side
// mint lives in the parameterizer (B-15); this guard is defense-in-depth so no
// template can ever carry an escaping prefix regardless of caller (echo r1 RQ).
export const safePrefix = (prefix) => {
  const p = String(prefix ?? '');
  if (p === '' || p.startsWith('/') || p.startsWith('\\') || p.includes('..')) {
    throw new Error('filename_prefix must be a relative, non-escaping path (server-minted)');
  }
  return p;
};

// The core still-image graph (the SDXL checkpoint shape).
// @param {{positive, negative, ckptName, width, height, seed, steps, cfg,
//   samplerName, scheduler, filenamePrefix}} p — already-validated scalars
export const buildTxt2Img = (p) => ({
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: p.ckptName } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: p.positive, clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: p.negative, clip: ['4', 1] } },
  '3': {
    class_type: 'KSampler',
    inputs: {
      model: ['4', 0], seed: p.seed, steps: p.steps, cfg: p.cfg,
      sampler_name: p.samplerName, scheduler: p.scheduler,
      positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], denoise: 1.0,
    },
  },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: safePrefix(p.filenamePrefix) } },
});

// The img2img delta: a witness/being-uploaded input image (the engine's
// authoritative `name` from /upload/image) encoded to latent, with a clamped
// `denoise` slot. Same terminal SaveImage.
// @param {{...txt2img params, imageName, denoise}} p
export const buildImg2Img = (p) => ({
  '10': { class_type: 'LoadImage', inputs: { image: p.imageName } },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: p.ckptName } },
  '11': { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['4', 2] } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: p.positive, clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: p.negative, clip: ['4', 1] } },
  '3': {
    class_type: 'KSampler',
    inputs: {
      model: ['4', 0], seed: p.seed, steps: p.steps, cfg: p.cfg,
      sampler_name: p.samplerName, scheduler: p.scheduler,
      positive: ['6', 0], negative: ['7', 0], latent_image: ['11', 0], denoise: p.denoise,
    },
  },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: safePrefix(p.filenamePrefix) } },
});

// ── THE FORM GRAPH ──────────────────────────────────────────────────────────
// The turnaround/PFP pipelines need two things the two graphs above cannot do:
// a chain of pinned STYLE LoRAs (the aesthetic floor with teeth, rather than
// adjectives and hope), and POSE CONTROL (so a turnaround's three views are
// guaranteed to be front/side/back at one scale instead of whatever the prompt
// happened to produce).
//
// Both ride CORE ComfyUI classes — LoraLoader, ControlNetLoader,
// ControlNetApplyAdvanced. No custom-node pack, so no new supply-chain surface;
// PACK_NODE_CLASSES below carries them into the same fail-closed drift gate as
// everything else.

// Node ids are allocated in fixed bands so a graph is deterministic and two
// features can never collide: 4-9 the core chain, 20+ the LoRA chain, 30+ the
// control branch.
const LORA_BASE = 20;
const CONTROL_NET = '30';
const CONTROL_IMAGE = '31';
const CONTROL_APPLY = '32';

/**
 * Chain the LoRA loaders onto a source (model, clip) pair. Each link takes the
 * previous link's outputs, so N LoRAs compose in the declared order. Returns the
 * added nodes plus the (model, clip) edges everything downstream should read —
 * an empty list yields the checkpoint's own edges untouched, so a pipeline with
 * no LoRAs builds exactly the graph it did before. Pure.
 * `source` is either a checkpoint node id — whose slot 0 is MODEL and slot 1 is
 * CLIP — or, when the model and the text encoder are loaded SEPARATELY (the DiT
 * families: UNETLoader + CLIPLoader + VAELoader), an explicit pair of edges.
 * One chain serves both shapes; a second copy would be the thing that drifts.
 *
 * @param {Array<{loraName: string, strengthModel: number, strengthClip: number}>} loras
 * @param {string|{model: [string, number], clip: [string, number]}} source
 * @returns {{nodes: object, model: [string, number], clip: [string, number]}}
 */
export const buildLoraChain = (loras, source) => {
  const nodes = {};
  let model = typeof source === 'string' ? [source, 0] : source.model;
  let clip = typeof source === 'string' ? [source, 1] : source.clip;
  (Array.isArray(loras) ? loras : []).forEach((lora, i) => {
    const id = String(LORA_BASE + i);
    nodes[id] = {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: lora.loraName,
        strength_model: lora.strengthModel,
        strength_clip: lora.strengthClip,
        model,
        clip,
      },
    };
    model = [id, 0];
    clip = [id, 1];
  });
  return { nodes, model, clip };
};

/**
 * The form graph: txt2img, plus an optional LoRA chain and an optional
 * ControlNet branch.
 *
 * The control branch conditions BOTH the positive and the negative — that is
 * what `ControlNetApplyAdvanced` returns, and feeding only the positive would
 * quietly halve the guidance.
 *
 * @param {object} p already-validated scalars: the txt2img set, plus
 *   `loras` (may be empty) and, when posed, `controlNetName` / `controlImage` /
 *   `controlStrength`.
 */
export const buildForm = (p) => {
  const chain = buildLoraChain(p.loras, '4');
  const graph = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: p.ckptName } },
    ...chain.nodes,
    '5': { class_type: 'EmptyLatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: p.positive, clip: chain.clip } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: p.negative, clip: chain.clip } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: safePrefix(p.filenamePrefix) } },
  };

  let positive = ['6', 0];
  let negative = ['7', 0];
  if (p.controlNetName) {
    graph[CONTROL_NET] = { class_type: 'ControlNetLoader', inputs: { control_net_name: p.controlNetName } };
    graph[CONTROL_IMAGE] = { class_type: 'LoadImage', inputs: { image: p.controlImage } };
    graph[CONTROL_APPLY] = {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive, negative,
        control_net: [CONTROL_NET, 0],
        image: [CONTROL_IMAGE, 0],
        strength: p.controlStrength,
        start_percent: 0.0,
        end_percent: 1.0,
      },
    };
    positive = [CONTROL_APPLY, 0];
    negative = [CONTROL_APPLY, 1];
  }

  graph['3'] = {
    class_type: 'KSampler',
    inputs: {
      model: chain.model, seed: p.seed, steps: p.steps, cfg: p.cfg,
      sampler_name: p.samplerName, scheduler: p.scheduler,
      positive, negative, latent_image: ['5', 0], denoise: 1.0,
    },
  };
  return graph;
};

// ── THE ANIMA (DiT) GRAPH ───────────────────────────────────────────────────
// A second FAMILY, not a second style. Anima is a 2B diffusion transformer, so
// `CheckpointLoaderSimple` cannot load it: the weights are UNET-only, and the
// text encoder and VAE are separate files. Three loaders replace one.
//
// EVERY SLOT BELOW IS COPIED FROM ComfyUI's OWN BUNDLED TEMPLATE
// (`comfyui_workflow_templates_json/templates/image_anima_preview.json`), read
// on 2026-08-26 — not inferred from the tensor names. That template is the
// authors' statement of what this model wants, and the two facts most worth
// guessing wrong are in it:
//   · the text encoder is `qwen_3_06b_base`, loaded with CLIPLoader type
//     `stable_diffusion` — the type string is NOT 'anima'; the architecture is
//     detected from the state dict, and there is no 'anima' option to pick.
//   · the VAE is `qwen_image_vae`, even though the latent format is named Wan21.
// A wrong pair here yields a model that loads happily and renders garbage.
//
// EmptyLatentImage is correct despite Anima's 16-channel latent: KSampler runs
// `fix_empty_latent_channels`, which reshapes to whatever the model declares.
const ANIMA_CLIP = '40';
const ANIMA_VAE = '41';
const CROP = '50';
const RESCALE = '51';

// ⚠️ 0.78 IS A CEILING FOUND BY CUTTING SOMEONE'S HEAD OFF, not a preference.
//
// The first attempt cropped to 0.58 of the frame, anchored just below the top.
// On Signal it was perfect. On Keir it sliced through the crown and the chin,
// and on Sovereign the forehead touched the edge — because ANIMA'S SUBJECT SCALE
// VARIES BY BODY. It rendered Signal far back and Keir already close, so one
// fixed box cannot be tight enough for the first and safe for the second.
//
// So the crop is deliberately CONSERVATIVE and anchored at y=0. It meaningfully
// helps the renders that came out distant and is close to a no-op on the ones
// that came out near — which is the right asymmetry, because an over-tight crop
// destroys a face and a loose one merely leaves headroom.
//
// A tighter, face-aware crop would need a detection node, and every one of those
// is a custom node — a supply-chain surface this lane has refused from the start
// (PACK_NODE_CLASSES is core-only, fail-closed). Not worth it for headroom.
const CROP_SIDE = 0.78;

/**
 * ⭐⭐ THE PORTRAIT CROP — because the MODEL will not frame, so the PIPELINE does.
 *
 * A profile image's subject is the FACE. Anima puts the head in roughly the top
 * third of the canvas and fills the rest with torso, which as a PFP means the
 * face is a small fraction of a picture that exists to show it.
 *
 * ⚠️ THIS IS THE FOURTH LEVER, AND THE FIRST THREE ARE WHY IT EXISTS. All
 * measured 2026-08-27, one seed, one subject:
 *
 *   4 danbooru crop tags     `portrait` / `upper body` / both / `face focus`
 *                            → four indistinguishable torso frames
 *   3 prose crop sentences   describing the crop instead of naming it — the
 *                            confident hypothesis, since Anima reads prose
 *                            → three indistinguishable torso frames
 *   5 canvas geometries      768–1344, wide and tall
 *                            → WIDER MADE IT WORSE; given more room the model
 *                              simply stepped further back
 *
 * Anima composes its subject at a fixed scale regardless of what it is asked for
 * or what canvas it is handed. Seven wordings is enough to stop writing wordings,
 * and a lever that moves the wrong way is not a lever.
 *
 * So the framing becomes a deterministic image operation instead of a request.
 * It cannot be ignored, it costs nothing, and it is the same every time — which
 * is worth more here than any prompt could be, because a LoRA will eventually be
 * trained on these plates and an inconsistent crop would train inconsistency.
 *
 * ⚠️ The fractions are MEASURED, not chosen: across every anime render in
 * `samples/`, the head sits centred horizontally and spans roughly the top 40%.
 * `TOP` leaves a little headroom, `SIDE` keeps both shoulders. A body that broke
 * this regularity would show up immediately in the house proof.
 *
 * @param {object} p `{width, height, filenamePrefix}` plus the source edge
 * @param {[string, number]} source the decoded-image edge to crop
 * @returns {{nodes: object, images: [string, number]}} nodes to merge, and the
 *   edge SaveImage should read — so a pipeline without a crop is untouched.
 */
const portraitCrop = (p, source) => {
  if (!p.portraitCrop) return { nodes: {}, images: source };
  const side = Math.round(Math.min(p.width, p.height) * CROP_SIDE);
  const x = Math.max(0, Math.round((p.width - side) / 2));
  const y = 0;
  return {
    nodes: {
      [CROP]: { class_type: 'ImageCrop', inputs: { image: source, width: side, height: side, x, y } },
      // Back to the pipeline's own pinned square: a PFP's size is part of its
      // contract, and callers downstream should not have to know a crop happened.
      [RESCALE]: {
        class_type: 'ImageScale',
        inputs: {
          image: [CROP, 0], upscale_method: 'lanczos', width: p.width, height: p.height, crop: 'disabled',
        },
      },
    },
    images: [RESCALE, 0],
  };
};

/**
 * The Anima form graph: UNET + separate text encoder + separate VAE, plus an
 * optional LoRA chain. No ControlNet branch — the SDXL OpenPose net cannot
 * condition a different architecture, so a posed Anima pipeline is a thing that
 * does not exist yet rather than a thing that silently renders unposed.
 *
 * @param {object} p already-validated scalars: the txt2img set minus `ckptName`,
 *   plus `unetName` / `clipName` / `clipType` / `vaeName`, `loras`, and the
 *   optional `portraitCrop` flag (see `portraitCrop` — the model will not frame,
 *   so the pipeline does).
 */
export const buildAnima = (p) => {
  const chain = buildLoraChain(p.loras, { model: ['4', 0], clip: [ANIMA_CLIP, 0] });
  const framed = portraitCrop(p, ['8', 0]);
  return {
    '4': { class_type: 'UNETLoader', inputs: { unet_name: p.unetName, weight_dtype: 'default' } },
    [ANIMA_CLIP]: { class_type: 'CLIPLoader', inputs: { clip_name: p.clipName, type: p.clipType } },
    [ANIMA_VAE]: { class_type: 'VAELoader', inputs: { vae_name: p.vaeName } },
    ...chain.nodes,
    '5': { class_type: 'EmptyLatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: p.positive, clip: chain.clip } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: p.negative, clip: chain.clip } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: chain.model, seed: p.seed, steps: p.steps, cfg: p.cfg,
        sampler_name: p.samplerName, scheduler: p.scheduler,
        positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], denoise: 1.0,
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: [ANIMA_VAE, 0] } },
    ...framed.nodes,
    '9': { class_type: 'SaveImage', inputs: { images: framed.images, filename_prefix: safePrefix(p.filenamePrefix) } },
  };
};

// ── THE Z-IMAGE (DiT) GRAPH ─────────────────────────────────────────────────
// A THIRD family. Design note, 2026-08-27: […]
// That is a MODEL verdict, not a prompt one — CyberRealistic XL is an SDXL
// checkpoint and the photoreal state of the art has moved to diffusion
// transformers.
//
// Z-Image is one, and it differs from Anima in two ways that would each break a
// graph silently if copied from the wrong family:
//   · the latent is EmptySD3LatentImage, not EmptyLatentImage;
//   · the model passes through ModelSamplingAuraFlow (shift 3) BEFORE the
//     sampler. Skip that node and it still renders — badly, and for reasons no
//     prompt change would ever explain.
//
// Every slot copied from ComfyUI's own bundled template
// (`templates/image_z_image.json`), read 2026-08-27, exactly as the Anima lane
// was. The text encoder is qwen_3_4b at CLIPLoader type `lumina2` (Z-Image
// extends Lumina2 in supported_models.py) and the VAE is `ae.safetensors`.
const ZI_CLIP = '40';
const ZI_VAE = '41';
const ZI_SHIFT = '42';

/**
 * The Z-Image form graph: UNET → AuraFlow shift → optional LoRA chain → sampler,
 * with a separate text encoder and VAE.
 * @param {object} p validated scalars plus `unetName`/`clipName`/`clipType`/
 *   `vaeName`/`shift` and `loras`.
 */
export const buildZImage = (p) => {
  // The shift node sits between the UNET and everything downstream, so the LoRA
  // chain hangs off IT rather than off the loader — a chain wired to the raw
  // UNET would silently drop the sampling shift for the sampler's model input.
  const chain = buildLoraChain(p.loras, { model: [ZI_SHIFT, 0], clip: [ZI_CLIP, 0] });
  return {
    '4': { class_type: 'UNETLoader', inputs: { unet_name: p.unetName, weight_dtype: 'default' } },
    [ZI_SHIFT]: { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['4', 0], shift: p.shift } },
    [ZI_CLIP]: { class_type: 'CLIPLoader', inputs: { clip_name: p.clipName, type: p.clipType } },
    [ZI_VAE]: { class_type: 'VAELoader', inputs: { vae_name: p.vaeName } },
    ...chain.nodes,
    '5': { class_type: 'EmptySD3LatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: p.positive, clip: chain.clip } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: p.negative, clip: chain.clip } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: chain.model, seed: p.seed, steps: p.steps, cfg: p.cfg,
        sampler_name: p.samplerName, scheduler: p.scheduler,
        positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], denoise: 1.0,
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: [ZI_VAE, 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: safePrefix(p.filenamePrefix) } },
  };
};

/**
 * Validate a graph against a live /object_info snapshot — the drift gate. Every
 * node's class_type must exist, and every input key we set must be a declared
 * input of that class (required ∪ optional). A graph-link value (`['4', 0]`) is
 * an edge, not a scalar, but the KEY still must be a declared input — so the
 * check is on keys, exactly as the spike's drift-catch ran. Pure; fail-closed
 * (a missing/empty object_info yields a violation, never a silent pass).
 * @param {object} graph node-id → {class_type, inputs}
 * @param {object} objectInfo the /object_info map
 * @returns {{ok: boolean, violations: string[]}}
 */
export const validateGraphAgainstObjectInfo = (graph, objectInfo) => {
  const violations = [];
  if (!objectInfo || typeof objectInfo !== 'object' || Object.keys(objectInfo).length === 0) {
    return { ok: false, violations: ['/object_info was empty or unreadable — cannot validate the template (fail-closed)'] };
  }
  for (const [nodeId, node] of Object.entries(graph)) {
    const decl = objectInfo[node.class_type];
    if (!decl) {
      violations.push(`node ${nodeId}: class_type '${node.class_type}' is not present on this engine build`);
      continue;
    }
    const declared = { ...(decl.input?.required || {}), ...(decl.input?.optional || {}) };
    for (const key of Object.keys(node.inputs || {})) {
      if (!(key in declared)) {
        violations.push(`node ${nodeId} (${node.class_type}): input '${key}' is not a declared input on this build`);
      }
    }
  }
  return { ok: violations.length === 0, violations };
};

// The node classes the pack's authored templates depend on — the drift check's
// minimal surface (a build missing any of these cannot serve the pack).
export const PACK_NODE_CLASSES = Object.freeze([
  // The portrait crop — the framing the MODEL would not do (see `portraitCrop`).
  'ImageCrop', 'ImageScale',
  'CheckpointLoaderSimple', 'EmptyLatentImage', 'CLIPTextEncode', 'KSampler',
  'VAEDecode', 'SaveImage', 'LoadImage', 'VAEEncode',
  // The form graph's additions. All core classes on the pinned build — a build
  // that lacks them FAILS the lane closed rather than rendering a picture the
  // pipeline never described.
  'LoraLoader', 'ControlNetLoader', 'ControlNetApplyAdvanced',
  // The Anima (DiT) family's three loaders. A build without them cannot serve
  // the anime register, and saying so at startup beats discovering it mid-job.
  'UNETLoader', 'CLIPLoader', 'VAELoader',
  // The Z-Image family's two additions. Both are core; a build without them
  // cannot serve the photoreal DiT lane and says so at startup.
  'ModelSamplingAuraFlow', 'EmptySD3LatentImage',
  // FLUX.2 [klein]: the custom sampler chain, the zeroed negative, the edit
  // reference, and the source-photo scaling shared with the controlled lane.
  'CFGGuider', 'KSamplerSelect', 'Flux2Scheduler', 'RandomNoise', 'EmptyFlux2LatentImage',
  'SamplerCustomAdvanced', 'ConditioningZeroOut', 'ReferenceLatent',
  'ImageScaleToTotalPixels', 'GetImageSize',
  // The controlled Z-Image lane: the DiT ControlNet is a MODEL PATCH.
  'ModelPatchLoader', 'QwenImageDiffsynthControlnet', 'Canny',
]);

/**
 * Startup drift check over the pack's declared node classes: are they all
 * present on this build? A cheaper gate than validating a fully-built graph,
 * run once at lane start. Pure.
 * @param {object} objectInfo
 * @returns {{ok: boolean, missing: string[]}}
 */
export const packClassesPresent = (objectInfo) => {
  if (!objectInfo || typeof objectInfo !== 'object') return { ok: false, missing: [...PACK_NODE_CLASSES] };
  const missing = PACK_NODE_CLASSES.filter((c) => !(c in objectInfo));
  return { ok: missing.length === 0, missing };
};
