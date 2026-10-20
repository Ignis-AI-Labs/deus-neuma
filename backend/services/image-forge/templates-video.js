/**
 * The video graph — LTX-2.5 image-to-video with synchronized sound. Pure.
 *
 * Copied node for node from ComfyUI v0.41.0's bundled `video_ltx2_5_i2v.json`
 * (prompt enhancer OFF), proven on this rig 2026-10-19 (docs/work/
 * forge-engine-upgrade.md): a half-resolution pass, an x2 latent upscale, then a
 * three-sigma refine, audio sampled jointly as an AV latent and decoded beside
 * the frames. It replaced the LTX-2.3 graph (one checkpoint + distilled LoRA).
 */
import { safePrefix } from './templates.js';

// The bundled recipes also negate "cartoon" — dropped: anime is a register this house makes on purpose.
const LTX_NEGATIVE = 'pc game, console game, video game, childish, ugly';

/**
 * LTX-2.5 image to video — node for node from ComfyUI v0.41.0's bundled
 * `video_ltx2_5_i2v.json` (prompt enhancer OFF). Same two passes as 2.3, but the
 * model parts load SEPARATELY (UNETLoader, CLIPLoader `ltxv`, a VAE for video and
 * one for audio), the distillation is in the weights (no LoRA), both passes
 * sample with euler_ancestral under LTXVDualCFGGuider (video 1, audio 1), and the
 * clip runs at 24 fps. The source is cropped to the canvas first, as in 2.3, so a
 * portrait canvas never receives a stretched landscape still.
 * @param {object} p validated scalars: positive, seed, imageName, width, height,
 *   seconds, filenamePrefix, plus the model's unetName/textEncoderName/
 *   videoVaeName/audioVaeName/upscalerName.
 */
export const buildLtxI2v = (p) => {
  const fps = 24;
  const frames = p.seconds * fps + 1;
  const guider = (positive, negative) => ({ class_type: 'LTXVDualCFGGuider', inputs: { model: ['384', 0], positive, negative, video_cfg: 1, audio_cfg: 1 } });
  return {
    395: { class_type: 'LoadImage', inputs: { image: p.imageName } },
    390: { class_type: 'ResizeImageMaskNode', inputs: { input: ['395', 0], resize_type: 'scale dimensions', 'resize_type.width': p.width, 'resize_type.height': p.height, 'resize_type.crop': 'center', scale_method: 'lanczos' } },
    351: { class_type: 'ResizeImageMaskNode', inputs: { input: ['390', 0], resize_type: 'scale longer dimension', 'resize_type.longer_size': 1536, scale_method: 'lanczos' } },
    350: { class_type: 'LTXVPreprocess', inputs: { image: ['351', 0], img_compression: 18 } },
    384: { class_type: 'UNETLoader', inputs: { unet_name: p.unetName, weight_dtype: 'default' } },
    387: { class_type: 'CLIPLoader', inputs: { clip_name: p.textEncoderName, type: 'ltxv', device: 'default' } },
    385: { class_type: 'VAELoader', inputs: { vae_name: p.videoVaeName } },
    386: { class_type: 'VAELoader', inputs: { vae_name: p.audioVaeName } },
    371: { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: p.upscalerName } },
    364: { class_type: 'CLIPTextEncode', inputs: { clip: ['387', 0], text: p.positive } },
    373: { class_type: 'CLIPTextEncode', inputs: { clip: ['387', 0], text: LTX_NEGATIVE } },
    365: { class_type: 'LTXVConditioning', inputs: { positive: ['364', 0], negative: ['373', 0], frame_rate: fps } },
    356: { class_type: 'EmptyLTXVLatentVideo', inputs: { width: p.width / 2, height: p.height / 2, length: frames, batch_size: 1 } },
    357: { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['385', 0], image: ['350', 0], latent: ['356', 0], strength: 0.7, bypass: false } },
    366: { class_type: 'LTXVEmptyLatentAudio', inputs: { audio_vae: ['386', 0], frames_number: frames, frame_rate: fps, batch_size: 1 } },
    377: { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['357', 0], audio_latent: ['366', 0] } },
    339: { class_type: 'RandomNoise', inputs: { noise_seed: p.seed } },
    352: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler_ancestral' } },
    397: { class_type: 'ManualSigmas', inputs: { sigmas: '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0' } },
    388: guider(['365', 0], ['365', 1]),
    344: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['339', 0], guider: ['388', 0], sampler: ['352', 0], sigmas: ['397', 0], latent_image: ['377', 0] } },
    367: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['344', 0] } },
    348: { class_type: 'LTXVLatentUpsampler', inputs: { samples: ['367', 0], upscale_model: ['371', 0], vae: ['385', 0] } },
    349: { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['385', 0], image: ['350', 0], latent: ['348', 0], strength: 1, bypass: false } },
    340: { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['349', 0], audio_latent: ['367', 1] } },
    338: { class_type: 'RandomNoise', inputs: { noise_seed: 42 } },
    341: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler_ancestral' } },
    396: { class_type: 'ManualSigmas', inputs: { sigmas: '0.85, 0.7250, 0.4219, 0.0' } },
    391: guider(['365', 0], ['365', 1]),
    368: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['338', 0], guider: ['391', 0], sampler: ['341', 0], sigmas: ['396', 0], latent_image: ['340', 0] } },
    369: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['368', 0] } },
    374: { class_type: 'VAEDecodeTiled', inputs: { samples: ['369', 0], vae: ['385', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 16 } },
    358: { class_type: 'LTXVAudioVAEDecode', inputs: { samples: ['369', 1], audio_vae: ['386', 0] } },
    370: { class_type: 'CreateVideo', inputs: { images: ['374', 0], audio: ['358', 0], fps } },
    75: { class_type: 'SaveVideo', inputs: { video: ['370', 0], filename_prefix: safePrefix(p.filenamePrefix), format: 'auto', codec: 'auto' } },
  };
};

// The Wan 2.2 recipe's own negative (bundled `video_wan2_2_14B_i2v.json`), kept verbatim: the
// model was tuned against it. It names quality faults only (over-exposure, blur, static
// frames, extra fingers, malformed hands and faces, cluttered backgrounds) — no content.
const WAN_NEGATIVE = '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走';

/**
 * Wan 2.2 image to video (14B, two experts) — node for node from ComfyUI
 * v0.41.0's bundled `video_wan2_2_14B_i2v.json` with its 4-step lightx2v
 * switch ON: the high-noise expert runs steps 0-2 and hands its leftover noise
 * to the low-noise expert for 2-4, each behind its distillation LoRA and a
 * ModelSamplingSD3 shift of 5, CFG 1, euler/simple. Silent (no audio stream),
 * 16 fps, length = seconds × 16 + 1 (the model's 4k+1 grid). Apache-2.0.
 * @param {object} p validated scalars: positive, seed, imageName, width, height,
 *   seconds, filenamePrefix, plus highNoiseName/lowNoiseName/highLoraName/
 *   lowLoraName/textEncoderName/vaeName.
 */
export const buildWanI2v = (p) => {
  const fps = 16;
  const expert = (unet, lora, at) => ({
    [`${at}0`]: { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' } },
    [`${at}1`]: { class_type: 'LoraLoaderModelOnly', inputs: { model: [`${at}0`, 0], lora_name: lora, strength_model: 1 } },
    [`${at}2`]: { class_type: 'ModelSamplingSD3', inputs: { model: [`${at}1`, 0], shift: 5 } },
  });
  return {
    97: { class_type: 'LoadImage', inputs: { image: p.imageName } },
    99: { class_type: 'ResizeImageMaskNode', inputs: { input: ['97', 0], resize_type: 'scale dimensions', 'resize_type.width': p.width, 'resize_type.height': p.height, 'resize_type.crop': 'center', scale_method: 'lanczos' } },
    ...expert(p.highNoiseName, p.highLoraName, 11),
    ...expert(p.lowNoiseName, p.lowLoraName, 12),
    84: { class_type: 'CLIPLoader', inputs: { clip_name: p.textEncoderName, type: 'wan', device: 'default' } },
    90: { class_type: 'VAELoader', inputs: { vae_name: p.vaeName } },
    93: { class_type: 'CLIPTextEncode', inputs: { clip: ['84', 0], text: p.positive } },
    89: { class_type: 'CLIPTextEncode', inputs: { clip: ['84', 0], text: WAN_NEGATIVE } },
    98: { class_type: 'WanImageToVideo', inputs: { positive: ['93', 0], negative: ['89', 0], vae: ['90', 0], start_image: ['99', 0], width: p.width, height: p.height, length: p.seconds * fps + 1, batch_size: 1 } },
    86: { class_type: 'KSamplerAdvanced', inputs: { model: ['112', 0], add_noise: 'enable', noise_seed: p.seed, steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple', positive: ['98', 0], negative: ['98', 1], latent_image: ['98', 2], start_at_step: 0, end_at_step: 2, return_with_leftover_noise: 'enable' } },
    85: { class_type: 'KSamplerAdvanced', inputs: { model: ['122', 0], add_noise: 'disable', noise_seed: 0, steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple', positive: ['98', 0], negative: ['98', 1], latent_image: ['86', 0], start_at_step: 2, end_at_step: 4, return_with_leftover_noise: 'disable' } },
    87: { class_type: 'VAEDecode', inputs: { samples: ['85', 0], vae: ['90', 0] } },
    94: { class_type: 'CreateVideo', inputs: { images: ['87', 0], fps } },
    108: { class_type: 'SaveVideo', inputs: { video: ['94', 0], filename_prefix: safePrefix(p.filenamePrefix), format: 'auto', codec: 'auto' } },
  };
};
