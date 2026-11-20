/**
 * forge/register-workflow · forge/forget-workflow — a neuma proposes a ComfyUI
 * workflow, its operator says yes once, and it becomes a pipeline that
 * image/generate runs like any other (Design note, 2026-11-20: […]).
 *
 * What the yes covers is on the card: the nodes, the model files, and the
 * knobs a caller may turn. What the yes does NOT cover, because no workflow is
 * ever given it: where a file is written, which image is read, the network,
 * and the content law — every text in the workflow and every prompt sent
 * through it is screened on every render (image-forge/workflow-rules.js).
 *
 * A workflow is machine-wide, like the engine: it is registered by a being
 * whose operator owns or co-owns this computer, and then every house's beings
 * may render through it.
 */
import { resolveComfyConfig, comfyInstallState, ensureComfyReady } from '../image-forge/comfyui-supervisor.js';
import { contentLawPath } from '../image-forge/image-being-tools.js';
import { loadScreenList, screenSlots } from '../image-forge/prompt-screen.js';
import { installsWaiting } from '../image-forge/model-install.js';
import {
  applyWorkflowEdits, checkWorkflowAgainstEngine, checkWorkflowProposal, describeWorkflow, resolveEngineRanges,
} from '../image-forge/workflow-rules.js';
import { findModel, findPipeline, readWorkflowProposal, removeWorkflow, saveWorkflow } from '../image-forge/workflow-store.js';
import { readEngineNodes } from '../image-forge/engine-nodes.js';
import { readInstallOwner, standingIn } from '../install-owner.js';

const OWNER_ONLY = 'Registering a workflow changes what this computer\'s image engine will run, so it belongs to the house that owns this computer, and your operator does not. You can still render through every registered pipeline.';

// impure — may this connection's operator change the machine's pipelines?
const ownsMachine = async (connection) => {
  const standing = standingIn(await readInstallOwner().catch(() => null), connection?.walletAddress);
  return standing === 'owner' || standing === 'co-owner';
};

const proposalOf = ({ id, label, description, graph, slots, source }) => ({ id, label, description, graph, slots, ...(source ? { source } : {}) });

// impure — the engine's own node list, the engine brought up for it if it is down (and the list kept for later reads).
const readObjectInfo = async (cfg) => {
  const ready = await ensureComfyReady(cfg);
  if (ready.state !== 'ready') throw new Error(`the image engine did not come up (${ready.lastError?.error || ready.lastError || ready.state})`);
  const nodes = await readEngineNodes(cfg);
  if (!nodes?.live) throw new Error('the engine did not give its node list');
  return nodes.objectInfo;
};

// impure — the text the content law must pass before any card: every word written into the workflow.
const lawRefusal = (pipeline) => {
  const law = loadScreenList(contentLawPath());
  if (law.failClosed) return { ok: false, status: 'denied', reason: 'The content law could not be read, so no workflow can be kept. Your operator needs to look at this.' };
  const verdict = screenSlots(pipeline.literals.map((text) => ({ name: 'workflow', text, polarity: 'positive' })), law, {});
  return verdict.ok ? null : { ok: false, status: 'denied', reason: `Refused by content law (${verdict.classes[0]}): a text written into this workflow is something the platform never renders. Remove it; it is not a setting.` };
};

// impure — after the yes: knobs given the node's own range where they named none, the whole held against the
// engine's own node list, then kept. Anything the engine cannot run keeps nothing.
const keepWorkflow = async (given, connection, verb) => {
  const cfg = resolveComfyConfig(process.env);
  let objectInfo;
  try { objectInfo = await readObjectInfo(cfg); } catch (err) { return { ok: false, reason: `Not kept: the image engine could not be read (${err.message}). Nothing was changed.` }; }
  const ranged = resolveEngineRanges(given, objectInfo);
  if (!ranged.ok) return { ok: false, reason: `Not kept: ${ranged.errors.join('; ')}. Nothing was changed.` };
  const checked = checkWorkflowProposal(ranged.proposal);
  if (!checked.ok) return { ok: false, reason: `Not kept: ${checked.errors.join('; ')}. Nothing was changed.` };
  const fits = checkWorkflowAgainstEngine(checked.pipeline, objectInfo);
  if (!fits.ok) return { ok: false, reason: `Not kept — the engine cannot run it as written: ${fits.errors.join('; ')}. Nothing was changed.` };
  await saveWorkflow(ranged.proposal, { by: connection?.companion?.neumaId ?? 'unknown' });
  const lacking = await installsWaiting(findModel(checked.pipeline).model, cfg);
  return {
    ok: true,
    detail: `${verb} ${checked.pipeline.id} — ${describeWorkflow(checked.pipeline)}. Every node, every value and every model file in it is one this engine accepts.${lacking ? ` ${lacking.words}` : ''} forge_status {view: "workflow", id: "${checked.pipeline.id}"} shows its whole map; image/generate {pipeline: "${checked.pipeline.id}", prompt: …} renders through it.`,
  };
};

export const forgeRegisterWorkflowIntent = Object.freeze({
  name: 'forge/register-workflow',
  policyTool: 'forge.workflow',
  fieldsForPrompt: '{id, label, description, graph, slots, source?}',
  descriptionForPrompt: 'Register a ComfyUI workflow as a pipeline of your own — after your operator\'s yes, image/generate runs it by its id and list_pipelines shows it. id: "custom.<name>". label and description: its name, and what it makes and how to prompt it. graph: the workflow in ComfyUI\'s API format ({"<node id>": {class_type, inputs}}), using only the engine\'s built-in nodes and model files already installed (forge_status {view: "models"} lists them; forge/install-model brings a missing one). slots: the knobs a caller may set, each with where it lands — positive is required: {positive: {into: {node: "6", input: "text"}}, negative: {into: …}, seed: {into: {node: "3", input: "seed"}}, steps: {type: "int", min: 4, max: 30, into: {node: "3", input: "steps"}}, sampler: {type: "enum", values: ["euler", "dpmpp_2m"], into: …}}. A knob can only set a value written in the graph, and everything without a knob stays fixed. source: {node, input: "image"} names the one LoadImage node that receives the caller\'s own image, for a workflow that edits. It must end in a SaveImage node (stills). Every text in the workflow, and every prompt sent through it, passes the content law on every render. One refusal names everything to fix.',

  availableFor: async ({ laneId, connection }) => {
    if (!laneId || !comfyInstallState(resolveComfyConfig(process.env)).installed) return null;
    return (await ownsMachine(connection)) ? {} : null;
  },

  validate: async (payload, { connection }) => {
    if (!(await ownsMachine(connection))) return { ok: false, status: 'denied', reason: OWNER_ONLY };
    const checked = checkWorkflowProposal(payload);
    if (!checked.ok) return { ok: false, status: 'invalid', reason: `This workflow cannot be registered yet: ${checked.errors.join('; ')}.` };
    // A prompt written into the graph is still a prompt: refused here, before any card, by class only.
    const unlawful = lawRefusal(checked.pipeline);
    if (unlawful) return unlawful;
    const taken = await findPipeline(checked.pipeline.id);
    return { ok: true, value: { proposal: proposalOf(payload), replaces: taken.ok } };
  },

  summarize: (fields) => {
    const checked = checkWorkflowProposal(fields);
    if (!checked.ok) return `register workflow ${fields?.id ?? '(unnamed)'}`;
    return `register the image workflow ${checked.pipeline.id} "${checked.pipeline.label}" as a pipeline every being on this computer can render through: ${describeWorkflow(checked.pipeline)}. Every text in it and every prompt sent through it still passes the content law`;
  },

  execute: ({ proposal, replaces }, { connection }) => keepWorkflow(proposal, connection, replaces ? 'Replaced' : 'Registered'),
});

export const forgeEditWorkflowIntent = Object.freeze({
  name: 'forge/edit-workflow',
  policyTool: 'forge.workflow',
  fieldsForPrompt: '{id, edits}',
  descriptionForPrompt: 'Change a registered workflow in place — {id: "custom.<name>", edits: [...]}, applied in order, then held to every rule a new workflow is and to the engine\'s own node list; your operator approves the list of changes. Each edit is one change: {op: "set", node, input, value} writes a value · {op: "wire", node, input, from: [node, output]} connects an input to another node\'s output · {op: "unset", node, input} drops an optional input · {op: "add", node: "<new id>", class_type, inputs} adds a node · {op: "remove", node} removes one (rewire what takes its output first) · {op: "knob", name, into: {node, input}, type?, min?, max?, values?} adds or changes a knob on ANY written value: a number (leave min and max out to take the node\'s own range), a choice — a model file or LoRA among the engine\'s own included — a true/false, or a text (type: "text", screened on every render) · {op: "unknob", name} · {op: "source", node, input} names the LoadImage door, {op: "source", none: true} closes it · {op: "describe", label?, description?}. Read first: forge_status {view: "workflow", id} shows every node, value, wire and knob with what the engine allows there; {view: "node", node} reads any node in full; {view: "nodes", find | makes | takes} finds nodes. To start from a built-in pipeline, read its graph with {view: "workflow", id: "<its id>"} and register it under a custom id.',

  availableFor: async ({ laneId, connection }) => (laneId && (await ownsMachine(connection)) ? {} : null),

  validate: async (payload, { connection }) => {
    if (!(await ownsMachine(connection))) return { ok: false, status: 'denied', reason: OWNER_ONLY };
    const id = String(payload?.id ?? '');
    const stored = id.startsWith('custom.') ? await readWorkflowProposal(id) : null;
    if (!stored) return { ok: false, status: 'invalid', reason: `forge/edit-workflow changes a REGISTERED workflow, and '${id}' is not one. A built-in pipeline is changed by registering your own: read its graph with forge_status {view: "workflow", id: "${id}"} and file forge/register-workflow under a custom.<name> id.` };
    const edited = applyWorkflowEdits(stored, payload?.edits);
    if (!edited.ok) return { ok: false, status: 'invalid', reason: `These edits cannot be applied: ${edited.errors.join('; ')}.` };
    const checked = checkWorkflowProposal(edited.proposal);
    if (!checked.ok) return { ok: false, status: 'invalid', reason: `After these edits the workflow breaks its rules: ${checked.errors.join('; ')}.` };
    const unlawful = lawRefusal(checked.pipeline);
    if (unlawful) return unlawful;
    return { ok: true, value: { proposal: edited.proposal, said: edited.said, id, edits: payload.edits } };
  },

  summarize: (fields) => {
    const n = Array.isArray(fields?.edits) ? fields.edits.length : 0;
    const words = (fields?.edits || []).slice(0, 12).map((e) => (e?.op === 'set' ? `set node ${e.node} ${e.input} to ${JSON.stringify(e.value)}`
      : e?.op === 'wire' ? `wire node ${e.node} ${e.input} from node ${e.from?.[0]}`
        : e?.op === 'add' ? `add node ${e.node} (${e.class_type})`
          : e?.op === 'remove' ? `remove node ${e.node}`
            : e?.op === 'knob' ? `knob ${e.name} on node ${e.into?.node} ${e.into?.input}${Array.isArray(e.values) ? ` (${e.values.length} choices)` : Number.isFinite(e.min) ? ` (${e.min} to ${e.max})` : ''}`
              : e?.op === 'unknob' ? `remove knob ${e.name}`
                : `${e?.op} ${e?.node ?? e?.name ?? ''}`.trim()));
    return `change the registered image workflow ${fields?.id} in ${n} step${n === 1 ? '' : 's'}: ${words.join('; ')}${n > words.length ? `; and ${n - words.length} more` : ''}. It is checked against the engine before it is kept, and every text in it still passes the content law`;
  },

  execute: async ({ proposal, said }, { connection }) => {
    const kept = await keepWorkflow(proposal, connection, 'Changed');
    return kept.ok ? { ok: true, detail: `${kept.detail}\nWhat changed: ${said.join('; ')}.` } : kept;
  },
});

export const forgeForgetWorkflowIntent = Object.freeze({
  name: 'forge/forget-workflow',
  policyTool: 'forge.workflow',
  fieldsForPrompt: '{id}',
  descriptionForPrompt: 'Take a registered workflow off this computer — {id: "custom.<name>"}. image/generate can no longer run it; the pictures it made stay. The platform\'s own pipelines cannot be removed.',

  availableFor: async ({ laneId, connection }) => (laneId && (await ownsMachine(connection)) ? {} : null),

  validate: async (payload, { connection }) => {
    if (!(await ownsMachine(connection))) return { ok: false, status: 'denied', reason: OWNER_ONLY };
    const id = String(payload?.id ?? '');
    if (!id.startsWith('custom.')) return { ok: false, status: 'invalid', reason: 'forge/forget-workflow takes {id: "custom.<name>"} — only a registered workflow can be removed' };
    const found = await findPipeline(id);
    if (!found.ok) return { ok: false, status: 'invalid', reason: found.error };
    return { ok: true, value: { id, label: found.pipeline.label } };
  },

  summarize: (fields) => `remove the registered image workflow ${fields?.id} from this computer (the pictures it made stay)`,

  execute: async ({ id, label }) => ((await removeWorkflow(id))
    ? { ok: true, detail: `Removed ${id} "${label}". image/generate no longer runs it.` }
    : { ok: false, reason: `${id} was already gone.` }),
});
