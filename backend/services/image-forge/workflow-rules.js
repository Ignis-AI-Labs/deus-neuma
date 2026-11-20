/**
 * WORKFLOW RULES — what a workflow must be before it becomes a pipeline.
 *
 * A being could render only through pipelines written into the platform's own
 * code. Now it can PROPOSE one: a ComfyUI workflow (the engine's own API
 * format), the knobs a caller may turn, and where each knob lands in the graph.
 * Its operator says yes once; from then on it is a pipeline like any other
 * (Design note, 2026-11-20: […]).
 *
 * A raw "submit this graph" door would skip the two things every render must
 * pass, so a registered workflow keeps both:
 *
 *   THE CONTENT LAW — every caller text is screened on every render, and so is
 *   every text written into the workflow itself (a prompt baked into the graph
 *   is still a prompt).
 *
 *   THE LIMITS — a caller may set only the declared knobs, each inside its
 *   declared range; everything else in the graph is fixed at registration.
 *
 * And three things the platform never hands to a workflow: where the file is
 * written (the platform names it), which image is read (only the caller's own
 * render, through the one declared door), and the network (no node that calls
 * an outside service).
 *
 * Pure throughout. The engine's node list is handed in (workflow-store.js and
 * the intent do the reads).
 */
import { createHash } from 'crypto';
import { safePrefix } from './templates.js';
import { choicesOf, describeInput } from './node-catalog.js';

export const WORKFLOW_ID = /^custom\.[a-z0-9][a-z0-9-]{1,40}$/;
export const MAX_NODES = 200;
export const MAX_GRAPH_BYTES = 200_000;
/** Names image/generate itself reads, so no knob may take them. */
const TAKEN = new Set(['prompt', 'pipeline', 'image', 'seconds', 'aspect', 'type']);
const SLOT_NAME = /^[a-z][A-Za-z0-9]{0,23}$/;
const MODEL_FILE = /\.(safetensors|gguf|ckpt|pt|pth|bin|sft)$/i;
const FOLDER_BY_INPUT = Object.freeze({
  ckpt_name: 'checkpoints', unet_name: 'diffusion_models', clip_name: 'text_encoders', vae_name: 'vae', lora_name: 'loras',
  control_net_name: 'controlnet', clip_vision_name: 'clip_vision',
});
const SEED_MAX = 4294967295;

const isLink = (v) => Array.isArray(v) && v.length === 2 && (typeof v[0] === 'string' || typeof v[0] === 'number') && Number.isInteger(v[1]);
const isLiteral = (v) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const bindsOf = (spec) => (Array.isArray(spec?.into) ? spec.into : spec?.into ? [spec.into] : []);
const at = (b) => `node ${b?.node} input '${b?.input}'`;

// One declared knob → the slot the platform enforces, or the reason it cannot be one.
const slotOf = (name, spec, graph) => {
  const binds = bindsOf(spec);
  if (binds.length === 0) return { error: `'${name}' names no place in the graph: give it into: {node, input}` };
  for (const b of binds) {
    const node = graph[String(b?.node)];
    if (!node || typeof b?.input !== 'string' || !Object.prototype.hasOwnProperty.call(node.inputs, b.input)) return { error: `'${name}' points at ${at(b)}, which the graph does not have` };
    if (!isLiteral(node.inputs[b.input])) return { error: `'${name}' points at ${at(b)}, which is wired to another node: a knob can only set a value written in the graph` };
    if (b.input === 'filename_prefix') return { error: `'${name}' may not set where a file is written: the platform names every output` };
  }
  const into = binds.map((b) => ({ node: String(b.node), input: b.input }));
  const written = graph[into[0].node].inputs[into[0].input];
  if (name === 'positive' || name === 'negative' || spec.type === 'text') {
    if (into.some((b) => typeof graph[b.node].inputs[b.input] !== 'string')) return { error: `'${name}' must point at a text input` };
    // Every text a caller writes is screened. `negative` alone is read as what to keep OUT of the picture.
    if (name === 'positive') return { slot: { type: 'text', required: true, screened: true, polarity: 'positive' }, into };
    return { slot: { type: 'text', required: false, screened: true, polarity: name === 'negative' ? 'negative' : 'positive', default: name === 'negative' ? '' : written }, into };
  }
  if (name === 'seed') return { slot: { type: 'int', min: 0, max: SEED_MAX, default: null }, into };
  if (spec.type === 'enum') {
    const values = Array.isArray(spec.values) ? spec.values : [];
    if (values.length < 1 || values.length > 60 || !values.every((v) => typeof v === 'string' || typeof v === 'boolean' || Number.isFinite(v))) return { error: `'${name}' needs values: 1 to 60 words, numbers or true/false` };
    const fallback = spec.default ?? written;
    if (!values.includes(fallback)) return { error: `'${name}': its default (${JSON.stringify(fallback)}) is not one of its values` };
    return { slot: { type: 'enum', values: [...values], default: fallback }, into };
  }
  if (spec.type === 'int' || spec.type === 'float') {
    const fallback = Number.isFinite(spec.default) ? spec.default : written;
    if (!Number.isFinite(fallback)) return { error: `'${name}': the value it would set (${JSON.stringify(fallback)}) is not a number` };
    // No range given: the node's own range is taken from the engine when the workflow is kept.
    if (spec.min === undefined && spec.max === undefined) return { slot: { type: spec.type, engineRange: true, default: fallback }, into };
    const { min, max } = spec;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return { error: `'${name}' needs min and max, min below max (or neither, to take the node's own range)` };
    if (fallback < min || fallback > max) return { error: `'${name}': its default (${JSON.stringify(fallback)}) is not between ${min} and ${max}` };
    return { slot: { type: spec.type, min, max, default: fallback }, into };
  }
  return { error: `'${name}' needs a type: text, int, float or enum` };
};

/**
 * Read a proposal into a pipeline record, or say everything wrong with it at
 * once (one refusal, one fix). Pure.
 *
 * @param {{id:string, label:string, description:string, graph:Object,
 *   slots:Object<string,{type?:string, into:(Object|Object[]), min?:number, max?:number, values?:Array, default?:any}>, - a
 *   knob may sit on ANY value written in the graph: a number (with a range, or the node's own), a choice (a model
 *   file among them), a true/false, or a text (screened on every render). Never on a wire or a file's place.
 *   source?:{node:(string|number), input:string}}} proposal
 * @returns {{ok:true, pipeline:Object}|{ok:false, errors:string[]}}
 */
export const checkWorkflowProposal = (proposal) => {
  const errors = [];
  const { id, label, description, graph, slots, source } = proposal && typeof proposal === 'object' ? proposal : {};
  if (typeof id !== 'string' || !WORKFLOW_ID.test(id)) errors.push('id must be custom.<name>: lowercase letters, digits and dashes, 2 to 41 characters after the dot');
  if (typeof label !== 'string' || label.trim().length < 3 || label.trim().length > 80) errors.push('label must be 3 to 80 characters: the pipeline\'s name');
  if (typeof description !== 'string' || description.trim().length < 20 || description.trim().length > 600) errors.push('description must be 20 to 600 characters: what it makes and how to prompt it');
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return { ok: false, errors: [...errors, 'graph must be the workflow in ComfyUI\'s API format: {"<node id>": {class_type, inputs}, …}'] };
  const ids = Object.keys(graph);
  if (ids.length < 2 || ids.length > MAX_NODES) errors.push(`the graph must have 2 to ${MAX_NODES} nodes (it has ${ids.length})`);
  if (JSON.stringify(graph).length > MAX_GRAPH_BYTES) errors.push(`the graph is over ${MAX_GRAPH_BYTES / 1000} KB`);
  for (const nodeId of ids) {
    const node = graph[nodeId];
    if (!node || typeof node.class_type !== 'string' || !/^[\w .+-]{1,80}$/.test(node.class_type) || !node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs)) {
      errors.push(`node ${nodeId} must be {class_type, inputs}`);
      continue;
    }
    for (const [input, value] of Object.entries(node.inputs)) {
      if (isLink(value)) { if (!Object.prototype.hasOwnProperty.call(graph, String(value[0]))) errors.push(`node ${nodeId} input '${input}' is wired to node ${value[0]}, which the graph does not have`); }
      else if (!isLiteral(value)) errors.push(`node ${nodeId} input '${input}' must be a value or a wire [node, output]`);
    }
  }
  // A graph that is not well formed cannot be read any further; a wrong name or label can.
  if (errors.some((e) => /^node |^the graph/.test(e))) return { ok: false, errors };

  const classOf = (nodeId) => graph[nodeId].class_type;
  const saves = ids.filter((n) => classOf(n) === 'SaveImage');
  if (saves.length === 0) errors.push('the graph must end in a SaveImage node: that is the picture the platform collects');
  const otherOutputs = ids.filter((n) => /^(Save|Preview)/.test(classOf(n)) && classOf(n) !== 'SaveImage');
  if (otherOutputs.length) errors.push(`only SaveImage may write: remove ${[...new Set(otherOutputs.map(classOf))].join(', ')} (a registered workflow makes stills; video stays with the built-in pipelines for now)`);
  const loads = ids.filter((n) => /^LoadImage/.test(classOf(n)));
  const door = source ? { node: String(source.node), input: source.input } : null;
  if (door && !(graph[door.node] && classOf(door.node) === 'LoadImage' && door.input === 'image')) errors.push('source must name a LoadImage node and its \'image\' input');
  if (loads.some((n) => classOf(n) !== 'LoadImage' || !door || n !== door.node)) errors.push('a workflow may read ONE image, through a LoadImage node named as source: {node, input: "image"} — the caller\'s own render is put there');

  const declared = slots && typeof slots === 'object' && !Array.isArray(slots) ? slots : {};
  if (!declared.positive) errors.push('slots must include positive: the text a caller writes, e.g. positive: {into: {node: "6", input: "text"}}');
  const outSlots = {};
  const binds = {};
  const claimed = new Map();
  for (const [name, spec] of Object.entries(declared)) {
    if (!SLOT_NAME.test(name) || TAKEN.has(name)) { errors.push(`'${name}' cannot be a knob's name${TAKEN.has(name) ? ' (image/generate uses it itself)' : ': letters and digits, starting lowercase, up to 24'}`); continue; }
    const made = slotOf(name, spec, graph);
    if (made.error) { errors.push(made.error); continue; }
    for (const b of made.into) {
      const key = `${b.node}\u0000${b.input}`;
      if (claimed.has(key)) errors.push(`'${name}' and '${claimed.get(key)}' both set ${at(b)}`);
      claimed.set(key, name);
    }
    outSlots[name] = made.slot;
    binds[name] = made.into;
  }
  if (errors.length) return { ok: false, errors };

  // Every word left written in the graph (a prompt, a style, even a setting's name): a caller cannot change
  // it, so it is screened as part of every render. Model file names are held against the engine instead.
  const literals = [];
  const files = [];
  for (const nodeId of ids) {
    for (const [input, value] of Object.entries(graph[nodeId].inputs)) {
      if (typeof value !== 'string' || claimed.has(`${nodeId}\u0000${input}`) || input === 'filename_prefix') continue;
      if (door && nodeId === door.node && input === door.input) continue;
      if (MODEL_FILE.test(value)) { files.push({ folder: FOLDER_BY_INPUT[input] ?? null, name: value, node: nodeId, input }); continue; }
      if (value.trim()) literals.push(value);
    }
  }
  return {
    ok: true,
    pipeline: {
      id, kind: 'still', label: label.trim(), description: description.trim(), template: 'custom', custom: true, modelId: null,
      requiresSourceImage: Boolean(door), graph, binds, sourceBind: door, saves, slots: outSlots, literals,
      files: files.map(({ folder, name }) => ({ folder, name })).filter((f, i, all) => all.findIndex((x) => x.name === f.name && x.folder === f.folder) === i),
      graphSha256: createHash('sha256').update(JSON.stringify(graph)).digest('hex'),
    },
  };
};

/**
 * Hold a workflow against the engine's own node list (/object_info): every
 * node is one the engine has, none calls an outside service, nothing but
 * SaveImage writes, every required input is there, every choice — a model
 * file above all — is one the engine actually offers, and every number (and
 * every knob's reach) sits inside the node's own range. Pure.
 * @param {Object} pipeline - from checkWorkflowProposal
 * @param {Object} objectInfo - the engine's /object_info body
 * @returns {{ok:true}|{ok:false, errors:string[]}}
 */
export const checkWorkflowAgainstEngine = (pipeline, objectInfo) => {
  const errors = [];
  const knobAt = new Map();
  for (const [name, into] of Object.entries(pipeline.binds)) for (const b of into) knobAt.set(`${b.node}\u0000${b.input}`, name);
  for (const [nodeId, node] of Object.entries(pipeline.graph)) {
    const info = objectInfo?.[node.class_type];
    if (!info) { errors.push(`node ${nodeId}: this engine has no node '${node.class_type}' (it runs with no custom nodes)`); continue; }
    if (info.api_node === true || String(info.python_module || '').includes('comfy_api_nodes')) { errors.push(`node ${nodeId}: '${node.class_type}' sends work to an outside service — a registered workflow runs on this machine only`); continue; }
    if (info.output_node === true && node.class_type !== 'SaveImage') errors.push(`node ${nodeId}: '${node.class_type}' writes its own output — only SaveImage may`);
    for (const required of Object.keys(info.input?.required || {})) {
      if (!Object.prototype.hasOwnProperty.call(node.inputs, required)) errors.push(`node ${nodeId} (${node.class_type}) lacks its required input '${required}'`);
    }
    const specs = { ...(info.input?.required || {}), ...(info.input?.optional || {}) };
    for (const [input, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value)) continue;
      if (pipeline.sourceBind && nodeId === pipeline.sourceBind.node && input === pipeline.sourceBind.input) continue;
      const options = choicesOf(specs[input]);
      const refuse = (v, who) => errors.push(MODEL_FILE.test(String(v))
        ? `node ${nodeId}${who}: the engine does not have the model file '${v}' — install it first (forge/install-model), then register`
        : `node ${nodeId} input '${input}'${who}: '${v}' is not a choice this engine offers`);
      const knob = knobAt.get(`${nodeId}\u0000${input}`);
      const slot = knob ? pipeline.slots[knob] : null;
      if (options) {
        if (!options.includes(value)) refuse(value, '');
        // A knob over choices may only offer choices the engine has — a model file above all.
        for (const v of slot?.type === 'enum' ? slot.values : []) if (!options.includes(v)) refuse(v, ` (knob ${knob})`);
        continue;
      }
      // A number must sit inside the node's own range, and so must every value its knob can reach.
      const about = specs[input] ? describeInput(input, specs[input], true) : null;
      if (about && typeof value === 'number') {
        const outside = (n) => (Number.isFinite(about.min) && n < about.min) || (Number.isFinite(about.max) && n > about.max);
        if (outside(value)) errors.push(`node ${nodeId} input '${input}': ${value} is outside the node's own range (${about.min} to ${about.max})`);
        if (slot && Number.isFinite(slot.min) && (outside(slot.min) || outside(slot.max))) errors.push(`knob ${knob} runs ${slot.min} to ${slot.max}, wider than node ${nodeId} input '${input}' allows (${about.min} to ${about.max})`);
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
};

/**
 * The graph one render runs: the registered graph, each knob's value put where
 * it was declared, the caller's image at the one door, and every output named
 * by the platform. Nothing else moves. Pure.
 * @param {Object} pipeline
 * @param {Object} values - resolved slot values (seed already minted)
 * @param {{filenamePrefix:string, sourceImageName?:(string|null)}} run
 * @returns {Object}
 */
export const buildCustomGraph = (pipeline, values, { filenamePrefix, sourceImageName = null }) => {
  const graph = JSON.parse(JSON.stringify(pipeline.graph));
  for (const [name, into] of Object.entries(pipeline.binds)) {
    if (values[name] === undefined || values[name] === null) continue;
    for (const b of into) graph[b.node].inputs[b.input] = values[name];
  }
  if (pipeline.sourceBind) graph[pipeline.sourceBind.node].inputs[pipeline.sourceBind.input] = sourceImageName;
  pipeline.saves.forEach((nodeId, i) => {
    graph[nodeId].inputs.filename_prefix = safePrefix(i === 0 ? filenamePrefix : `${filenamePrefix}_${i + 1}`);
  });
  return graph;
};

/** What a registration card tells the operator: the workflow in one sentence. Pure. */
export const describeWorkflow = (pipeline) => {
  const classes = [...new Set(Object.values(pipeline.graph).map((n) => n.class_type))];
  const knobs = Object.entries(pipeline.slots).map(([name, s]) => (s.type === 'text' ? name : s.type === 'enum' ? `${name} (${s.values.length} choices)` : name === 'seed' ? 'seed' : s.engineRange ? `${name} (the node's own range)` : `${name} ${s.min}–${s.max}`));
  return `${Object.keys(pipeline.graph).length} nodes (${classes.join(', ')}); loads ${pipeline.files.length ? pipeline.files.map((f) => f.name).join(', ') : 'no model file by name'}; a caller may set ${knobs.join(', ')}${pipeline.requiresSourceImage ? '; it starts from one of the caller\'s own images' : ''}`;
};

/**
 * Give every numeric knob that named no range the node's own range, read from
 * the engine. Returns a proposal with the ranges written in (that is what is
 * kept), or the knobs whose node declares none. Pure.
 * @param {Object} proposal
 * @param {Object} objectInfo
 * @returns {{ok:true, proposal:Object}|{ok:false, errors:string[]}}
 */
export const resolveEngineRanges = (proposal, objectInfo) => {
  const errors = [];
  const slots = {};
  for (const [name, spec] of Object.entries(proposal.slots || {})) {
    slots[name] = spec;
    if (!(spec?.type === 'int' || spec?.type === 'float') || spec.min !== undefined || spec.max !== undefined || name === 'seed') continue;
    const b = Array.isArray(spec.into) ? spec.into[0] : spec.into;
    const node = proposal.graph?.[String(b?.node)];
    const info = objectInfo?.[node?.class_type];
    const raw = info?.input?.required?.[b?.input] ?? info?.input?.optional?.[b?.input];
    const about = raw ? describeInput(b.input, raw, true) : null;
    if (!about || !Number.isFinite(about.min) || !Number.isFinite(about.max)) { errors.push(`knob ${name}: node ${b?.node} input '${b?.input}' declares no range of its own — give the knob min and max`); continue; }
    slots[name] = { ...spec, min: about.min, max: about.max };
  }
  return errors.length ? { ok: false, errors } : { ok: true, proposal: { ...proposal, slots } };
};

const EDIT_OPS = Object.freeze(['set', 'wire', 'unset', 'add', 'remove', 'knob', 'unknob', 'source', 'describe']);

/**
 * Apply a list of edits to a workflow, in order, on a copy. Each edit is one
 * small change; the result is then held to every rule a new workflow is
 * (checkWorkflowProposal), so no edit can make something registration would
 * have refused. Pure.
 *
 *   {op: "set", node, input, value}          a value written in the graph
 *   {op: "wire", node, input, from: [node, output]}
 *   {op: "unset", node, input}               drop an optional input
 *   {op: "add", node, class_type, inputs}    a new node under a new id
 *   {op: "remove", node}                     refused while anything is wired from it
 *   {op: "knob", name, into, type?, min?, max?, values?, default?}   add or change a knob
 *   {op: "unknob", name}
 *   {op: "source", node, input} | {op: "source", none: true}
 *   {op: "describe", label?, description?}
 *
 * @param {Object} proposal - a stored proposal
 * @param {Array<Object>} edits
 * @returns {{ok:true, proposal:Object, said:string[]}|{ok:false, errors:string[]}}
 */
export const applyWorkflowEdits = (proposal, edits) => {
  if (!Array.isArray(edits) || edits.length === 0 || edits.length > 100) return { ok: false, errors: [`edits must be a list of 1 to 100 changes, each {op: ${EDIT_OPS.join(' | ')}, …}`] };
  const next = JSON.parse(JSON.stringify(proposal));
  next.slots = next.slots || {};
  const errors = [];
  const said = [];
  edits.forEach((e, i) => {
    const n = `edit ${i + 1}`;
    const id = e?.node === undefined ? null : String(e.node);
    const node = id === null ? null : next.graph[id];
    const need = (ok, why) => { if (!ok) errors.push(`${n} (${e?.op}): ${why}`); return ok; };
    switch (e?.op) {
      case 'set':
        if (!need(node, `the graph has no node ${id}`) || !need(typeof e.input === 'string', 'needs input') || !need(isLiteral(e.value), 'value must be a word, a number or true/false')) break;
        said.push(`node ${id} (${node.class_type}) ${e.input}: ${JSON.stringify(node.inputs[e.input] ?? null)} → ${JSON.stringify(e.value)}`);
        node.inputs[e.input] = e.value;
        break;
      case 'wire':
        if (!need(node, `the graph has no node ${id}`) || !need(typeof e.input === 'string', 'needs input') || !need(isLink(e.from) && next.graph[String(e.from[0])], 'from must be [an existing node id, output number]')) break;
        said.push(`node ${id} (${node.class_type}) ${e.input} ← node ${e.from[0]} (${next.graph[String(e.from[0])].class_type}) output ${e.from[1]}`);
        node.inputs[e.input] = [String(e.from[0]), e.from[1]];
        break;
      case 'unset':
        if (!need(node && Object.prototype.hasOwnProperty.call(node.inputs, e.input), `node ${id} has no input '${e.input}'`)) break;
        said.push(`node ${id} (${node.class_type}) ${e.input} removed`);
        delete node.inputs[e.input];
        break;
      case 'add':
        if (!need(id && !node, `node id ${id} is ${id ? 'already in the graph' : 'missing'}: a new node needs a new id`) || !need(typeof e.class_type === 'string', 'needs class_type')) break;
        next.graph[id] = { class_type: e.class_type, inputs: e.inputs && typeof e.inputs === 'object' && !Array.isArray(e.inputs) ? e.inputs : {} };
        said.push(`new node ${id}: ${e.class_type}`);
        break;
      case 'remove': {
        if (!need(node, `the graph has no node ${id}`)) break;
        const users = Object.entries(next.graph).filter(([other, o]) => other !== id && Object.values(o.inputs).some((v) => isLink(v) && String(v[0]) === id)).map(([other]) => other);
        if (!need(users.length === 0, `node ${users.join(', ')} still take${users.length === 1 ? 's' : ''} its output — rewire ${users.length === 1 ? 'it' : 'them'} first`)) break;
        said.push(`node ${id} (${node.class_type}) removed`);
        delete next.graph[id];
        for (const [name, spec] of Object.entries(next.slots)) {
          const kept = bindsOf(spec).filter((b) => String(b.node) !== id);
          if (kept.length === 0) { delete next.slots[name]; said.push(`knob ${name} went with it`); } else next.slots[name] = { ...spec, into: kept };
        }
        if (next.source && String(next.source.node) === id) delete next.source;
        break;
      }
      case 'knob': {
        if (!need(typeof e.name === 'string' && e.name, 'needs name') || !need(e.into, 'needs into: {node, input}')) break;
        const { op: _op, name, ...spec } = e;
        said.push(`knob ${name} ${next.slots[name] ? 'changed' : 'added'} → ${bindsOf(spec).map(at).join(', ')}${spec.values ? ` (${spec.values.length} choices)` : Number.isFinite(spec.min) ? ` (${spec.min} to ${spec.max})` : ''}`);
        next.slots[name] = spec;
        break;
      }
      case 'unknob':
        if (!need(next.slots[e.name], `there is no knob '${e.name}'`)) break;
        said.push(`knob ${e.name} removed (its value stays as written)`);
        delete next.slots[e.name];
        break;
      case 'source':
        if (e.none === true) { delete next.source; said.push('no longer starts from an image'); break; }
        if (!need(node, `the graph has no node ${id}`)) break;
        next.source = { node: id, input: e.input ?? 'image' };
        said.push(`starts from the caller's image at node ${id}`);
        break;
      case 'describe':
        if (!need(typeof e.label === 'string' || typeof e.description === 'string', 'needs label or description')) break;
        if (typeof e.label === 'string') next.label = e.label;
        if (typeof e.description === 'string') next.description = e.description;
        said.push('name or description rewritten');
        break;
      default:
        errors.push(`${n}: op must be one of ${EDIT_OPS.join(', ')}`);
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, proposal: next, said };
};
