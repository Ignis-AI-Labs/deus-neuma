/**
 * THE VIDEO PIPELINES — generated video with sound, authored here and frozen
 * into the ONE manifest by `pack-registry.js` (the flux2 precedent). Slot
 * vocabularies are handed in so the dependency runs one way and never cycles.
 *
 * Measured on the RTX PRO 6000 (docs/work/video-forge.md, forge-engine-upgrade.md):
 * - LTX-2.5 renders a 5 s 1280x720 clip in 32.6 s cold;
 * - it renders inside a 16 GB RAM box (57-72 s);
 * - the LTX engine ran pixel-identical from 22 GB of VRAM down to 6.
 * The machine lane (machine-lease.js) gives a render the machine to itself.
 * Licence: LTX-2.x Community License — free under $10M annual revenue; outputs
 * keep any provenance/disclosure the model applies (§ "AI Regulations").
 */
import { MIN_ENGINE_VRAM_GB } from './forge-capacity.js';

/**
 * The video model. Hashes MEASURED with `sha256sum` on this machine (2026-10-19)
 * and equal to the publisher's HF `lfs.oid` for every file. LTX-2.5 is gated
 * (Lightricks/LTX-2.5, "Agree and Access"); it replaced LTX-2.3 the day it was
 * proven (sharper, follows camera direction, faster, a smaller RAM floor).
 */
export const VIDEO_MODELS = Object.freeze({
  'ltx-2.5-22b-distilled': Object.freeze({
    id: 'ltx-2.5-22b-distilled',
    label: 'LTX-2.5 22B distilled (int8-convrot)',
    family: 'ltx',
    unetName: 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors',
    sha256: 'c4279eeff115cbeaca494bd2183e7d768c38fe85a184dc6afbb7159157c44334',
    bytes: 21504034224,
    textEncoderName: 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
    upscalerName: 'ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors',
    videoVaeName: 'ltx-2.5-video-vae-bf16.safetensors',
    audioVaeName: 'ltx-2.5-audio-vae-bf16.safetensors',
    companions: Object.freeze({
      textEncoder: Object.freeze({ sha256: '6ce688a0aa98a5fa36a9f1e6c3f42152a498cc2b53ee8c15674c64244f91487f', bytes: 15372969374 }),
      upscaler: Object.freeze({ sha256: 'eb5a71fe4068ee87ccdb1c3aa635e547ca76bd2d30ae20ae889f2c325c0677e8', bytes: 995778752 }),
      videoVae: Object.freeze({ sha256: '847e14ca7f3355debca0cea4eaa24ac0fbcdf0061da054ac89ca638a869ddba3', bytes: 1472223346 }),
      audioVae: Object.freeze({ sha256: 'c52733d37f6a7fb7949c3dc0fb468c6cb2169e4d836983a73babb9f0d54837a5', bytes: 364866540 }),
    }),
  }),
  // Apache-2.0 (Wan-AI), the lightx2v 4-step LoRAs Apache-2.0 too; the Comfy-Org
  // repackage (split_files/) is ungated. Two experts: high noise lays the motion,
  // low noise the detail. No sound.
  'wan-2.2-i2v-14b': Object.freeze({
    id: 'wan-2.2-i2v-14b',
    label: 'Wan 2.2 14B image-to-video (fp8, 4-step)',
    family: 'wan',
    highNoiseName: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
    sha256: '6122e79d55e0f235698d11d657f3b196c5273c830da00b2b013c5a048d5e6a42',
    bytes: 14294742832,
    lowNoiseName: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
    highLoraName: 'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
    lowLoraName: 'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
    textEncoderName: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    vaeName: 'wan_2.1_vae.safetensors',
    companions: Object.freeze({
      lowNoise: Object.freeze({ sha256: '5471a457b6ac404202a5fbe6c11595a3d5641fc766b00f38763f72303fffc21e', bytes: 14294742832 }),
      highLora: Object.freeze({ sha256: 'd176c808d6fc461999b68e321efcb7501b20b8c3797523ed0df14f7d1deff11e', bytes: 1226977424 }),
      lowLora: Object.freeze({ sha256: '024f21de095bc8fad9809ded3e9e49a2e170dcf27075da8145ba7d60d8aab7f9', bytes: 1226977424 }),
      textEncoder: Object.freeze({ sha256: 'c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68', bytes: 6735906897 }),
      vae: Object.freeze({ sha256: '2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b', bytes: 253815318 }),
    }),
  }),
});

/** The file names a video model entry may carry, handed to its graph builder by name. */
export const VIDEO_FILE_KEYS = Object.freeze([
  'unetName', 'textEncoderName', 'upscalerName', 'videoVaeName', 'audioVaeName',
  'highNoiseName', 'lowNoiseName', 'highLoraName', 'lowLoraName', 'vaeName',
]);

/** Landscape and portrait — the two canvases measured (1280x720, 720x1280). */
export const VIDEO_ASPECTS = Object.freeze({
  landscape: Object.freeze({ width: 1280, height: 720 }),
  portrait: Object.freeze({ width: 720, height: 1280 }),
});

/**
 * @param {object} PROMPT_SLOTS from pack-registry (polarity-tagged)
 * @param {object} SAMPLER_SLOTS from pack-registry
 */
// The slots every video pipeline offers — the canvas, and the length its model is trained for.
const videoSlots = (PROMPT_SLOTS, SAMPLER_SLOTS, maxSeconds = 10) => Object.freeze({
  positive: PROMPT_SLOTS.positive,
  seed: SAMPLER_SLOTS.seed,
  seconds: Object.freeze({ type: 'int', min: 2, max: maxSeconds, default: 5 }),
  aspect: Object.freeze({ type: 'enum', values: Object.freeze(Object.keys(VIDEO_ASPECTS)), default: 'landscape' }),
});

export const buildVideoPipelines = (PROMPT_SLOTS, SAMPLER_SLOTS) => Object.freeze({
  'video.ltx.i2v': Object.freeze({
    id: 'video.ltx.i2v',
    kind: 'video',
    label: 'LTX-2.5 — image to video, with sound',
    description: 'Animates one of YOUR images into a short clip with synchronized sound. Pass the image id as `image` (a render of yours from the forge). Describe the motion, the camera and what is heard; a line in quotes is spoken aloud. 5 seconds by default, 2 to 10. `aspect` landscape (1280x720) or portrait (720x1280, vertical for short-form). The whole house pauses while it renders: about half a minute on a large card. The model\'s licence forbids sexually explicit content, so this pipeline refuses it.',
    template: 'ltxi2v',
    modelId: 'ltx-2.5-22b-distilled',
    requiresSourceImage: true,
    needGB: MIN_ENGINE_VRAM_GB,
    // The LTX-2.x Acceptable Use Policy: […].
    licenceRefuses: Object.freeze(['sexual_explicit']),
    slots: videoSlots(PROMPT_SLOTS, SAMPLER_SLOTS),
  }),
  // The adult-capable video pipeline: Apache-2.0 carries no content ban of its own, so only the
  // platform's law applies here (adult content allowed; minors and the other hard lines never).
  'video.wan.i2v': Object.freeze({
    id: 'video.wan.i2v',
    kind: 'video',
    label: 'Wan 2.2 — image to video (silent, adult-capable)',
    description: 'Animates one of YOUR images into a short SILENT clip. Pass the image id as `image`. Describe the motion and the camera. 2 to 5 seconds (5 by default), `aspect` landscape (1280x720) or portrait (720x1280). Adult content is allowed here under the platform\'s content law; the hard lines (anything involving minors, and the rest of the law) are refused on every pipeline. For speech, use video.ltx.i2v. The whole house pauses while it renders.',
    template: 'wani2v',
    modelId: 'wan-2.2-i2v-14b',
    requiresSourceImage: true,
    needGB: MIN_ENGINE_VRAM_GB,
    // Measured 2026-10-20: a 5 s 1280x720 clip in 128 s with ~8 GB of GPU memory left
    // to the engine; the engine peaked at 40 GB of system RAM (the two 14 GB experts
    // staged off the card). The video gate asks this much free before it says yes.
    ramGB: 40,
    slots: videoSlots(PROMPT_SLOTS, SAMPLER_SLOTS, 5),
  }),
});
