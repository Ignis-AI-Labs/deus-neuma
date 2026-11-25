/**
 * THE ILLUSTRIOUS CHARACTER PIPELINES — clean anime / 2.5D characters, every render (Design note, 2026-11-20, a Sophie Zero
 * render smeared and muddy: […]; and […]).
 *
 * What was wrong: the render came through still.sdxl.txt2img — SDXL Base 1.0, which does not read booru tags — with no
 * second pass. What these are: an Illustrious-family checkpoint, run on its AUTHOR'S recipe (sampler, scheduler, CFG,
 * steps, clip skip, quality tags, negative — each from its Civitai page, read 2026-11-20; the files on disk match the
 * SHA-256 each page publishes), then a hires pass (the WAI author's: a 4x anime upscaler, scaled to 1.5x, re-sampled
 * 20 steps at 0.4 denoise). The recipe is the pipeline's, not the caller's: a caller describes the subject; the quality
 * frame, the sampler and the second pass cannot be wired wrong. Side by side on one Sophie Zero prompt and two seeds,
 * all three rendered clean (docs: /var/tmp/sdxl-research sheets, 2026-11-20).
 *
 * THE UPSCALER is Real-ESRGAN x4plus anime 6B (xinntao, BSD-3-Clause — commercial use is fine), byte-identical to the
 * official v0.2.2.4 release, converted once to .safetensors with a weights-only load (no pickle runs) and proven to
 * give pixel-identical output. 2x-AnimeSharpV4 rendered the same but is CC BY-NC-SA (non-commercial), so it is not
 * used. Pure.
 */
import { safePrefix } from './templates.js';

const CKPT = 'checkpoints';
const UPSCALER = Object.freeze({
  folder: 'upscale_models', name: 'RealESRGAN_x4plus_anime_6B.safetensors',
  sha256: '121d84e301fd4f07b0df58b19534abf1b9e399a66f96fd83926857a80cf0e138', bytes: 17888964,
  from: 'xinntao/Real-ESRGAN v0.2.2.4 RealESRGAN_x4plus_anime_6B.pth (sha256 f872d837d3c90ed2e05227bed711af5671a6fd1c9f7d7e91c911a61f155e99da), converted',
});
const HIRES = Object.freeze({ scale: 1.5, steps: 20, denoise: 0.4 });
// THE ADULT FLOOR (Design note, 2026-11-20: sexy adult characters — […]).
// Anime checkpoints lean young unless told otherwise, so every render here steers away from it in its own negative,
// after the author's, where no caller can take it out. The content-law screen still judges the caller's words first.
export const ADULT_FLOOR = 'child, loli, shota';

/** The checkpoint these pipelines add — SHA-256 as its publisher lists it on Civitai, matched on this machine
 *  (perfectDeliberate v10 and Hale Anime IL v19 were registered already, 2026-08-27). */
export const ILLUSTRIOUS_MODELS = Object.freeze({
  // OUR OWN (Design note, 2026-11-20: […]): Hale 80 / WAI 10 / PerfectDeliberate 10, the image model (UNet) blended weight by weight, Hale's
  // text encoders and VAE whole (scripts/merge-checkpoint.py; the recipe also rides in the file's own metadata). Every
  // part's Civitai terms allow derivatives with their own permissions; the Illustrious base is under the Fair AI Public
  // License 1.0-SD, so a released copy goes out with its weights under that licence, and images made with it are free.
  'deusneuma-character-xl': Object.freeze({
    id: 'deusneuma-character-xl', label: 'Deus Neuma Character XL v0.1 (Ignis AI Labs)', ckptName: 'deusneuma_characterXL_v0.1.safetensors',
    sha256: 'ff509539c562deb227311c8947273283b2f0caecce3b7139d0a6fcdacc7db501', bytes: 6938042020,
  }),
  'wai-illustrious-v17': Object.freeze({
    id: 'wai-illustrious-v17', label: 'WAI-illustrious-SDXL v17 (WAI0731)', ckptName: 'waiIllustriousSDXL_v170.safetensors',
    sha256: 'f116b0c78ff441467b0cdc8f1936e1ed18ea31e9997c7b132b1b8db533f0bd04', bytes: 6938040682,
  }),
});

// THE PROMPTING RULES (Design note, 2026-11-20: […]). Each one was proven on
// this pipeline the same day: Metidar's render, reproduced pixel for pixel, then one input changed at a time — the
// seed and CFG changed nothing of the look, the words changed all of it (/var/tmp/sdxl-research/sheet-swap.jpg).
// What the pipeline can hold, it holds (setAsideOwn below); what only a writer can do is said in every listing.
export const PROMPT_RULES = 'HOW TO PROMPT IT (proven on this pipeline): '
  + '(1) Write the subject only, as tags and short phrases: who (1girl, solo, mature female), framing, body, material, clothing, setting, light. Quality tags (masterpiece, best quality, 8k, …) are the pipeline\'s: yours are set aside and you are told. '
  + '(2) Framing decides detail: "full body" makes the face small; "cowboy shot" (thighs up), "upper body" or "portrait" give the face real detail. '
  + '(3) Material words decide the look: armor, plate, chainmail, metal turn the whole body to metal; skin, porcelain, bioglass, veins keep it flesh. '
  + '(4) Every colour you name shows up; name only the ones you want. '
  + '(5) Short, most important first: about 30 tags. A long prompt spreads its weight thin and its last tags barely hold. '
  + '(6) To judge a change, keep the seed and change one thing. '
  + '(7) Your negative joins the pipeline\'s own, which already holds bad/worst quality, sketch, watermark and an adult floor that steers every render away from childlike bodies: write only what that does not cover, and never age words — the content law refuses them anywhere, even in a negative, and the floor already does that work. '
  + '(8) A word can become an object: "ball joints" drew a ball in her hand, and "skull, bones" scattered skulls on the floor. Describe what is inside the body ("skeleton visible through the skin") and put the stray object in your negative. '
  + '(9) A strong colour spreads: "gold" turned the whole body gold and brought wings and sun halos. Tie it to the part ("thin gold bones") and negate the spread ("gold skin, wings, sun halo"). '
  + '(10) One region per render: a full-body prompt cannot place hand or face detail. Give hands and face their own close-up prompt. A material split within one part (a soft palm, a plated back) needs a region fix or a trained LoRA, not more words.';

// The tags the pipeline writes itself. A caller's copy doubles their weight and pushes the subject down the prompt.
const OWN_QUALITY = Object.freeze(['masterpiece', 'best quality', 'amazing quality', 'high quality', 'good quality', 'highres',
  'high resolution', 'absurdres', 'very aesthetic', 'ultra detailed', 'ultra-detailed', 'extremely detailed', 'highly detailed',
  '4k', '8k', 'uhd']);

const tagsOf = (text) => String(text ?? '').split(',').map((t) => t.trim()).filter(Boolean);
// A tag as written, without its weight: "(masterpiece:1.2)" is masterpiece.
const bareTag = (tag) => tag.replace(/^[([{]+|[)\]}]+$/g, '').replace(/:\s*[\d.]+$/, '').trim().toLowerCase();

/** pure — the caller's words with the tags the pipeline already writes set aside, and which those were. Untouched
 *  (byte for byte) when there is nothing to set aside. */
export const setAsideOwn = (text, own) => {
  const ownSet = new Set([...own].map(bareTag));
  const tags = tagsOf(text);
  const dropped = tags.filter((t) => ownSet.has(bareTag(t)));
  if (!dropped.length) return { text: String(text ?? '').trim(), dropped };
  return { text: tags.filter((t) => !ownSet.has(bareTag(t))).join(', '), dropped };
};

// Crody (Hale, Illustrious): Euler a, steps 20-30, clip skip 1-2, CFG 4-6; the author's own prompt frame and negative.
// ([…] are Illustrious's dataset-era tags, not ages.)
const NOVAANIME_RECIPE = Object.freeze({
  sampler: 'euler_ancestral', scheduler: 'normal', clipSkip: 2,
  prefix: 'masterpiece, best quality, amazing quality, 4k, very aesthetic, high resolution, ultra-detailed, absurdres, newest, ',
  suffix: ', depth of field, volumetric lighting',
  negative: 'modern, recent, old, oldest, cartoon, graphic, text, painting, crayon, graphite, abstract, glitch, deformed, mutated, ugly, disfigured, long body, lowres, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, very displeasing, (worst quality, bad quality:1.2), sketch, jpeg artifacts, signature, watermark, username, simple background, conjoined, bad ai-generated',
});

// THE DESIGN SHEET (2026-11-21): the NovaAnimeXL author's recipe is built for finished illustrations: it adds […] and negates "simple background", so a character reference kept drifting into halos, star
// flares, swords and summoning rings. The same model and sampler with no lighting suffix, a plain background allowed,
// and that drift negated gave a clean reference on the first try, the base body's skeleton and joints holding.
const SHEET_RECIPE = Object.freeze({
  ...NOVAANIME_RECIPE,
  suffix: '',
  negative: `${NOVAANIME_RECIPE.negative.replace('simple background, ', '')}, scenery, landscape, ground, floor, light rays, lens flare, sparkle, magic circle, halo, weapon, sword`,
});

// SDXL buckets around one megapixel, portrait first (the authors render at or above 1024x1024 area).
const DIMS = Object.freeze([832, 896, 1024, 1152, 1216]);

/**
 * @param {object} PROMPT_SLOTS
 * @param {object} SAMPLER_SLOTS
 */
export const buildIllustriousPipelines = (PROMPT_SLOTS, SAMPLER_SLOTS) => {
  const pipeline = ({ id, label, description, modelId, ckptName, recipe, cfg, steps }) => Object.freeze({
    id, kind: 'still', label, description, template: 'illustrious', modelId,
    recipe: Object.freeze({ ...recipe, hires: HIRES, upscaler: UPSCALER.name }),
    // What the engine must hold: the checkpoint (the operator's library) and the upscaler (the forge's own folder).
    files: Object.freeze([Object.freeze({ folder: CKPT, name: ckptName }), Object.freeze({ folder: UPSCALER.folder, name: UPSCALER.name })]),
    slots: Object.freeze({
      ...PROMPT_SLOTS,
      width: Object.freeze({ type: 'enum', values: DIMS, default: 832 }),
      height: Object.freeze({ type: 'enum', values: DIMS, default: 1216 }),
      seed: SAMPLER_SLOTS.seed,
      steps: Object.freeze({ type: 'int', ...steps }),
      cfg: Object.freeze({ type: 'float', ...cfg }),
    }),
  });
  const how = `The sampler, the quality tags, the negative frame and the second pass are the pipeline's and always applied. Output is 1.5x your size (default 832x1216 → 1248x1824). ${PROMPT_RULES}`;
  return Object.freeze({
    'still.wai.txt2img': pipeline({
      id: 'still.wai.txt2img', label: 'WAI Illustrious v17 — clean anime character',
      description: `Clean, crisp anime character art with strong anatomy and smooth colouring. ${how} The author warns against adding more quality tags or a long negative: they blur the image.`,
      modelId: 'wai-illustrious-v17', ckptName: 'waiIllustriousSDXL_v170.safetensors',
      // WAI0731: Euler a, CFG 5-7, steps 15-30 (25-40 for v5-v15), VAE baked; ",masterpiece,best quality,amazing quality," / […].
      recipe: { sampler: 'euler_ancestral', scheduler: 'normal', clipSkip: 1, prefix: 'masterpiece, best quality, amazing quality, ', suffix: '', negative: 'bad quality, worst quality, worst detail, sketch, censor' },
      cfg: { min: 5, max: 7, default: 6 }, steps: { min: 20, max: 40, default: 28 },
    }),
    'still.deliberate.txt2img': pipeline({
      id: 'still.deliberate.txt2img', label: 'perfectDeliberate v10 — painted 2.5D character',
      description: `Painted, semi-real 2.5D character art — anime structure with a softer, more rendered finish. ${how}`,
      modelId: 'perfectdeliberate-v10', ckptName: 'perfectdeliberate_v10.safetensors',
      // Desync: Euler a or DPM++ 2M Karras, CFG 5-8, steps 20-50, VAE baked, no trigger words (Euler a, CFG 5, 30 steps: Founder's pick, 2026-08-27).
      recipe: { sampler: 'euler_ancestral', scheduler: 'normal', clipSkip: 1, prefix: 'masterpiece, best quality, amazing quality, ', suffix: '', negative: 'worst quality, bad quality, lowres, bad anatomy, bad hands, jpeg artifacts, watermark' },
      cfg: { min: 5, max: 8, default: 5 }, steps: { min: 20, max: 50, default: 30 },
    }),
    'still.nova.txt2img': pipeline({
      id: 'still.nova.txt2img', label: 'Nova Anime XL IL v19 — anime / 2.5D character, high contrast',
      description: `Anime and 2.5D character art with higher contrast and detailed backgrounds. ${how} Licence: its author asks that an image not be used commercially unedited.`,
      modelId: 'nova-anime-xl-1.9', ckptName: 'novaAnimeXL_ilV190.safetensors',
      recipe: NOVAANIME_RECIPE, cfg: { min: 4, max: 6, default: 5 }, steps: { min: 20, max: 30, default: 28 },
    }),
    'still.neuma.txt2img': pipeline({
      id: 'still.neuma.txt2img', label: 'Deus Neuma Character XL — our own model',
      description: `The house's own model, made by Ignis AI Labs from NovaAnimeXL (its look), WAI and PerfectDeliberate: anime and 2.5D character art with NovaAnimeXL's contrast and a cleaner hand. Images made with it are yours, including for commercial use. ${how}`,
      // It reads prompts with Hale's own text encoders, so it takes Hale's author's recipe whole.
      modelId: 'deusneuma-character-xl', ckptName: 'deusneuma_characterXL_v0.1.safetensors',
      recipe: NOVAANIME_RECIPE, cfg: { min: 4, max: 6, default: 5 }, steps: { min: 20, max: 30, default: 28 },
    }),
    'still.neuma.sheet.txt2img': pipeline({
      id: 'still.neuma.sheet.txt2img', label: 'Deus Neuma Character XL — design sheet (plain background)',
      description: `Our own model for character DESIGN: a plain background with no scenery, light rays, halos or weapons, so a body or an outfit reads clean as a reference. Write the background you want ("simple background, black background", or white, or grey). ${how}`,
      modelId: 'deusneuma-character-xl', ckptName: 'deusneuma_characterXL_v0.1.safetensors',
      recipe: SHEET_RECIPE, cfg: { min: 4, max: 6, default: 5 }, steps: { min: 20, max: 30, default: 28 },
    }),
  });
};

/** pure — the prompt pair a recipe frames around the caller's (already screened) words: the tags it writes itself
 *  set aside from theirs (and named, so nothing is cut silently), the author's negative and the adult floor first. */
export const framedPrompts = (recipe, positive, negative = '') => {
  const subject = setAsideOwn(positive, [...OWN_QUALITY, ...tagsOf(recipe.prefix), ...tagsOf(recipe.suffix)]);
  const theirs = setAsideOwn(negative, [...tagsOf(recipe.negative), ...tagsOf(ADULT_FLOOR)]);
  return {
    positive: `${recipe.prefix}${subject.text}${recipe.suffix}`,
    negative: [recipe.negative, ADULT_FLOOR, theirs.text].filter(Boolean).join(', '),
    subject: subject.text,
    setAside: [...subject.dropped, ...theirs.dropped.map((t) => `${t} (negative)`)],
  };
};

/** pure — what the render's receipt says about tags the pipeline set aside, or null. */
export const setAsideNote = (setAside) => (setAside.length
  ? `The pipeline writes its own quality tags and negative frame, so it set aside yours: ${setAside.join(', ')}.`
  : null);

/**
 * The graph (API format): checkpoint (clip skip when the recipe asks), base pass, then the hires pass — a model
 * upscale scaled to exactly the target, re-encoded and re-sampled lightly. Pure.
 */
export const buildIllustrious = (p) => {
  const clip = p.clipSkip > 1 ? ['20', 0] : ['1', 1];
  const W = Math.round(p.width * p.hires.scale / 8) * 8;
  const H = Math.round(p.height * p.hires.scale / 8) * 8;
  const sample = (latent, steps, denoise) => ({
    model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: latent,
    seed: p.seed, steps, cfg: p.cfg, sampler_name: p.sampler, scheduler: p.scheduler, denoise,
  });
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: p.ckptName } },
    ...(p.clipSkip > 1 ? { '20': { class_type: 'CLIPSetLastLayer', inputs: { clip: ['1', 1], stop_at_clip_layer: -p.clipSkip } } } : {}),
    '2': { class_type: 'CLIPTextEncode', inputs: { text: p.positive, clip } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: p.negative, clip } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: sample(['4', 0], p.steps, 1) },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '10': { class_type: 'UpscaleModelLoader', inputs: { model_name: p.upscaler } },
    '11': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['10', 0], image: ['6', 0] } },
    '12': { class_type: 'ImageScale', inputs: { image: ['11', 0], upscale_method: 'lanczos', width: W, height: H, crop: 'disabled' } },
    '13': { class_type: 'VAEEncode', inputs: { pixels: ['12', 0], vae: ['1', 2] } },
    '14': { class_type: 'KSampler', inputs: sample(['13', 0], p.hires.steps, p.hires.denoise) },
    '15': { class_type: 'VAEDecode', inputs: { samples: ['14', 0], vae: ['1', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['15', 0], filename_prefix: safePrefix(p.filenamePrefix) } },
  };
};

