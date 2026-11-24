// A workflow becoming a pipeline: the rules a proposal must pass, what is held
// against the engine's own node list, and the graph one render runs. The graph
// under test is the platform's own FLUX 3 graph (buildFlux3) proposed as if a
// being had written it; the node list is in the shape ComfyUI's /object_info
// gives (server.py node_info), stated here because the engine is not lit for a
// unit test. The screen is the real one over stand-in terms. RULE 0.
import { describe, it, expect } from 'vitest';
import { buildFlux3 } from '../../backend/services/image-forge/pipelines-flux3.js';
import {
  applyWorkflowEdits, buildCustomGraph, checkWorkflowAgainstEngine, checkWorkflowProposal, describeWorkflow, resolveEngineRanges,
} from '../../backend/services/image-forge/workflow-rules.js';
import { parameterize } from '../../backend/services/image-forge/parameterizer.js';
import { compileScreenList } from '../../backend/services/image-forge/prompt-screen.js';
import { OBJECT_INFO } from '../helpers/comfy-object-info.js';

const screenList = compileScreenList({
  classes: { csam: ['zzcsamterm'], age_minor: [], sexual_explicit: ['zzexplicitterm'], sexual_suggestive: [], incest: [], bestiality: [], nonconsent: [] },
  wordClasses: { deaging: [] },
});
const graph = () => buildFlux3({
  positive: 'a placeholder the caller replaces', seed: 1, steps: 8, width: 1024, height: 1024, filenamePrefix: 'whatever/the/being/wrote',
  unetName: 'flux3-image-klein-int8-convrot.safetensors', clipName: 'qwen3vl_4b_int8_convrot.safetensors', clipType: 'flux3', vaeName: 'flux2-vae.safetensors',
});
const proposal = (over = {}) => ({
  id: 'custom.sofi-canon', label: 'SOFI-0 canon stills',
  description: 'FLUX 3 stills for the SOFI-0 canon pack. Describe the scene in full sentences.',
  graph: graph(),
  slots: {
    positive: { into: { node: '6', input: 'text' } },
    seed: { into: { node: '3', input: 'seed' } },
    steps: { type: 'int', min: 4, max: 16, into: { node: '3', input: 'steps' } },
    width: { type: 'enum', values: [768, 1024, 1344], into: { node: '5', input: 'width' } },
    sampler: { type: 'enum', values: ['euler', 'res_multistep'], into: { node: '3', input: 'sampler_name' } },
  },
  ...over,
});
const withNode = (id, node) => { const g = graph(); g[id] = node; return g; };
const errorsOf = (over) => checkWorkflowProposal(proposal(over)).errors ?? [];

describe('a proposal read into a pipeline', () => {
  it('the platform\'s own FLUX 3 graph, proposed with five knobs, becomes a pipeline record', () => {
    const checked = checkWorkflowProposal(proposal());
    expect(checked.ok).toBe(true);
    const p = checked.pipeline;
    expect(p).toMatchObject({ id: 'custom.sofi-canon', kind: 'still', template: 'custom', custom: true, requiresSourceImage: false, saves: ['9'] });
    expect(p.slots).toEqual({
      positive: { type: 'text', required: true, screened: true, polarity: 'positive' },
      seed: { type: 'int', min: 0, max: 4294967295, default: null },
      steps: { type: 'int', min: 4, max: 16, default: 8 },
      width: { type: 'enum', values: [768, 1024, 1344], default: 1024 },
      sampler: { type: 'enum', values: ['euler', 'res_multistep'], default: 'euler' },
    });
    expect(p.files).toEqual([
      { folder: 'diffusion_models', name: 'flux3-image-klein-int8-convrot.safetensors' },
      { folder: 'text_encoders', name: 'qwen3vl_4b_int8_convrot.safetensors' },
      { folder: 'vae', name: 'flux2-vae.safetensors' },
    ]);
    expect(p.literals).toEqual(['simple', 'default', 'flux3']); // settings' names; the written prompt is the knob, the empty negative is nothing
    expect(p.graphSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(describeWorkflow(p)).toBe('9 nodes (KSampler, UNETLoader, EmptyFlux2LatentImage, CLIPTextEncode, VAEDecode, SaveImage, CLIPLoader, VAELoader); loads flux3-image-klein-int8-convrot.safetensors, qwen3vl_4b_int8_convrot.safetensors, flux2-vae.safetensors; a caller may set positive, seed, steps 4–16, width (3 choices), sampler (2 choices)');
  });

  it('a text written into the graph with no knob on it is kept to be screened with every render', () => {
    const g = graph(); g['7'].inputs.text = 'blurry, low quality, extra fingers';
    const { pipeline } = checkWorkflowProposal(proposal({ graph: g }));
    expect(pipeline.literals).toContain('blurry, low quality, extra fingers');
  });

  it('everything wrong is named in one refusal', () => {
    const errors = errorsOf({ id: 'sofi', label: 'x', description: 'short', slots: { steps: { type: 'int', min: 9, max: 2, into: { node: '3', input: 'steps' } } } });
    expect(errors).toEqual([
      'id must be custom.<name>: lowercase letters, digits and dashes, 2 to 41 characters after the dot',
      'label must be 3 to 80 characters: the pipeline\'s name',
      'description must be 20 to 600 characters: what it makes and how to prompt it',
      'slots must include positive: the text a caller writes, e.g. positive: {into: {node: "6", input: "text"}}',
      '\'steps\' needs min and max, min below max (or neither, to take the node\'s own range)',
    ]);
    expect(checkWorkflowProposal(null).errors.at(-1)).toContain('graph must be the workflow in ComfyUI\'s API format');
    expect(errorsOf({ graph: [] })).toHaveLength(1);
  });

  it('a knob can sit on any value written in the graph — but never on a wire or on where a file is written', () => {
    const base = proposal().slots;
    expect(errorsOf({ slots: { ...base, model: { type: 'enum', values: ['a'], into: { node: '3', input: 'model' } } } })[0]).toContain('is wired to another node');
    expect(errorsOf({ slots: { ...base, where: { type: 'enum', values: ['x'], into: { node: '9', input: 'filename_prefix' } } } })[0]).toContain('may not set where a file is written');
    expect(errorsOf({ slots: { ...base, ghost: { type: 'int', min: 1, max: 2, into: { node: '77', input: 'x' } } } })[0]).toContain('which the graph does not have');
    expect(errorsOf({ slots: { ...base, prompt: { type: 'int', min: 1, max: 2, into: { node: '3', input: 'steps' } } } })[0]).toContain('image/generate uses it itself');
    expect(errorsOf({ slots: { ...base, again: { type: 'int', min: 1, max: 20, into: { node: '3', input: 'steps' } } } })[0]).toContain('both set node 3 input \'steps\'');
    expect(errorsOf({ slots: { ...base, cfg: { type: 'float', min: 2, max: 9, into: { node: '3', input: 'cfg' } } } })[0]).toContain('its default (1) is not between 2 and 9');
    expect(errorsOf({ slots: { ...base, cfg: { type: 'float', min: 9, into: { node: '3', input: 'cfg' } } } })[0]).toContain('needs min and max, min below max (or neither');

    // Every kind of variable: a model file among the engine's own, a second text, a true/false, a number on the node's own range.
    const all = checkWorkflowProposal(proposal({ slots: {
      ...base,
      unet: { type: 'enum', values: ['flux3-image-klein-int8-convrot.safetensors', 'flux-2-klein-4b.safetensors'], into: { node: '4', input: 'unet_name' } },
      style: { type: 'text', into: { node: '7', input: 'text' } },
      cfg: { type: 'float', into: { node: '3', input: 'cfg' } },
      scheduler: { type: 'enum', values: ['simple', 'normal'], into: { node: '3', input: 'scheduler' } },
    } }));
    expect(all.ok).toBe(true);
    expect(all.pipeline.slots.unet).toEqual({ type: 'enum', values: ['flux3-image-klein-int8-convrot.safetensors', 'flux-2-klein-4b.safetensors'], default: 'flux3-image-klein-int8-convrot.safetensors' });
    expect(all.pipeline.slots.style).toEqual({ type: 'text', required: false, screened: true, polarity: 'positive', default: '' });
    expect(all.pipeline.slots.cfg).toEqual({ type: 'float', engineRange: true, default: 1 });
    expect(all.pipeline.files.map((f) => f.name)).toEqual(['qwen3vl_4b_int8_convrot.safetensors', 'flux2-vae.safetensors']); // the unet is now the knob's
    expect(describeWorkflow(all.pipeline)).toContain('cfg (the node\'s own range)');
  });

  it('only SaveImage writes, and an image is read only through the one named door', () => {
    const noSave = graph(); delete noSave['9'];
    expect(errorsOf({ graph: noSave })).toContain('the graph must end in a SaveImage node: that is the picture the platform collects');
    expect(errorsOf({ graph: withNode('50', { class_type: 'SaveLatent', inputs: { samples: ['3', 0], filename_prefix: 'x' } }) })[0]).toContain("node 50: 'SaveLatent' is not a drawing class the platform allows in a registered workflow");
    const reads = withNode('60', { class_type: 'LoadImage', inputs: { image: 'someone-elses.png' } });
    expect(errorsOf({ graph: reads })[0]).toContain('a workflow may read ONE image, through a LoadImage node named as source');
    const edit = checkWorkflowProposal(proposal({ graph: reads, source: { node: '60', input: 'image' } }));
    expect(edit.ok).toBe(true);
    expect(edit.pipeline).toMatchObject({ requiresSourceImage: true, sourceBind: { node: '60', input: 'image' } });
    expect(edit.pipeline.literals).not.toContain('someone-elses.png'); // the door's placeholder is not a text
    expect(errorsOf({ graph: reads, source: { node: '6', input: 'text' } })).toContain('source must name a LoadImage node and its \'image\' input');
    const broken = graph(); broken['3'].inputs.model = ['99', 0]; broken['3'].inputs.extra = { nested: true };
    expect(errorsOf({ graph: broken })).toEqual(['node 3 input \'model\' is wired to node 99, which the graph does not have', 'node 3 input \'extra\' must be a value or a wire [node, output]']);
  });
});

describe('held against the engine\'s own node list', () => {
  const { pipeline } = checkWorkflowProposal(proposal());

  it('a workflow whose every node, choice and model file the engine has is accepted', () => {
    expect(checkWorkflowAgainstEngine(pipeline, OBJECT_INFO)).toEqual({ ok: true });
  });

  it('a missing model file, an unknown node, an unoffered choice and a missing input are each named', () => {
    const g = graph();
    g['4'].inputs.unet_name = 'not-installed.safetensors';
    g['40'].inputs.type = 'flux9';
    g['20'] = { class_type: 'SomeCustomNode', inputs: {} };
    expect(errorsOf({ graph: g })).toContain("node 20: 'SomeCustomNode' is not a drawing class the platform allows in a registered workflow");
    delete g['20'];
    delete g['8'].inputs.vae;
    const made = checkWorkflowProposal(proposal({ graph: g }));
    expect(checkWorkflowAgainstEngine(made.pipeline, OBJECT_INFO).errors).toEqual([
      'node 4: the engine does not have the model file \'not-installed.safetensors\' — install it first (forge/install-model), then register',
      'node 8 (VAEDecode) lacks its required input \'vae\'',
      'node 40 input \'type\': \'flux9\' is not a choice this engine offers',
    ]);
  });

  it('a number outside its node\'s own range, a knob that reaches past it, and a knob offering a file the engine lacks are each named', () => {
    const g = graph(); g['3'].inputs.denoise = 4;
    const made = checkWorkflowProposal(proposal({ graph: g, slots: {
      ...proposal().slots,
      cfg: { type: 'float', min: 0, max: 500, into: { node: '3', input: 'cfg' } },
      unet: { type: 'enum', values: ['flux3-image-klein-int8-convrot.safetensors', 'not-here.safetensors'], into: { node: '4', input: 'unet_name' } },
    } }));
    expect(checkWorkflowAgainstEngine(made.pipeline, OBJECT_INFO).errors).toEqual([
      'knob cfg runs 0 to 500, wider than node 3 input \'cfg\' allows (0 to 100)',
      'node 3 input \'denoise\': 4 is outside the node\'s own range (0 to 1)',
      'node 4 (knob unet): the engine does not have the model file \'not-here.safetensors\' — install it first (forge/install-model), then register',
    ]);
  });

  it('a knob that named no range takes the node\'s own, written into what is kept', () => {
    const open = proposal({ slots: { ...proposal().slots, cfg: { type: 'float', into: { node: '3', input: 'cfg' } }, steps: { type: 'int', into: { node: '3', input: 'steps' } } } });
    const ranged = resolveEngineRanges(open, OBJECT_INFO);
    expect(ranged.ok).toBe(true);
    expect(ranged.proposal.slots.cfg).toMatchObject({ min: 0, max: 100 });
    expect(ranged.proposal.slots.steps).toMatchObject({ min: 1, max: 10000 });
    expect(checkWorkflowProposal(ranged.proposal).pipeline.slots.cfg).toEqual({ type: 'float', min: 0, max: 100, default: 1 });
    expect(open.slots.cfg.min).toBeUndefined(); // the filing is not written to
    const none = resolveEngineRanges(proposal({ slots: { ...proposal().slots, mystery: { type: 'int', into: { node: '9', input: 'images' } } } }), OBJECT_INFO);
    expect(none.errors[0]).toContain('declares no range of its own — give the knob min and max');
  });

  it('PR20 M-18: WebcamCapture and wired, non-primitive knobs are refused', () => {
    const webcam = withNode('60', { class_type: 'WebcamCapture', inputs: { image: 'input' } });
    expect(errorsOf({ graph: webcam })).toContain("node 60: 'WebcamCapture' is not a drawing class the platform allows in a registered workflow");
    const wired = withNode('50', { class_type: 'LoraLoader', inputs: { model: 'x.safetensors', strength_model: 1 } });
    const made = checkWorkflowProposal(proposal({ graph: wired, slots: { positive: { into: { node: '6', input: 'text' } }, bad: { type: 'text', into: { node: '50', input: 'model' } } } }));
    expect(checkWorkflowAgainstEngine(made.pipeline, OBJECT_INFO).errors).toContain("knob bad points at node 50 input 'model', which is wired: a knob may set only a primitive value");
  });

  it('a node that sends work to an outside service is refused, whatever it is called', () => {
    const made = checkWorkflowProposal(proposal({ graph: withNode('70', { class_type: 'KSampler', inputs: { seed: 1, steps: 1, cfg: 1, denoise: 1, sampler_name: 'euler', scheduler: 'simple', positive: ['6', 0], negative: ['7', 0], model: ['4', 0], latent_image: ['5', 0] } }) }));
    made.pipeline.graph['70'].class_type = 'FluxProUltraImageNode';
    expect(checkWorkflowAgainstEngine(made.pipeline, OBJECT_INFO).errors).toEqual(['node 70: \'FluxProUltraImageNode\' sends work to an outside service — a registered workflow runs on this machine only']);
  });

  it('a workflow that reads an image is not held to the engine\'s list of images at its one door', () => {
    const made = checkWorkflowProposal(proposal({ graph: withNode('60', { class_type: 'LoadImage', inputs: { image: 'placeholder.png' } }), source: { node: '60', input: 'image' } }));
    expect(checkWorkflowAgainstEngine(made.pipeline, OBJECT_INFO)).toEqual({ ok: true });
  });
});

describe('the graph one render runs', () => {
  const { pipeline } = checkWorkflowProposal(proposal());
  const model = { id: pipeline.id, files: pipeline.files };
  const render = (args) => parameterize({ pipeline, model, args, jobId: 'job-abc123', screenList, fallbackSeed: 77 });

  it('each knob lands where it was declared, the platform names the file, and nothing else moves', () => {
    const built = render({ positive: 'a lighthouse keeper at dusk', steps: 12, width: 1344, sampler: 'res_multistep' });
    expect(built.ok).toBe(true);
    const g = built.graph;
    expect(g['6'].inputs.text).toBe('a lighthouse keeper at dusk');
    expect(g['3'].inputs).toMatchObject({ seed: 77, steps: 12, sampler_name: 'res_multistep', cfg: 1, scheduler: 'simple' });
    expect(g['5'].inputs).toMatchObject({ width: 1344, height: 1024 });
    expect(g['9'].inputs.filename_prefix).toBe('neuma/job-abc123');
    expect(g['4'].inputs.unet_name).toBe('flux3-image-klein-int8-convrot.safetensors');
    // The registered graph itself is never written to.
    expect(pipeline.graph['6'].inputs.text).toBe('a placeholder the caller replaces');
    expect(built.values).toMatchObject({ positive: 'a lighthouse keeper at dusk', seed: 77, steps: 12 });
  });

  it('a knob is clamped to its range, an unknown knob is refused by name, a named seed is kept', () => {
    expect(render({ positive: 'x', steps: 400 }).graph['3'].inputs.steps).toBe(16);
    expect(render({ positive: 'x', seed: 5 }).graph['3'].inputs.seed).toBe(5);
    expect(render({ positive: 'x', cfg: 9 }).error).toBe('unknown parameter for \'custom.sofi-canon\': cfg — accepted: positive, seed, steps, width, sampler');
    expect(render({ positive: 'x', width: 999 }).error).toBe('\'width\' must be one of: 768, 1024, 1344');
    expect(render({}).error).toBe('\'positive\' is required for \'custom.sofi-canon\'');
  });

  it('the content law reads the caller\'s prompt AND the text written into the workflow, on every render', () => {
    expect(render({ positive: 'a zzcsamterm scene' })).toMatchObject({ ok: false, refusalClass: 'csam' });
    const g = graph(); g['7'].inputs.text = 'zzcsamterm';
    const baked = checkWorkflowProposal(proposal({ graph: g })).pipeline;
    const refused = parameterize({ pipeline: baked, model, args: { positive: 'a quiet harbour at dawn' }, jobId: 'job-abc123', screenList, fallbackSeed: 1 });
    expect(refused).toMatchObject({ ok: false, error: 'refused by content law', refusalClass: 'csam' }); // one bare word, no knob on it
  });

  it('a workflow that edits receives the caller\'s own image at its door, and refuses without one', () => {
    const g = graph(); g['60'] = { class_type: 'LoadImage', inputs: { image: 'placeholder.png' } };
    const edit = checkWorkflowProposal(proposal({ graph: g, source: { node: '60', input: 'image' } })).pipeline;
    expect(buildCustomGraph(edit, { positive: 'x', seed: 1 }, { filenamePrefix: 'neuma/j', sourceImageName: 'uploaded_00001.png' })['60'].inputs.image).toBe('uploaded_00001.png');
    expect(parameterize({ pipeline: edit, model, args: { positive: 'x' }, jobId: 'job-abc123', screenList, fallbackSeed: 1, sourceLineage: 'a harbour' }).error).toBe('\'custom.sofi-canon\' needs a source image — upload one first');
    expect(() => buildCustomGraph(edit, { positive: 'x' }, { filenamePrefix: '../escape' })).toThrow(/non-escaping/);
  });
});

describe('a registered workflow changed in place', () => {
  const kept = proposal();
  const edit = (...edits) => applyWorkflowEdits(kept, edits);

  it('one small change at a time: a value, a knob on it, a new node wired in, an old wire moved', () => {
    const done = edit(
      { op: 'set', node: '3', input: 'cfg', value: 3.5 },
      { op: 'knob', name: 'cfg', type: 'float', min: 1, max: 6, into: { node: '3', input: 'cfg' } },
      { op: 'add', node: '20', class_type: 'ImageScale', inputs: { image: ['8', 0], upscale_method: 'lanczos', width: 2048, height: 2048, crop: 'disabled' } },
      { op: 'wire', node: '9', input: 'images', from: ['20', 0] },
      { op: 'knob', name: 'upscaleTo', type: 'enum', values: [1536, 2048], into: [{ node: '20', input: 'width' }, { node: '20', input: 'height' }] },
      { op: 'unknob', name: 'sampler' },
      { op: 'describe', description: 'FLUX 3 stills for the canon pack, upscaled. Describe the scene in full sentences.' },
    );
    expect(done.ok).toBe(true);
    expect(done.said).toEqual([
      'node 3 (KSampler) cfg: 1 → 3.5',
      'knob cfg added → node 3 input \'cfg\' (1 to 6)',
      'new node 20: ImageScale',
      'node 9 (SaveImage) images ← node 20 (ImageScale) output 0',
      'knob upscaleTo added → node 20 input \'width\', node 20 input \'height\' (2 choices)',
      'knob sampler removed (its value stays as written)',
      'name or description rewritten',
    ]);
    const checked = checkWorkflowProposal(done.proposal);
    expect(checked.ok).toBe(true);
    expect(checkWorkflowAgainstEngine(checked.pipeline, OBJECT_INFO)).toEqual({ ok: true });
    expect(Object.keys(checked.pipeline.slots)).toEqual(['positive', 'seed', 'steps', 'width', 'cfg', 'upscaleTo']);
    // One knob, two places: the render sets both.
    const built = buildCustomGraph(checked.pipeline, { positive: 'x', seed: 1, cfg: 4, upscaleTo: 1536 }, { filenamePrefix: 'neuma/j' });
    expect(built['20'].inputs).toMatchObject({ width: 1536, height: 1536, image: ['8', 0] });
    expect(built['3'].inputs.cfg).toBe(4);
    expect(built['9'].inputs.images).toEqual(['20', 0]);
    expect(kept.graph['3'].inputs.cfg).toBe(1); // what was kept is not written to until the yes
  });

  it('a node is removed only once nothing takes its output; its knobs go with it', () => {
    expect(edit({ op: 'remove', node: '5' }).errors).toEqual(['edit 1 (remove): node 3 still takes its output — rewire it first']);
    const swapped = edit(
      { op: 'add', node: '30', class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
      { op: 'wire', node: '3', input: 'latent_image', from: ['30', 0] },
      { op: 'remove', node: '5' },
    );
    expect(swapped.ok).toBe(true);
    expect(swapped.said.slice(-2)).toEqual(['node 5 (EmptyFlux2LatentImage) removed', 'knob width went with it']);
    expect(swapped.proposal.graph['5']).toBeUndefined();
    expect(swapped.proposal.slots.width).toBeUndefined();
  });

  it('every edit that cannot be applied is named by its number, and an edit can never slip past the rules', () => {
    expect(edit({ op: 'set', node: '99', input: 'x', value: 1 }, { op: 'wire', node: '3', input: 'model', from: ['404', 0] }, { op: 'add', node: '3', class_type: 'KSampler' }, { op: 'paint' }).errors).toEqual([
      'edit 1 (set): the graph has no node 99',
      'edit 2 (wire): from must be [an existing node id, output number]',
      'edit 3 (add): node id 3 is already in the graph: a new node needs a new id',
      'edit 4: op must be one of set, wire, unset, add, remove, knob, unknob, source, describe',
    ]);
    expect(applyWorkflowEdits(kept, []).errors[0]).toContain('edits must be a list of 1 to 100 changes');
    // Applied cleanly, refused by the same rules a new workflow meets.
    const second = edit({ op: 'add', node: '50', class_type: 'SaveLatent', inputs: { samples: ['3', 0], filename_prefix: 'x' } });
    expect(checkWorkflowProposal(second.proposal).errors[0]).toContain("node 50: 'SaveLatent' is not a drawing class the platform allows in a registered workflow");
    const unknobbed = edit({ op: 'unknob', name: 'positive' });
    expect(checkWorkflowProposal(unknobbed.proposal).errors[0]).toContain('slots must include positive');
    const door = edit({ op: 'add', node: '60', class_type: 'LoadImage', inputs: { image: 'x.png' } }, { op: 'source', node: '60', input: 'image' });
    expect(checkWorkflowProposal(door.proposal).pipeline.requiresSourceImage).toBe(true);
    expect(checkWorkflowProposal(applyWorkflowEdits(door.proposal, [{ op: 'source', none: true }]).proposal).errors[0]).toContain('may read ONE image');
  });
});
