/**
 * Game look-dev pipelines. Pure, frozen data; model files and graph execution
 * stay behind the pack registry and parameterizer.
 *
 * The character recipe is the one that produced the approved human_knight_raw
 * reference: Bismuth Illustrious v8 + Dungeon Squad, 832x1216, 30 steps, CFG 7,
 * DPM++ 2M Karras. Weapons keep the same checkpoint but use less of the
 * character-trained LoRA; its training metadata is heavily character-weighted.
 */

// Hashes measured on the operator's files 2026-11-03: local-drift tripwires,
// not publisher attestations.
export const CONCEPT_MODELS = Object.freeze({
  'bismuth-illustrious-v80': Object.freeze({
    id: 'bismuth-illustrious-v80',
    label: 'Bismuth Illustrious v8',
    ckptName: 'bismuthIllustrious_v80.safetensors',
    sha256: '749cb493aada2e5d522ae87b53219b8783096135b0a1c7168366c7692c80c632',
    bytes: 6938040706,
  }),
});

export const CONCEPT_LORAS = Object.freeze({
  'dungeon-squad-illustrious-v5': Object.freeze({
    id: 'dungeon-squad-illustrious-v5',
    label: 'Dungeon Squad Illustrious v5',
    loraName: 'Dungeon_Squad_IllustriousV5.safetensors',
    sha256: 'ff177022caecebdf658841bb4c075f116965689899438b7775f1de1ab087eda9',
    bytes: 228461636,
  }),
});

const QUALITY = 'masterpiece, best quality, highly detailed pixel art, crisp clean pixels';
const LOOK = 'gothic dark fantasy meets cyberpunk, sci-fi technology fused with arcane magic, '
  + 'intricate metalwork, subtle glowing tech accents';
const NEGATIVE = 'lowres, worst quality, low quality, jpeg artifacts, blurry, anti-aliasing, '
  + 'smooth gradients, 3d render, photorealistic, watercolor, oil painting, sketch, '
  + 'bad anatomy, bad hands, extra limbs, deformed, cropped, out of frame, '
  + 'text, watermark, logo, signature';

const CHARACTER_FRAMING = Object.freeze({
  framing: '16-bit RPG character concept, full body, head to toe visible, centered, '
    + 'character fills the frame, three-quarter view, confident neutral stance',
  garment: 'armor, clothing and equipment exactly as described in the character subject',
  expression: 'confident neutral expression',
  lighting: 'readable forms, controlled contrast, dark moody atmosphere',
  plate: 'simple background, black background, character design reference',
});

const TURNAROUND_FRAMING = Object.freeze({
  framing: 'character turnaround reference sheet, the same single character shown exactly three times, '
    + 'front view, side view, back view in a horizontal row, full body, head to toe, neutral A-pose, '
    + 'three separate non-overlapping figures with generous clear space between them, '
    + 'consistent proportions and identical equipment across all three views',
  garment: 'armor, clothing and equipment identical to the approved source in every view',
  expression: 'neutral expression, identical face in every view',
  lighting: 'even flat lighting, readable materials and construction',
  plate: 'simple background, black background, evenly spaced views, no props',
});

const WEAPON_FRAMING = Object.freeze({
  framing: '16-bit RPG weapon concept, exactly one weapon, full item visible, centered, '
    + 'diagonal three-quarter view, large in frame, readable silhouette and construction',
  garment: 'hilt, grip, guard, mechanism and materials exactly as described in the weapon subject',
  expression: 'inanimate object, no wielder',
  lighting: 'even studio lighting, readable metal and material detail',
  plate: 'simple background, black background, isolated item design reference',
});

const TURNAROUND_NEGATIVE = 'different characters, inconsistent design, changing outfit, '
  + 'changing equipment, different proportions, extra views, single view, one view, '
  + 'overlapping figures, touching figures, weapons, swords, held items, '
  + 'labels, numbers, grid lines, dynamic pose, scenery, props';

const WEAPON_NEGATIVE = 'character, person, human, face, hands, arms, body, mannequin, '
  + 'multiple weapons, weapon set, collection, sheath, display stand, scenery';

const conceptSlots = (promptSlots, samplerSlots, options) => Object.freeze({
  ...promptSlots,
  ...samplerSlots,
  samplerName: Object.freeze({ ...samplerSlots.samplerName, default: 'dpmpp_2m' }),
  scheduler: Object.freeze({ ...samplerSlots.scheduler, default: 'karras' }),
  steps: Object.freeze({ type: 'int', min: 20, max: 50, default: 30 }),
  cfg: Object.freeze({ type: 'float', min: 4, max: 9, default: 7 }),
  ...(options.source ? { denoise: Object.freeze({ type: 'float', min: 0.35, max: 0.95, default: options.denoise ?? 0.7 }) } : {}),
});

const pipeline = (id, label, description, components, extraNegative, options) => Object.freeze({
  id,
  kind: 'concept',
  label,
  description,
  template: 'form',
  modelId: 'bismuth-illustrious-v80',
  scaffold: Object.freeze({
    components: Object.freeze({ quality: `${QUALITY}, ${LOOK}`, ...components }),
    negative: Object.freeze({ append: `${NEGATIVE}, ${extraNegative}` }),
  }),
  slots: conceptSlots(options.promptSlots, options.samplerSlots, options),
  fixed: Object.freeze(options.fixed),
  loras: Object.freeze([
    Object.freeze({
      loraId: 'dungeon-squad-illustrious-v5',
      strengthModel: options.loraStrength,
      strengthClip: options.loraStrength,
    }),
  ]),
  ...(options.source ? { requiresSourceImage: true } : {}),
  ...(options.controlNetId ? {
    controlNetId: options.controlNetId,
    posePlate: options.posePlate,
    controlStrength: options.controlStrength,
  } : {}),
});

/** Build the game-concept block without importing its orchestrator. Pure. */
export const buildConceptPipelines = (promptSlots, samplerSlots) => {
  const slots = { promptSlots, samplerSlots };
  return Object.freeze({
    'concept.pixel.character': pipeline(
      'concept.pixel.character',
      'GAME — pixel character concept',
      'A full-body gothic cyberpunk character in the approved Bismuth + Dungeon Squad look. Describe identity, silhouette, clothing, equipment and palette; framing and rendering settings stay pinned.',
      CHARACTER_FRAMING,
      'multiple people, character sheet, turnaround',
      { ...slots, fixed: { width: 832, height: 1216 }, loraStrength: 1.0 },
    ),
    'concept.pixel.turnaround': pipeline(
      'concept.pixel.turnaround',
      'GAME — reference character turnaround',
      'A front/side/back sheet derived from an approved character reference. Requires that source image. Img2img anchors the design while OpenPose fixes three separated neutral views; identity is still reviewed, never guaranteed. Keep the seed and source when iterating.',
      TURNAROUND_FRAMING,
      TURNAROUND_NEGATIVE,
      {
        ...slots, fixed: { width: 1216, height: 832 }, loraStrength: 0.75, source: true, denoise: 0.95,
        controlNetId: 'openpose-sdxl', posePlate: 'pose_turnaround_ref.png', controlStrength: 1.2,
      },
    ),
    'concept.pixel.view': pipeline(
      'concept.pixel.view',
      'GAME — reference character view',
      'Revises an approved character into one requested view, pose or equipment study while retaining the source design. Requires a source image. Use a lower denoise for small changes and a higher denoise for large pose changes.',
      CHARACTER_FRAMING,
      'multiple people, character sheet, turnaround, different character, changing outfit',
      { ...slots, fixed: { width: 832, height: 1216 }, loraStrength: 0.75, source: true },
    ),
    'concept.pixel.weapon': pipeline(
      'concept.pixel.weapon',
      'GAME — standalone pixel weapon concept',
      'One large, fully visible weapon on a clean dark plate, in the same Bismuth base-family look as the characters. Describe weapon class, silhouette, materials, mechanism, decoration and glow colour; no person or extra items.',
      WEAPON_FRAMING,
      WEAPON_NEGATIVE,
      { ...slots, fixed: { width: 832, height: 832 }, loraStrength: 0.35 },
    ),
  });
};
