/**
 * The FLUX.2 [klein] pipelines and the controlled Z-Image lane — authored here,
 * frozen into the ONE manifest by `pack-registry.js`. The slot vocabularies are
 * handed in (as `form-registry.js` does) so the dependency runs one way and
 * never cycles. Adding one is a reviewed act, exactly as in the registry.
 *
 * @param {object} PROMPT_SLOTS from pack-registry (polarity-tagged)
 * @param {object} SAMPLER_SLOTS from pack-registry
 * @param {object} SIZE_SLOTS from pack-registry
 */
export const buildFlux2Pipelines = (PROMPT_SLOTS, SAMPLER_SLOTS, SIZE_SLOTS) => Object.freeze({
    // klein is DISTILLED: guidance is pinned at 1.0 inside the graph and the
    // negative is zeroed (ConditioningZeroOut), so neither is offered as a slot —
    // a knob that does nothing is a lie told to the caller. Sampler and scheduler
    // are the model's own (euler + Flux2Scheduler), not the SDXL vocabulary.
    'still.klein.txt2img': Object.freeze({
      id: 'still.klein.txt2img',
      kind: 'still',
      label: 'FLUX.2 klein — fast text to image',
      description: 'Fast, high-quality still image (4 steps) from FLUX.2 [klein]. Reads full sentences: describe the scene, subject, light and lens in prose. Strong prompt adherence and text rendering; photoreal people hold up. No negative prompt — say what you want, not what you do not.',
      template: 'flux2',
      modelId: 'flux2-klein-4b',
      slots: Object.freeze({
        positive: PROMPT_SLOTS.positive,
        ...SIZE_SLOTS,
        seed: SAMPLER_SLOTS.seed,
        steps: Object.freeze({ type: 'int', min: 1, max: 8, default: 4 }),
      }),
    }),

    'still.klein.edit': Object.freeze({
      id: 'still.klein.edit',
      kind: 'still',
      label: 'FLUX.2 klein — edit an image',
      description: 'Edits a supplied source image by instruction ("make the jacket black", "turn this into a night scene"). Requires an uploaded image; the output keeps the source\'s proportions at about one megapixel. Write the change as a plain instruction.',
      template: 'flux2edit',
      modelId: 'flux2-klein-4b',
      requiresSourceImage: true,
      slots: Object.freeze({
        positive: PROMPT_SLOTS.positive,
        seed: SAMPLER_SLOTS.seed,
        steps: Object.freeze({ type: 'int', min: 1, max: 8, default: 4 }),
      }),
    }),

    // ⭐ THE TEAM PORTRAIT — Design note, 2026-10-13: […]
    //
    // A REAL person's photo goes in; the same person comes out, re-shot in the
    // house look (brand book §8: "the void, hairlines"). The look is the
    // pipeline's job and is NOT a caller knob — a team page where every portrait
    // was lit differently is not a team page. The caller may add direction
    // (wardrobe, glasses, expression); it is screened like any prompt and rides
    // AFTER the house instruction, never instead of it.
    //
    // 896x1120 is 4:5 at ~1MP, both sides /16 — the editorial headshot crop.
    'portrait.team': Object.freeze({
      id: 'portrait.team',
      kind: 'portrait',
      label: 'Team portrait — void studio',
      description: 'A professional studio portrait of the real person in the source photo, in the house look: near-black seamless backdrop, one soft key light, a thin rim light, true skin colour, dark minimal wardrobe, 85mm editorial framing (4:5). Requires an uploaded photo of the person. Optional prompt: extra direction only (e.g. "keep the glasses", "slight smile") — the look itself is fixed.',
      template: 'flux2edit',
      modelId: 'flux2-klein-4b',
      requiresSourceImage: true,
      fixed: Object.freeze({ width: 896, height: 1120 }),
      instruction: 'Re-photograph the person from image 1 as a professional studio portrait. '
        + 'Keep their face, identity, age, skin tone and facial hair exactly as they are. '
        + 'Keep their hair exactly as it is in image 1: the same length, volume, texture and parting, not restyled, trimmed or tidied. '
        + 'Head-and-shoulders framing, body angled slightly, face toward the camera, calm and confident expression. '
        + 'Seamless near-black backdrop with no texture or gradient. '
        + 'One large soft key light from the front left, a thin neutral white rim light tracing the hair and shoulders, deep falloff into shadow, no coloured light. '
        + 'True-to-life skin colour and natural skin texture, no airbrushing. '
        + 'Dark minimal clothing in black or charcoal. '
        + 'Shot on an 85mm lens at f/2.8, sharp focus on the eyes, editorial photography.',
      slots: Object.freeze({
        positive: Object.freeze({ type: 'text', required: false, screened: true, polarity: 'positive', default: '' }),
        seed: SAMPLER_SLOTS.seed,
        steps: Object.freeze({ type: 'int', min: 1, max: 8, default: 4 }),
      }),
    }),

    // ⭐ THE CONTROLLED PIPELINE — Design note, 2026-10-13: […] FLUX.2 klein has no real ControlNet (a pose map
    // fed as a reference has no strength and no timing), so control lives on the
    // DiT that has a native one: Z-Image Turbo + the Fun ControlNet Union patch,
    // core nodes only. The source image is the STRUCTURE: in `canny` mode the
    // engine's own Canny node extracts its edges (composition, pose, outline);
    // in `map` mode the upload already IS a control map (an OpenPose skeleton,
    // a depth map) and goes straight in.
    'control.zimage.union': Object.freeze({
      id: 'control.zimage.union',
      kind: 'still',
      label: 'Z-Image Turbo — controlled (ControlNet)',
      description: 'Photoreal still that follows the STRUCTURE of a supplied image — its composition, pose and outlines — while the prompt decides everything else. Requires an uploaded image. controlMode "canny" traces the photo\'s edges; "map" means the upload is already a pose skeleton or depth map. strength: how tightly to follow it — 1.0 (default) is clean and exact; lower values loosen the structure but can leave faint edge lines. Output keeps the source\'s proportions at about one megapixel.',
      template: 'zimagecontrol',
      modelId: 'z-image-turbo-bf16',
      patchId: 'zimage-turbo-fun-union',
      requiresSourceImage: true,
      slots: Object.freeze({
        positive: PROMPT_SLOTS.positive,
        seed: SAMPLER_SLOTS.seed,
        steps: Object.freeze({ type: 'int', min: 4, max: 12, default: 8 }),
        strength: Object.freeze({ type: 'float', min: 0.2, max: 1.5, default: 1.0 }),
        controlMode: Object.freeze({ type: 'enum', values: Object.freeze(['canny', 'map']), default: 'canny' }),
      }),
    }),
});
