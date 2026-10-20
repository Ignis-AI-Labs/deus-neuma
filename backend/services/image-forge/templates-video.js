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
