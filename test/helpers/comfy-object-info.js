// A slice of ComfyUI's /object_info, in the exact shape server.py's node_info writes (input.required/optional,
// input_order, output, output_name, output_node, python_module, api_node), for the nodes the workflow tests use.
// Stated by hand because a unit test does not light the engine; the summoned tests read the real one.
const combo = (...options) => [options, {}];
const node = (required, extra = {}) => ({
  input: { required, ...(extra.optional ? { optional: extra.optional } : {}) },
  input_order: { required: Object.keys(required), ...(extra.optional ? { optional: Object.keys(extra.optional) } : {}) },
  output: [], output_name: [], output_node: false, python_module: 'nodes', category: 'sd', display_name: undefined, description: '',
  ...extra,
});

export const OBJECT_INFO = {
  UNETLoader: node({ unet_name: combo('flux3-image-klein-int8-convrot.safetensors', 'flux-2-klein-4b.safetensors'), weight_dtype: combo('default', 'fp8_e4m3fn') }, { output: ['MODEL'], output_name: ['MODEL'], category: 'advanced/loaders', display_name: 'Load Diffusion Model' }),
  CLIPLoader: node({ clip_name: combo('qwen3vl_4b_int8_convrot.safetensors'), type: ['COMBO', { options: ['flux2', 'flux3', 'sd3'] }] }, { output: ['CLIP'], output_name: ['CLIP'], category: 'advanced/loaders' }),
  VAELoader: node({ vae_name: combo('flux2-vae.safetensors') }, { output: ['VAE'], output_name: ['VAE'], category: 'loaders' }),
  CheckpointLoaderSimple: node({ ckpt_name: combo('sd_xl_base_1.0.safetensors', 'Illustrious-XL-v2.0.safetensors') }, { output: ['MODEL', 'CLIP', 'VAE'], output_name: ['MODEL', 'CLIP', 'VAE'], category: 'loaders', display_name: 'Load Checkpoint' }),
  LoraLoader: node({ model: ['MODEL', {}], clip: ['CLIP', {}], lora_name: combo('harbour-style.safetensors', 'ink-wash.safetensors'), strength_model: ['FLOAT', { default: 1.0, min: -100.0, max: 100.0, step: 0.01 }], strength_clip: ['FLOAT', { default: 1.0, min: -100.0, max: 100.0, step: 0.01 }] }, { output: ['MODEL', 'CLIP'], output_name: ['MODEL', 'CLIP'], category: 'loaders', display_name: 'Load LoRA' }),
  CLIPTextEncode: node({ text: ['STRING', { multiline: true, dynamicPrompts: true, tooltip: 'The text to be encoded.' }], clip: ['CLIP', { tooltip: 'The CLIP model used for encoding the text.' }] }, { output: ['CONDITIONING'], output_name: ['CONDITIONING'], category: 'conditioning', display_name: 'CLIP Text Encode (Prompt)' }),
  EmptyFlux2LatentImage: node({ width: ['INT', { default: 1024, min: 16, max: 16384, step: 16 }], height: ['INT', { default: 1024, min: 16, max: 16384, step: 16 }], batch_size: ['INT', { default: 1, min: 1, max: 4096 }] }, { output: ['LATENT'], output_name: ['LATENT'], category: 'latent' }),
  EmptyLatentImage: node({ width: ['INT', { default: 512, min: 16, max: 16384, step: 8 }], height: ['INT', { default: 512, min: 16, max: 16384, step: 8 }], batch_size: ['INT', { default: 1, min: 1, max: 4096 }] }, { output: ['LATENT'], output_name: ['LATENT'], category: 'latent' }),
  KSampler: node({
    model: ['MODEL', {}], seed: ['INT', { default: 0, min: 0, max: 18446744073709552000, control_after_generate: true }],
    steps: ['INT', { default: 20, min: 1, max: 10000, tooltip: 'The number of steps used in the denoising process.' }],
    cfg: ['FLOAT', { default: 8.0, min: 0.0, max: 100.0, step: 0.1, round: 0.01 }],
    sampler_name: combo('euler', 'res_multistep', 'dpmpp_2m'), scheduler: combo('simple', 'normal', 'karras'),
    positive: ['CONDITIONING', {}], negative: ['CONDITIONING', {}], latent_image: ['LATENT', {}],
    denoise: ['FLOAT', { default: 1.0, min: 0.0, max: 1.0, step: 0.01 }],
  }, { output: ['LATENT'], output_name: ['LATENT'], category: 'sampling', description: 'Uses the provided model, positive and negative conditioning to denoise the latent image.' }),
  VAEDecode: node({ samples: ['LATENT', {}], vae: ['VAE', {}] }, { output: ['IMAGE'], output_name: ['IMAGE'], category: 'latent' }),
  ImageScale: node({ image: ['IMAGE', {}], upscale_method: combo('nearest-exact', 'bilinear', 'lanczos'), width: ['INT', { default: 512, min: 0, max: 16384 }], height: ['INT', { default: 512, min: 0, max: 16384 }], crop: combo('disabled', 'center') }, { output: ['IMAGE'], output_name: ['IMAGE'], category: 'image/upscaling', display_name: 'Upscale Image' }),
  SaveImage: node({ images: ['IMAGE', {}], filename_prefix: ['STRING', { default: 'ComfyUI' }] }, { output_node: true, category: 'image', display_name: 'Save Image' }),
  LoadImage: node({ image: [['a.png'], { image_upload: true }] }, { output: ['IMAGE', 'MASK'], output_name: ['IMAGE', 'MASK'], category: 'image', display_name: 'Load Image' }),
  SaveLatent: node({ samples: ['LATENT', {}], filename_prefix: ['STRING', {}] }, { output_node: true, category: '_for_testing' }),
  FluxProUltraImageNode: node({ prompt: ['STRING', {}] }, { api_node: true, python_module: 'comfy_api_nodes.nodes_bfl', output: ['IMAGE'], output_name: ['IMAGE'], category: 'api node/image/BFL' }),
};
