/**
 * The pack registry (B-14) — the named pipelines a model may call, and nothing
 * else. Pure.
 *
 * THE UNIT OF CAPABILITY IS THE NAMED PIPELINE. Design note, 2026-07-29: image
 * generation is […] A caller
 * names a pipeline id and supplies scalars; it never hands the engine a graph
 * on this path. That keeps the surface identical for a bound neuma, a sealed
 * witness, and any model that comes later — none of them needs to know ComfyUI
 * exists.
 *
 * FAIL-CLOSED BY CONSTRUCTION: the manifest is THIS FROZEN MODULE, not a file
 * on disk. An unknown pipeline id resolves to a refusal without ever touching
 * the filesystem, so no dropped file and no writable path can widen what is
 * callable. The operator-whitelisted custom-node packs Founder chose (2026-07-29)
 * enter here as new PIPELINE entries pinned by hash — never as a directory the
 * lane scans.
 *
 * Every entry declares its own SLOT WHITELIST. The parameterizer (B-15) clamps
 * against these declarations; a slot absent from `slots` is not a tunable knob,
 * it is an unknown argument and is refused.
 */
import { buildFormPipelines } from './form-registry.js';
import { buildFlux2Pipelines } from './pipelines-flux2.js';

/** The engine build this pack is authored against (spike-verified, pinned). */
export const ENGINE_PIN = Object.freeze({
  repo: 'Comfy-Org/ComfyUI',
  tag: 'v0.28.0',
  sha: '700821e1364eaab0e8f21c538a2131719fec57bf',
});

/**
 * The models the pack may name. `mounts !== visibility` (FR-36): a checkpoint
 * on disk is callable only if it is listed HERE. `sha256` is the supply-chain
 * anchor — a swapped checkpoint under a known filename is a real attack, and a
 * null hash means "not yet attested", never "trusted".
 *
 * These hashes were MEASURED on this machine (`sha256sum`, 2026-07-29) against
 * the files the pinned engine actually loads. They are a tripwire for local
 * drift — a checkpoint silently replaced under a known filename — and are NOT
 * a publisher attestation: nothing here has been checked against an upstream
 * signature, and that check is a separate act.
 */
export const PACK_MODELS = Object.freeze({
  'sdxl-base-1.0': Object.freeze({
    id: 'sdxl-base-1.0',
    label: 'SDXL Base 1.0',
    ckptName: 'sd_xl_base_1.0.safetensors',
    sha256: '31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b',
    bytes: 6938078334,
  }),
  'illustrious-xl-2.0': Object.freeze({
    id: 'illustrious-xl-2.0',
    label: 'Illustrious-XL v2.0',
    ckptName: 'Illustrious-XL-v2.0.safetensors',
    sha256: 'c2a1a3eaa13d4c107dc7e00c3fe830cab427aa026362740ea094745b3422a331',
    bytes: 6938040674,
  }),
  'cyberrealistic-xl-1.0': Object.freeze({
    id: 'cyberrealistic-xl-1.0',
    label: 'CyberRealistic XL v1.0',
    ckptName: 'cyberrealisticXL_v100.safetensors',
    sha256: '2906dc3e0eca2b78e2f7d0347fbe4ae9b8d7022945e8213d1694273857ceb80a',
    bytes: 13875718752,
  }),
  // Design note, 2026-08-26, after looking at the A/B: […] It is not a better cyberrealistic — it is a THIRD register,
  // stylized/illustrated realism, and it beat Illustrious on the very thing the
  // anime lane exists for. Measured `sha256sum` 2026-08-26.
  // ⚠️ NO LONGER THE ILLUSTRATIVE LANE, and the reason is a GENOME MISS rather
  // than taste. Signal's given body says `rich brown skin`; perfectDeliberate
  // renders a fair-skinned woman, and has since the coloring axis existed. The
  // clause was moved to the HEAD of the prompt to fix it and that did not work.
  //
  // Measured 2026-08-27, `ab-checkpoint-probe`, same subject, same seed, same
  // scaffold, one variable: EVERY Illustrious-family checkpoint on disk renders
  // the complexion correctly and this one does not. Five renders, consistent.
  // The genome is not being ignored — this checkpoint's prior overrides it, and
  // a body a model refuses to render is not that being's body.
  //
  // Kept registered: it is a real register (stylized/illustrated realism), it is
  // attested, and it is the incumbent every future A/B is judged against.
  'perfectdeliberate-v10': Object.freeze({
    id: 'perfectdeliberate-v10',
    label: 'perfectDeliberate v10',
    ckptName: 'perfectdeliberate_v10.safetensors',
    sha256: 'cbba6875a194e16a0f9e7a812289221fb437d0ebdddf0d99a6876fd0e903ad8e',
    bytes: 7105347928,
  }),
  // Design note, 2026-08-27, after the A/B: the illustrative register. It renders every
  // coloring trait the incumbent dropped, and gives a distinct face with clean
  // linework rather than the same glossy beauty every seed. Soft-shaded and
  // painterly, so it stays clearly apart from the Anima lane's flat cel look —
  // the two registers have to be different from EACH OTHER now that they are the
  // only two. Measured `sha256sum` 2026-08-27.
  'hale-anime-xl-1.9': Object.freeze({
    id: 'hale-anime-xl-1.9',
    label: 'HaleAnimeXL IL v1.9',
    ckptName: 'haleAnimeXL_ilV190.safetensors',
    sha256: 'fa486caafc330f133605d3c18b418d183812f14946631c6544bfb28730db6d6f',
    bytes: 6939105596,
  }),
  // ⛔ `flux1-schnell-fp8` RETIRED — Design note, 2026-10-13: […]. FLUX.2 [klein] 4B (below) replaces it: same distilled 4-step speed,
  // a prose text encoder, image editing in the same weights, and Apache 2.0.
  // ── A SECOND FAMILY ───────────────────────────────────────────────────────
  // `family` says which LOADER SHAPE a model needs, and it is the difference
  // between a picture and a crash. Everything above is `sdxl`: one file, one
  // CheckpointLoaderSimple, model+clip+vae out of one node. Anima is a 2B
  // diffusion transformer whose weights are UNET-only, so it names THREE files
  // and rides a different template.
  //
  // This is the field that lets a popular model become a registry entry rather
  // than a special case (Design note, 2026-08-26: […]). HiDream and FLUX-dev, both already on the
  // operator's disk, are the same shape.
  //
  // The encoder/VAE pairing is NOT inferred — it is copied from ComfyUI's own
  // bundled Anima template. See templates.js `buildAnima`.
  'anima-aesthetic-v11': Object.freeze({
    id: 'anima-aesthetic-v11',
    label: 'Anima Aesthetic v1.1',
    family: 'anima',
    unetName: 'anima_aestheticV11.safetensors',
    clipName: 'qwen_3_06b_base.safetensors',
    clipType: 'stable_diffusion',
    vaeName: 'qwen_image_vae.safetensors',
    sha256: '3c1868387a3a1ff504bbb87c33678321965ead381fcf87afbd0264daa600c082',
    bytes: 4182230656,
    // The two companion files carry their own measured hashes: a swapped text
    // encoder is exactly as much of an attack as a swapped checkpoint, and it
    // would show up as […] rather than as an error.
    companions: Object.freeze({
      clip: Object.freeze({ sha256: 'cd2a512003e2f9f3cd3c32a9c3573f820bb28c940f73c57b1ddaa983d9223eba', bytes: 1192135096 }),
      vae: Object.freeze({ sha256: 'a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f', bytes: 253806246 }),
    }),
  }),
  // ── A THIRD FAMILY, AND THE PHOTOREAL LANE'S NEW HOME ──────────────────────
  // Design note, 2026-08-27: […] That was a
  // MODEL verdict, and the probe agreed on every adherence axis that matters to
  // a genome: CyberRealistic XL rendered Signal's `rich brown skin` as tan, put
  // her in a tank top with bare shoulders despite the named garment, and read
  // mid-thirties; Z-Image rendered the complexion, the chestnut bob, the grey
  // eyes, the dark crew-neck and the clean plate, at the age asked for.
  //
  // `moodyProMix_zitV12DPO` — a photoreal Z-Image finetune, also on disk — was
  // probed in the same seat and LOST to the base: it put studio softboxes in
  // frame (the plate is load-bearing for a PFP), reverted to the tank top, and
  // aged the subject two decades. Attested and left unregistered on purpose.
  //
  // Same loader shape as Anima plus ModelSamplingAuraFlow; `shift` travels with
  // the model because it is a property of THIS architecture, not a house knob.
  // Measured `sha256sum` 2026-08-27.
  'z-image-bf16': Object.freeze({
    id: 'z-image-bf16',
    label: 'Z-Image (bf16)',
    family: 'zimage',
    unetName: 'z_image_bf16.safetensors',
    clipName: 'qwen_3_4b.safetensors',
    clipType: 'lumina2',
    vaeName: 'ae.safetensors',
    shift: 3,
    sha256: '996a67d3ff666946b1c25cbc16d1b1918b6cc0ac166309e23fe3b3d830263dee',
    bytes: 12309866400,
    companions: Object.freeze({
      clip: Object.freeze({ sha256: '6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a', bytes: 8044982048 }),
      vae: Object.freeze({ sha256: 'afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38', bytes: 335304388 }),
    }),
  }),
  // Z-Image TURBO — the 8-step distillation of the model above, and the base
  // the Fun ControlNet Union patch was trained against. Same three files but
  // the UNET. Measured `sha256sum` 2026-10-13.
  'z-image-turbo-bf16': Object.freeze({
    id: 'z-image-turbo-bf16',
    label: 'Z-Image Turbo (bf16)',
    family: 'zimage',
    unetName: 'z_image_turbo_bf16.safetensors',
    clipName: 'qwen_3_4b.safetensors',
    clipType: 'lumina2',
    vaeName: 'ae.safetensors',
    shift: 3,
    sha256: '2407613050b809ffdff18a4ac99af83ea6b95443ecebdf80e064a79c825574a6',
    bytes: 12309866400,
    companions: Object.freeze({
      clip: Object.freeze({ sha256: '6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a', bytes: 8044982048 }),
      vae: Object.freeze({ sha256: 'afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38', bytes: 335304388 }),
    }),
  }),
  // ── FLUX.2 [klein] 4B — the FOURTH family ───────────────────────────────────
  // Design note, 2026-10-13: newest FLUX, licence-clean for the release. FLUX 3's open
  // image weights are not out; FLUX.2 [dev] 32B is non-commercial (the reason
  // FLUX.1-dev was excluded in July), so klein 4B is the one that ships.
  //
  // A prose-encoder DiT — the architecture form-registry.js names as the one
  // with a chance at faces after every SDXL photoreal attempt failed. The text
  // encoder is the SAME qwen_3_4b file Z-Image uses (same hash), loaded at
  // CLIPLoader type `flux2`; the VAE is the FLUX.2 family VAE. All copied from
  // ComfyUI's bundled `image_flux2_klein_*` templates, 2026-10-13.
  //
  // The UNET hash is the PUBLISHER'S (black-forest-labs/FLUX.2-klein-4B LFS
  // oid), matched by `sha256sum` on download. The VAE hash matches the
  // Comfy-Org/flux2-dev repack's LFS oid.
  'flux2-klein-4b': Object.freeze({
    id: 'flux2-klein-4b',
    label: 'FLUX.2 [klein] 4B',
    family: 'flux2',
    unetName: 'flux-2-klein-4b.safetensors',
    clipName: 'qwen_3_4b.safetensors',
    clipType: 'flux2',
    vaeName: 'flux2-vae.safetensors',
    sha256: 'ec3d4e733a771f61c052fb4856c48b336c55eaf2c65487c2a1faeb9bbda7a343',
    bytes: 7751105712,
    companions: Object.freeze({
      clip: Object.freeze({ sha256: '6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a', bytes: 8044982048 }),
      vae: Object.freeze({ sha256: 'd64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5', bytes: 336213556 }),
    }),
  }),
});

/**
 * The STYLE LoRAs a pipeline may stack, and the ControlNets it may apply. Same
 * law as PACK_MODELS: on disk is not callable — listed here is. Hashes MEASURED
 * on this machine (`sha256sum`, 2026-08-26); a tripwire for local drift, not a
 * publisher attestation.
 *
 * These are STYLE LoRAs — the house aesthetic floor. Loading one is nothing like
 * training a CHARACTER LoRA on a being's locked look, which is a later act and a
 * different artifact entirely.
 */
export const PACK_LORAS = Object.freeze({
  'ill-dark-lines-v2': Object.freeze({
    id: 'ill-dark-lines-v2',
    label: 'iLLMyth Dark Lines v2',
    loraName: 'iLLMythD4rkL1nesV2.safetensors',
    sha256: '13d59804266ceb4fdece3a7bb0c7799c41b355e2b53aa52d5e1cd5bddc4b2d0c',
    bytes: 228465884,
  }),
  'ill-micro-details-v6': Object.freeze({
    id: 'ill-micro-details-v6',
    label: 'AddMicroDetails Illustrious v6',
    loraName: 'AddMicroDetails_Illustrious_v6.safetensors',
    sha256: 'ce12af9c5e510a745618f76f1197c5776cd283e5dddd707fc0371afd940b4454',
    bytes: 228470756,
  }),
  'ill-detail-slider': Object.freeze({
    id: 'ill-detail-slider',
    label: 'StS Illustrious Detail Slider v1.0',
    loraName: 'StS-Illustrious-Detail-Slider-v1.0.safetensors',
    sha256: '2e7a68ec7e2eba5a07881e885e072213bbb1b03cbf881d852f0f85623ad99349',
    bytes: 8789076,
  }),
  // Trained ON Anima (`ss_base_model_version: "anima"` in its own metadata), so
  // it is NOT interchangeable with the three above: DiT key grammar
  // (`lora_unet_blocks_N_adaln_modulation_*`) against SDXL UNet key grammar. Its
  // training captions are danbooru tags, which is part of why the anime lane
  // prompts in tags rather than prose.
  'anima-myth-dark-lines': Object.freeze({
    id: 'anima-myth-dark-lines',
    label: 'Anima Myth Dark Lines',
    loraName: 'AnimaMythD4rkL1nes.safetensors',
    sha256: '6bb38dea8a09fe58d24db215b15b32e98071b77672ad33f4c4008383c2a0cf55',
    bytes: 69460624,
  }),
});

export const PACK_CONTROLNETS = Object.freeze({
  'openpose-sdxl': Object.freeze({
    id: 'openpose-sdxl',
    label: 'xinsir OpenPose SDXL',
    controlNetName: 'xinsir_controlnet_openpose_sdxl.safetensors',
    sha256: 'b8524e557a7df60d081f5d4a0eb109967d107df217943bf88c2d99b9ebcc06c5',
    bytes: 2502139104,
  }),
});

/**
 * MODEL PATCHES — the DiT-era ControlNet. Not a `controlnet/` file: loaded by
 * core `ModelPatchLoader` from `model_patches/` and applied by core
 * `QwenImageDiffsynthControlnet`, exactly as ComfyUI's bundled
 * `image_z_image_turbo_fun_union_controlnet.json` wires it (2026-10-13).
 * One patch, many conditions (canny, HED, depth, pose, MLSD) — the union reads
 * whichever map it is handed. Apache 2.0; hash = the publisher's LFS oid
 * (alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union), matched on download.
 */
export const PACK_MODEL_PATCHES = Object.freeze({
  'zimage-turbo-fun-union': Object.freeze({
    id: 'zimage-turbo-fun-union',
    label: 'Z-Image Turbo Fun ControlNet Union',
    patchName: 'Z-Image-Turbo-Fun-Controlnet-Union.safetensors',
    sha256: '86c085c0d7853f12ce5183499934b54d08371c60f549c5a6b20615cd23989388',
    bytes: 3101572408,
  }),
});

// The HOUSE AESTHETIC FLOOR and the three registers now live in
// `form-registry.js` — this module stayed the manifest and the resolvers.

// Slot declarations shared by the still pipelines. `enum` slots accept only a
// listed value; `int`/`float` slots clamp into [min,max] rather than refusing,
// so an over-eager caller gets a picture instead of an error — but an UNKNOWN
// slot name is always a refusal (an unknown knob means the caller believes
// something false about the pipeline).
const PROMPT_SLOTS = Object.freeze({
  // `polarity` is what the screen needs to read a slot's MEANING: a negative
  // prompt excludes a concept, so prohibited terms there are protective, not
  // requests (see screenSlots).
  positive: Object.freeze({ type: 'text', required: true, screened: true, polarity: 'positive' }),
  negative: Object.freeze({ type: 'text', required: false, screened: true, polarity: 'negative', default: '' }),
});

const SIZE_SLOTS = Object.freeze({
  width: Object.freeze({ type: 'enum', values: Object.freeze([512, 768, 832, 896, 1024, 1152, 1216, 1344]), default: 1024 }),
  height: Object.freeze({ type: 'enum', values: Object.freeze([512, 768, 832, 896, 1024, 1152, 1216, 1344]), default: 1024 }),
});

const SAMPLER_SLOTS = Object.freeze({
  seed: Object.freeze({ type: 'int', min: 0, max: 4294967295, default: null }), // null ⇒ server-minted
  // `er_sde` and `beta` were added for the Anima lane (its author's default is
  // er_sde/simple), but both are core samplers on the pinned build and are open
  // to every pipeline — a vocabulary, not a per-family gate.
  // `res_multistep` joins them for the Z-Image lane (ComfyUI's own bundled
  // template names it), and is likewise open to every pipeline.
  samplerName: Object.freeze({ type: 'enum', values: Object.freeze(['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_2m_sde_gpu', 'ddim', 'er_sde', 'res_multistep']), default: 'euler' }),
  scheduler: Object.freeze({ type: 'enum', values: Object.freeze(['normal', 'karras', 'simple', 'sgm_uniform', 'beta']), default: 'normal' }),
});

/**
 * THE PIPELINES. Adding one is a reviewed act: it names its template, its
 * model, and every slot a caller may touch. Authored in two blocks — the
 * general stills here, the form pipelines below — and exported as ONE frozen
 * manifest, never mutated after freeze.
 */
const STILL_PIPELINES = Object.freeze({
  'still.sdxl.txt2img': Object.freeze({
    id: 'still.sdxl.txt2img',
    kind: 'still',
    label: 'SDXL — text to image',
    description: 'General-purpose still image from a text prompt. Balanced quality, 1024x1024 native. The default when no pipeline is named.',
    template: 'txt2img',
    modelId: 'sdxl-base-1.0',
    slots: Object.freeze({
      ...PROMPT_SLOTS, ...SIZE_SLOTS, ...SAMPLER_SLOTS,
      steps: Object.freeze({ type: 'int', min: 1, max: 60, default: 25 }),
      cfg: Object.freeze({ type: 'float', min: 1.0, max: 12.0, default: 7.0 }),
    }),
  }),

  'still.sdxl.img2img': Object.freeze({
    id: 'still.sdxl.img2img',
    kind: 'still',
    label: 'SDXL — image to image',
    description: 'Reworks a supplied source image under a text prompt. Requires an uploaded image; `denoise` controls how far it may travel from the source (0.2 = a nudge, 0.9 = a reinterpretation).',
    template: 'img2img',
    modelId: 'sdxl-base-1.0',
    requiresSourceImage: true,
    slots: Object.freeze({
      ...PROMPT_SLOTS, ...SAMPLER_SLOTS,
      steps: Object.freeze({ type: 'int', min: 1, max: 60, default: 25 }),
      cfg: Object.freeze({ type: 'float', min: 1.0, max: 12.0, default: 7.0 }),
      denoise: Object.freeze({ type: 'float', min: 0.05, max: 1.0, default: 0.6 }),
    }),
  }),
});

// The three registers and their scaffolds live in `form-registry.js`; the slot
// vocabularies are handed in so the dependency runs one way and never cycles.
const FORM_PIPELINES = buildFormPipelines(PROMPT_SLOTS, SAMPLER_SLOTS);
// FLUX.2 klein + the controlled Z-Image lane (`pipelines-flux2.js`), same one-way hand-in.
const FLUX2_PIPELINES = buildFlux2Pipelines(PROMPT_SLOTS, SAMPLER_SLOTS, SIZE_SLOTS);

/** The whole manifest, frozen once. */
export const PIPELINES = Object.freeze({ ...STILL_PIPELINES, ...FLUX2_PIPELINES, ...FORM_PIPELINES });

/** The pipeline a caller gets when it names none. */
export const DEFAULT_PIPELINE_ID = 'still.sdxl.txt2img';

/**
 * Resolve a pipeline id against the in-repo manifest ONLY. Unknown id ⇒
 * fail-closed refusal naming what IS available, never a disk lookup. Pure.
 * @param {string} id
 * @returns {{ok: true, pipeline: object} | {ok: false, error: string}}
 */
export const resolvePipeline = (id) => {
  const wanted = typeof id === 'string' && id.length > 0 ? id : DEFAULT_PIPELINE_ID;
  const pipeline = Object.prototype.hasOwnProperty.call(PIPELINES, wanted) ? PIPELINES[wanted] : null;
  if (!pipeline) {
    return { ok: false, error: `unknown pipeline '${wanted}' — available: ${Object.keys(PIPELINES).join(', ')}` };
  }
  return { ok: true, pipeline };
};

/**
 * Resolve the model a pipeline names. A pipeline pointing at a model absent
 * from PACK_MODELS is a registry authoring error and refuses rather than
 * reaching for whatever sits on disk under that name. Pure.
 * @param {object} pipeline
 * @returns {{ok: true, model: object} | {ok: false, error: string}}
 */
export const resolveModel = (pipeline) => {
  const model = Object.prototype.hasOwnProperty.call(PACK_MODELS, pipeline.modelId) ? PACK_MODELS[pipeline.modelId] : null;
  if (!model) return { ok: false, error: `pipeline '${pipeline.id}' names unregistered model '${pipeline.modelId}'` };
  return { ok: true, model };
};

/**
 * Resolve a pipeline's declared STYLE LoRA stack against the manifest. Same law
 * as resolveModel: a pipeline naming an unregistered LoRA is an authoring error
 * and refuses, rather than reaching for whatever sits on disk under that name.
 * Pure.
 * @param {object} pipeline
 * @returns {{ok: true, loras: Array} | {ok: false, error: string}}
 */
export const resolveLoras = (pipeline) => {
  const wanted = Array.isArray(pipeline.loras) ? pipeline.loras : [];
  const loras = [];
  for (const entry of wanted) {
    const lora = Object.prototype.hasOwnProperty.call(PACK_LORAS, entry.loraId) ? PACK_LORAS[entry.loraId] : null;
    if (!lora) return { ok: false, error: `pipeline '${pipeline.id}' names unregistered lora '${entry.loraId}'` };
    loras.push({
      loraName: lora.loraName,
      strengthModel: entry.strengthModel,
      strengthClip: entry.strengthClip,
    });
  }
  return { ok: true, loras };
};

/**
 * Resolve a pipeline's control branch. A pipeline with no `controlNetId` is
 * unposed and resolves cleanly to null — the branch simply does not build.
 *
 * A pipeline that DOES apply a control net but names no pose plate refuses:
 * ControlNetApplyAdvanced with no image would either error at the engine or,
 * worse, quietly render an unposed picture that the pipeline's whole promise
 * says is posed. Fail closed on the promise. Pure.
 * @param {object} pipeline
 * @returns {{ok: true, controlNet: object|null, poseImage: string|null} | {ok: false, error: string}}
 */
export const resolveControlNet = (pipeline) => {
  if (!pipeline.controlNetId) return { ok: true, controlNet: null, poseImage: null };
  const cn = Object.prototype.hasOwnProperty.call(PACK_CONTROLNETS, pipeline.controlNetId)
    ? PACK_CONTROLNETS[pipeline.controlNetId] : null;
  if (!cn) return { ok: false, error: `pipeline '${pipeline.id}' names unregistered control net '${pipeline.controlNetId}'` };
  if (!pipeline.posePlate) {
    return { ok: false, error: `pipeline '${pipeline.id}' applies a control net but names no pose plate` };
  }
  return { ok: true, controlNet: cn, poseImage: pipeline.posePlate };
};

/**
 * Resolve a pipeline's model patch (the DiT ControlNet). No `patchId` ⇒ no
 * patch, cleanly. A named patch absent from the manifest is an authoring error
 * and refuses — same law as every other resolver. Pure.
 * @param {object} pipeline
 * @returns {{ok: true, patch: object|null} | {ok: false, error: string}}
 */
export const resolvePatch = (pipeline) => {
  if (!pipeline.patchId) return { ok: true, patch: null };
  const patch = Object.prototype.hasOwnProperty.call(PACK_MODEL_PATCHES, pipeline.patchId)
    ? PACK_MODEL_PATCHES[pipeline.patchId] : null;
  if (!patch) return { ok: false, error: `pipeline '${pipeline.id}' names unregistered model patch '${pipeline.patchId}'` };
  return { ok: true, patch };
};

/**
 * The being-visible catalog — what `list_pipelines` hands a model. Carries only
 * what a caller needs to choose and parameterize: no file paths, no hashes, no
 * engine internals. Pure.
 * @returns {Array<object>}
 */
export const catalogForCaller = () => Object.values(PIPELINES).map((p) => ({
  id: p.id,
  kind: p.kind,
  label: p.label,
  description: p.description,
  requiresSourceImage: p.requiresSourceImage === true,
  parameters: Object.entries(p.slots).map(([name, spec]) => ({
    name,
    type: spec.type,
    ...(spec.values ? { allowed: [...spec.values] } : {}),
    ...(spec.min !== undefined ? { min: spec.min, max: spec.max } : {}),
    ...(spec.default !== undefined && spec.default !== null ? { default: spec.default } : {}),
    ...(spec.required ? { required: true } : {}),
  })),
}));
