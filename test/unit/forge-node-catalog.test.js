// Every node read in full, found by what it makes or takes, and a registered
// workflow read as a map — from the engine's own description of its nodes
// (test/helpers/comfy-object-info.js, in /object_info's own shape). RULE 0.
import { describe, it, expect } from 'vitest';
import { OBJECT_INFO } from '../helpers/comfy-object-info.js';
import {
  choicesOf, describeInput, describeNode, searchNodes, shapeNode, shapeNodeList, shapeWorkflowMap,
} from '../../backend/services/image-forge/node-catalog.js';
import { checkWorkflowProposal } from '../../backend/services/image-forge/workflow-rules.js';
import { buildFlux3 } from '../../backend/services/image-forge/pipelines-flux3.js';

describe('one input, read out of the engine\'s own spec', () => {
  it('a number with its range, a choice with every option, a text, and a wire', () => {
    expect(describeInput('cfg', OBJECT_INFO.KSampler.input.required.cfg, true)).toEqual({ name: 'cfg', type: 'FLOAT', required: true, wired: false, default: 8, min: 0, max: 100, step: 0.1 });
    expect(describeInput('sampler_name', OBJECT_INFO.KSampler.input.required.sampler_name, true)).toMatchObject({ type: 'CHOICE', wired: false, choices: ['euler', 'res_multistep', 'dpmpp_2m'] });
    expect(describeInput('type', OBJECT_INFO.CLIPLoader.input.required.type, true).choices).toEqual(['flux2', 'flux3', 'sd3']); // the newer ["COMBO", {options}] form
    expect(describeInput('text', OBJECT_INFO.CLIPTextEncode.input.required.text, true)).toMatchObject({ type: 'STRING', wired: false, multiline: true, tooltip: 'The text to be encoded.' });
    expect(describeInput('model', OBJECT_INFO.KSampler.input.required.model, true)).toEqual({ name: 'model', type: 'MODEL', required: true, wired: true });
    expect(choicesOf(['INT', {}])).toBeNull();
    expect(choicesOf(undefined)).toBeNull();
  });
});

describe('one node, whole', () => {
  const sampler = describeNode('KSampler', OBJECT_INFO.KSampler);

  it('every input in the engine\'s own order, every output by number', () => {
    expect(sampler.inputs.map((i) => i.name)).toEqual(['model', 'seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'positive', 'negative', 'latent_image', 'denoise']);
    expect(sampler.outputs).toEqual([{ name: 'LATENT', type: 'LATENT' }]);
    expect(describeNode('CheckpointLoaderSimple', OBJECT_INFO.CheckpointLoaderSimple)).toMatchObject({ title: 'Load Checkpoint', outputs: [{ name: 'MODEL', type: 'MODEL' }, { name: 'CLIP', type: 'CLIP' }, { name: 'VAE', type: 'VAE' }] });
    expect(describeNode('SaveImage', OBJECT_INFO.SaveImage).writes).toBe(true);
    expect(describeNode('FluxProUltraImageNode', OBJECT_INFO.FluxProUltraImageNode).outside).toBe(true);
    expect(describeNode('Nope', undefined)).toBeNull();
  });

  it('reads out with ranges, choices, notes, and which nodes connect to it', () => {
    const text = shapeNode(sampler, OBJECT_INFO);
    expect(text).toContain('KSampler · sampling');
    expect(text).toContain('Uses the provided model, positive and negative conditioning to denoise the latent image.');
    expect(text).toContain('  model — MODEL, required, WIRED from another node\'s output. Made by: UNETLoader, CheckpointLoaderSimple, LoraLoader.'); // by category, then name
    expect(text).toContain('  steps — INT, required, 1 to 10000, default 20');
    expect(text).toContain('      The number of steps used in the denoising process.');
    expect(text).toContain('  cfg — FLOAT, required, 0 to 100, step 0.1, default 8');
    expect(text).toContain('  sampler_name — one of 3 choices, required: "euler", "res_multistep", "dpmpp_2m"');
    expect(text).toContain('  0: LATENT — LATENT. Taken by: SaveLatent, VAEDecode, KSampler.');
    // A node that calls an outside service is never offered as a connection.
    expect(shapeNode(describeNode('SaveImage', OBJECT_INFO.SaveImage), OBJECT_INFO)).toContain('images — IMAGE, required, WIRED from another node\'s output. Made by: LoadImage, ImageScale, VAEDecode.');
  });

  it('a long list of choices is cut with its count, and listed whole on asking', () => {
    const many = { input: { required: { lora_name: [Array.from({ length: 90 }, (_, i) => `lora-${i}.safetensors`), {}] } }, output: [] };
    const node = describeNode('Big', many);
    expect(shapeNode(node, { Big: many })).toContain('… 50 more ({view: "node", node: "Big", choices: "lora_name"} lists all)');
    expect(shapeNode(node, { Big: many }, { choices: 'lora_name' })).toContain('"lora-89.safetensors"');
  });
});

describe('finding nodes', () => {
  it('by words, by what a node makes, by what it takes — never one that calls outside', () => {
    expect(searchNodes(OBJECT_INFO).some((n) => n.name === 'FluxProUltraImageNode')).toBe(false);
    expect(searchNodes(OBJECT_INFO, { find: 'load' }).map((n) => n.name)).toEqual(['UNETLoader', 'LoadImage', 'CheckpointLoaderSimple', 'LoraLoader', 'VAELoader', 'CLIPLoader'].sort((a, b) => {
      const ca = OBJECT_INFO[a].category; const cb = OBJECT_INFO[b].category; return ca.localeCompare(cb) || a.localeCompare(b);
    }));
    expect(searchNodes(OBJECT_INFO, { makes: 'image' }).map((n) => n.name)).toEqual(['LoadImage', 'ImageScale', 'VAEDecode']);
    expect(searchNodes(OBJECT_INFO, { takes: 'CLIP' }).map((n) => n.name)).toEqual(['CLIPTextEncode', 'LoraLoader']);
    expect(searchNodes(OBJECT_INFO, { find: 'upscale image', makes: 'IMAGE' }).map((n) => n.name)).toEqual(['ImageScale']);
    expect(searchNodes(OBJECT_INFO, { find: 'zzz' })).toEqual([]);
  });

  it('a page of them, one line each, by category', () => {
    const text = shapeNodeList(searchNodes(OBJECT_INFO, { makes: 'LATENT' }), { total: 14, asOf: 'read from the running engine, ComfyUI 0.41.0' });
    expect(text.split('\n')[0]).toBe('3 of the engine\'s 14 nodes (read from the running engine, ComfyUI 0.41.0) — 1–3:');
    expect(text).toContain('latent:\n  EmptyFlux2LatentImage — takes nothing wired; makes LATENT');
    expect(text).toContain('sampling:\n  KSampler — takes MODEL, CONDITIONING, CONDITIONING, LATENT; makes LATENT');
    expect(shapeNodeList([])).toContain('No node matches.');
    expect(shapeNodeList(searchNodes(OBJECT_INFO), { limit: 5 })).toContain('more — page with offset 5.');
  });
});

describe('a registered workflow as a map', () => {
  const { pipeline } = checkWorkflowProposal({
    id: 'custom.sofi-canon', label: 'SOFI-0 canon stills', description: 'FLUX 3 stills for the canon pack. Describe the scene in full sentences.',
    graph: buildFlux3({ positive: 'a placeholder', seed: 1, steps: 8, width: 1024, height: 1024, filenamePrefix: 'x', unetName: 'flux3-image-klein-int8-convrot.safetensors', clipName: 'qwen3vl_4b_int8_convrot.safetensors', clipType: 'flux3', vaeName: 'flux2-vae.safetensors' }),
    slots: { positive: { into: { node: '6', input: 'text' } }, seed: { into: { node: '3', input: 'seed' } }, steps: { type: 'int', min: 4, max: 16, into: { node: '3', input: 'steps' } }, sampler: { type: 'enum', values: ['euler', 'res_multistep'], into: { node: '3', input: 'sampler_name' } } },
  });

  it('every value with what the engine allows there and whether a knob controls it; every wire by the output it carries', () => {
    const text = shapeWorkflowMap(pipeline, OBJECT_INFO);
    expect(text.split('\n')[0]).toBe('custom.sofi-canon — "SOFI-0 canon stills" · 9 nodes');
    expect(text).toContain('3 · KSampler');
    expect(text).toContain('    model ← node 4 (UNETLoader) output 0 MODEL: MODEL');
    expect(text).toContain('    steps = 8 · KNOB steps (4 to 16) · engine allows 1 to 10000, default 20');
    expect(text).toContain('    cfg = 1 · fixed · engine allows 0 to 100, step 0.1, default 8');
    expect(text).toContain('    sampler_name = "euler" · KNOB sampler ("euler" | "res_multistep") · engine allows 3 choices');
    expect(text).toContain('    seed = 1 · KNOB seed (any seed)');
    expect(text).toContain('    text = "a placeholder" · KNOB positive (text, screened)');
    expect(text).toContain('    filename_prefix = "x" · set by the platform on every render');
    expect(text).toContain('    unet_name = "flux3-image-klein-int8-convrot.safetensors" · fixed · engine allows 2 choices');
    expect(text).toContain('KNOBS a caller may turn: positive, seed, steps, sampler.');
    expect(text).toContain('forge/edit-workflow {id: "custom.sofi-canon", edits: [...]}');
  });

  it('without the engine\'s node list the map still reads, and says what is missing', () => {
    const text = shapeWorkflowMap(pipeline, null);
    expect(text.split('\n')[0]).toContain('the engine\'s node list has not been read yet');
    expect(text).toContain('    steps = 8 · KNOB steps (4 to 16)');
    expect(text).toContain('    model ← node 4 (UNETLoader) output 0');
  });
});
