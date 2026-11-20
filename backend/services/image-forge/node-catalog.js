/**
 * NODE CATALOG — every node the image engine has, read so it can be reasoned
 * about: what each input is (its type, default, range, step, choices, whether
 * it must be given), what each output is, and which other nodes can feed it or
 * take from it. And a registered workflow read the same way, as a map: each
 * node, each value with what the engine allows there, each wire, each knob
 * (Design note, 2026-11-20: […]).
 *
 * Everything is read from the engine's own description of itself
 * (/object_info), never from a list kept here, so it is right for whatever
 * engine version is installed. Pure: the description is handed in.
 */

const CHOICES_SHOWN = 40;

/** The choices an input offers when the engine lists them, else null. Pure. */
export const choicesOf = (spec) => {
  if (!Array.isArray(spec)) return null;
  if (Array.isArray(spec[0])) return spec[0];
  if (spec[0] === 'COMBO' && Array.isArray(spec[1]?.options)) return spec[1].options;
  return null;
};

/**
 * One input, read out of the engine's own spec. `wired` inputs take another
 * node's output (a MODEL, a LATENT…); the rest are values written in the graph.
 * Pure.
 * @param {string} name
 * @param {Array} spec - e.g. ["INT", {default: 20, min: 1, max: 10000}] or [["a", "b"], {}]
 * @param {boolean} required
 */
export const describeInput = (name, spec, required) => {
  const choices = choicesOf(spec);
  const opts = (Array.isArray(spec) && spec[1] && typeof spec[1] === 'object' && !Array.isArray(spec[1])) ? spec[1] : {};
  const type = choices ? 'CHOICE' : String(Array.isArray(spec) ? spec[0] : spec);
  const value = choices !== null || ['INT', 'FLOAT', 'STRING', 'BOOLEAN'].includes(type);
  return {
    name, type, required, wired: !value,
    ...(opts.default !== undefined ? { default: opts.default } : {}),
    ...(Number.isFinite(opts.min) ? { min: opts.min } : {}),
    ...(Number.isFinite(opts.max) ? { max: opts.max } : {}),
    ...(Number.isFinite(opts.step) ? { step: opts.step } : {}),
    ...(choices ? { choices } : {}),
    ...(opts.multiline ? { multiline: true } : {}),
    ...(typeof opts.tooltip === 'string' && opts.tooltip ? { tooltip: opts.tooltip } : {}),
  };
};

/**
 * One node, whole. Pure.
 * @param {string} className
 * @param {Object} info - the engine's /object_info entry
 * @returns {{name:string, title:string, category:string, about:string, inputs:Array, outputs:Array<{name:string, type:string}>,
 *   writes:boolean, outside:boolean, deprecated:boolean}|null}
 */
export const describeNode = (className, info) => {
  if (!info) return null;
  const order = info.input_order || {};
  const group = (key) => (order[key] || Object.keys(info.input?.[key] || {})).filter((n) => info.input?.[key]?.[n] !== undefined)
    .map((n) => describeInput(n, info.input[key][n], key === 'required'));
  const outs = Array.isArray(info.output) ? info.output : [];
  return {
    name: className,
    title: info.display_name || className,
    category: info.category || '',
    about: typeof info.description === 'string' ? info.description : '',
    inputs: [...group('required'), ...group('optional')],
    outputs: outs.map((type, i) => ({ name: String(info.output_name?.[i] ?? type), type: Array.isArray(type) ? 'CHOICE' : String(type) })),
    writes: info.output_node === true,
    outside: info.api_node === true || String(info.python_module || '').includes('comfy_api_nodes'),
    deprecated: info.deprecated === true,
  };
};

/**
 * Find nodes: by words in the name, title or category; by what they MAKE (an
 * output type) or TAKE (a wired input type). Nodes that call an outside
 * service are left out — no workflow here may use one. Sorted by category,
 * then name. Pure.
 * @param {Object} objectInfo
 * @param {{find?:string, makes?:string, takes?:string}} [by]
 * @returns {Array<ReturnType<typeof describeNode>>}
 */
export const searchNodes = (objectInfo, { find, makes, takes } = {}) => {
  const words = String(find || '').toLowerCase().split(/\s+/).filter(Boolean);
  const want = (t) => String(t || '').trim().toUpperCase();
  return Object.keys(objectInfo || {})
    .map((name) => describeNode(name, objectInfo[name]))
    .filter((n) => n && !n.outside)
    .filter((n) => words.every((w) => `${n.name} ${n.title} ${n.category}`.toLowerCase().includes(w)))
    .filter((n) => !makes || n.outputs.some((o) => o.type.toUpperCase() === want(makes)))
    .filter((n) => !takes || n.inputs.some((i) => i.wired && i.type.toUpperCase() === want(takes)))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
};

const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const rangeWords = (i) => [
  Number.isFinite(i.min) || Number.isFinite(i.max) ? `${i.min ?? '…'} to ${i.max ?? '…'}` : null,
  Number.isFinite(i.step) ? `step ${i.step}` : null,
  i.default !== undefined ? `default ${show(i.default)}` : null,
].filter(Boolean).join(', ');

/** A page of found nodes as text: one line each, grouped by category. Pure. */
export const shapeNodeList = (found, { offset = 0, limit = 60, total = null, asOf = '' } = {}) => {
  if (found.length === 0) return 'No node matches. Try fewer words, or {makes: "IMAGE"} / {takes: "LATENT"} to find by what a node produces or needs.';
  const page = found.slice(offset, offset + limit);
  const out = [`${found.length}${total !== null ? ` of the engine's ${total}` : ''} nodes${asOf ? ` (${asOf})` : ''} — ${offset + 1}–${offset + page.length}:`];
  let category = null;
  for (const n of page) {
    if (n.category !== category) { category = n.category; out.push(`${category || '(no category)'}:`); }
    const ins = n.inputs.filter((i) => i.wired && i.required).map((i) => i.type).join(', ');
    out.push(`  ${n.name}${n.title !== n.name ? ` "${n.title}"` : ''} — takes ${ins || 'nothing wired'}; makes ${n.outputs.map((o) => o.type).join(', ') || 'nothing'}${n.writes ? ' · writes output' : ''}${n.deprecated ? ' · deprecated' : ''}`);
  }
  if (offset + page.length < found.length) out.push(`${found.length - offset - page.length} more — page with offset ${offset + page.length}.`);
  out.push('forge_status {view: "node", node: "<name>"} reads one node in full.');
  return out.join('\n');
};

/**
 * One node in full, with what can feed each wired input and what can take
 * each output. Pure.
 * @param {ReturnType<typeof describeNode>} node
 * @param {Object} objectInfo - to say which nodes connect
 * @param {{choices?:string}} [opts] - an input's name: list ALL its choices
 */
export const shapeNode = (node, objectInfo, { choices } = {}) => {
  const all = searchNodes(objectInfo);
  const makers = (type) => all.filter((n) => n.outputs.some((o) => o.type === type)).map((n) => n.name);
  const takers = (type) => all.filter((n) => n.inputs.some((i) => i.wired && i.type === type)).map((n) => n.name);
  const some = (names) => (names.length > 8 ? `${names.slice(0, 8).join(', ')} and ${names.length - 8} more ({makes}/{takes} lists them)` : names.join(', ') || 'no node');
  const out = [
    `${node.name}${node.title !== node.name ? ` — "${node.title}"` : ''} · ${node.category || 'no category'}${node.writes ? ' · WRITES OUTPUT (only SaveImage may, in a registered workflow)' : ''}${node.deprecated ? ' · deprecated' : ''}`,
    ...(node.about ? [node.about] : []),
    'INPUTS:',
  ];
  for (const i of node.inputs) {
    const need = i.required ? 'required' : 'optional';
    if (i.wired) {
      out.push(`  ${i.name} — ${i.type}, ${need}, WIRED from another node's output. Made by: ${some(makers(i.type))}.`);
    } else if (i.choices) {
      const list = choices === i.name || i.choices.length <= CHOICES_SHOWN ? i.choices : i.choices.slice(0, CHOICES_SHOWN);
      out.push(`  ${i.name} — one of ${i.choices.length} choices, ${need}${i.default !== undefined ? `, default ${show(i.default)}` : ''}: ${list.map(show).join(', ')}${list.length < i.choices.length ? ` … ${i.choices.length - list.length} more ({view: "node", node: "${node.name}", choices: "${i.name}"} lists all)` : ''}`);
    } else {
      out.push(`  ${i.name} — ${i.type}, ${need}${rangeWords(i) ? `, ${rangeWords(i)}` : ''}${i.multiline ? ', many lines' : ''}`);
    }
    if (i.tooltip) out.push(`      ${i.tooltip}`);
  }
  out.push(node.outputs.length ? 'OUTPUTS (wire one as ["<this node\'s id>", <number>]):' : 'OUTPUTS: none.');
  node.outputs.forEach((o, n) => out.push(`  ${n}: ${o.name} — ${o.type}. Taken by: ${some(takers(o.type))}.`));
  return out.join('\n');
};

/**
 * A registered workflow as a map: every node, every value with what the
 * engine allows there and whether a knob controls it, every wire by the name
 * of the output it carries. `objectInfo` null ⇒ the map without the engine's
 * ranges (said so). Pure.
 * @param {Object} pipeline - a registered workflow (workflow-rules.js)
 * @param {Object|null} objectInfo
 */
export const shapeWorkflowMap = (pipeline, objectInfo) => {
  const knobAt = new Map();
  for (const [name, into] of Object.entries(pipeline.binds || {})) for (const b of into) knobAt.set(`${b.node}\u0000${b.input}`, name);
  const out = [
    `${pipeline.id} — "${pipeline.label}" · ${Object.keys(pipeline.graph).length} nodes${objectInfo ? '' : ' · the engine\'s node list has not been read yet, so allowed ranges are not shown (forge_control {act: "start"}, then read again)'}`,
    pipeline.description,
    'NODES (id · kind):',
  ];
  for (const [id, node] of Object.entries(pipeline.graph)) {
    const spec = objectInfo ? describeNode(node.class_type, objectInfo[node.class_type]) : null;
    out.push(`${id} · ${node.class_type}${spec?.title && spec.title !== node.class_type ? ` "${spec.title}"` : ''}`);
    for (const [input, value] of Object.entries(node.inputs)) {
      const about = spec?.inputs.find((i) => i.name === input);
      if (Array.isArray(value)) {
        const from = pipeline.graph[String(value[0])];
        const made = objectInfo ? describeNode(from?.class_type, objectInfo[from?.class_type])?.outputs[value[1]] : null;
        out.push(`    ${input} ← node ${value[0]} (${from?.class_type ?? 'missing'}) output ${value[1]}${made ? ` ${made.name}: ${made.type}` : ''}`);
        continue;
      }
      const knob = knobAt.get(`${id}\u0000${input}`);
      const slot = knob ? pipeline.slots[knob] : null;
      const allowed = !about ? '' : about.choices ? ` · engine allows ${about.choices.length} choices` : rangeWords(about) ? ` · engine allows ${rangeWords(about)}` : '';
      const turn = !knob ? (input === 'filename_prefix' ? ' · set by the platform on every render' : pipeline.sourceBind?.node === id && pipeline.sourceBind?.input === input ? ' · the caller\'s own image goes here' : ' · fixed')
        : ` · KNOB ${knob}${slot.type === 'enum' ? ` (${slot.values.map(show).join(' | ')})` : slot.type === 'text' ? ' (text, screened)' : knob === 'seed' ? ' (any seed)' : ` (${slot.min} to ${slot.max})`}`;
      out.push(`    ${input} = ${show(value)}${turn}${allowed}`);
    }
    const unset = (spec?.inputs || []).filter((i) => !i.required && !Object.prototype.hasOwnProperty.call(node.inputs, i.name));
    if (unset.length) out.push(`    not set (optional): ${unset.map((i) => `${i.name}${i.wired ? ` ← ${i.type}` : ''}`).join(', ')}`);
  }
  out.push(`KNOBS a caller may turn: ${Object.keys(pipeline.slots).join(', ')}.`);
  out.push(`CHANGE IT with forge/edit-workflow {id: "${pipeline.id}", edits: [...]} — set a value, wire an input, add or remove a node, add, change or remove a knob. forge_status {view: "node", node: "<kind>"} reads any node in full.`);
  return out.join('\n');
};
