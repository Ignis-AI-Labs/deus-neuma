/**
 * WORKFLOW STORE — the workflows an operator has approved, kept on this
 * computer, and the one lookup that finds a pipeline wherever it lives: the
 * platform's own manifest (pack-registry.js, in code, never on disk) or here.
 *
 * A registered workflow is machine-wide, like the engine it runs on: one file
 * per workflow under <data root>/image-forge/workflows/. Every read re-checks
 * the file against the rules (workflow-rules.js), so a file edited by hand into
 * something the rules refuse is not a pipeline.
 */
import fs from 'fs/promises';
import path from 'path';
import { getDataRoot } from '../data-root.js';
import { catalogForCaller, resolveModel, resolvePipeline } from './pack-registry.js';
import { WORKFLOW_ID, checkWorkflowProposal } from './workflow-rules.js';

const dir = () => path.join(getDataRoot(), 'image-forge', 'workflows');
const fileOf = (id) => path.join(dir(), `${id}.json`);

// impure — one stored workflow as a pipeline, or null (absent, unreadable, or no longer lawful).
const readOne = async (id) => {
  if (!WORKFLOW_ID.test(String(id))) return null;
  try {
    const record = JSON.parse(await fs.readFile(fileOf(id), 'utf8'));
    const checked = checkWorkflowProposal(record.proposal);
    // Not lawful any more, or a knob still waiting for a range the engine never gave: not a pipeline.
    if (!checked.ok || checked.pipeline.id !== id || Object.values(checked.pipeline.slots).some((slot) => slot.engineRange)) return null;
    return { ...checked.pipeline, registeredBy: record.registeredBy ?? null, registeredAt: record.registeredAt ?? null };
  } catch {
    return null;
  }
};

/** The proposal a registered workflow was kept as — what an edit starts from. null when there is none. impure. */
export const readWorkflowProposal = async (id) => {
  if (!(await readOne(id))) return null;
  return JSON.parse(await fs.readFile(fileOf(id), 'utf8')).proposal;
};

/** Every registered workflow, by id. impure. */
export const listWorkflows = async () => {
  const names = await fs.readdir(dir()).catch(() => []);
  const found = await Promise.all(names.filter((n) => n.endsWith('.json')).sort().map((n) => readOne(n.slice(0, -5))));
  return found.filter(Boolean);
};

/**
 * Keep an approved workflow. The PROPOSAL is what is stored (the pipeline is
 * rebuilt from it by the rules on every read). Written whole, then moved into
 * place. impure.
 * @param {Object} proposal - as filed, already checked
 * @param {{by:string}} who - the lane that proposed it
 */
export const saveWorkflow = async (proposal, { by }) => {
  await fs.mkdir(dir(), { recursive: true });
  const tmp = `${fileOf(proposal.id)}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ schema: 'forge-workflow/1', proposal, registeredBy: by, registeredAt: new Date().toISOString() }, null, 2));
  await fs.rename(tmp, fileOf(proposal.id));
};

/** Take a registered workflow away. True when one was there. impure. */
export const removeWorkflow = async (id) => {
  if (!WORKFLOW_ID.test(String(id))) return false;
  return fs.rm(fileOf(id)).then(() => true, () => false);
};

/**
 * Find a pipeline by id: a registered workflow when the id is custom.*, else
 * the platform's own manifest. Unknown ⇒ a refusal naming what IS available. impure.
 * @param {string} id
 * @returns {Promise<{ok:true, pipeline:Object}|{ok:false, error:string}>}
 */
export const findPipeline = async (id) => {
  if (typeof id !== 'string' || !id.startsWith('custom.')) return resolvePipeline(id);
  const pipeline = await readOne(id);
  if (pipeline) return { ok: true, pipeline };
  const known = (await listWorkflows()).map((w) => w.id);
  return { ok: false, error: `no registered workflow '${id}' — registered: ${known.length ? known.join(', ') : 'none yet'}; list_pipelines names every pipeline` };
};

/** The model a pipeline needs: the manifest's, or — for a registered workflow — the files its graph names. Pure. */
export const findModel = (pipeline) => (pipeline?.custom
  ? { ok: true, model: { id: pipeline.id, label: pipeline.label, files: pipeline.files.filter((f) => f.folder) } }
  : resolveModel(pipeline));

/** The catalog a caller reads: the platform's pipelines, then the registered workflows, in one shape. impure. */
export const catalogWithWorkflows = async () => [
  ...catalogForCaller(),
  ...(await listWorkflows()).map((p) => ({
    id: p.id, kind: p.kind, label: p.label, registered: true,
    description: `${p.description} (A workflow registered on this computer${p.registeredAt ? `, ${p.registeredAt.slice(0, 10)}` : ''}.)`,
    requiresSourceImage: p.requiresSourceImage === true,
    parameters: Object.entries(p.slots).map(([name, spec]) => ({
      name, type: spec.type,
      ...(spec.values ? { allowed: [...spec.values] } : {}),
      ...(spec.min !== undefined ? { min: spec.min, max: spec.max } : {}),
      ...(spec.default !== undefined && spec.default !== null ? { default: spec.default } : {}),
      ...(spec.required ? { required: true } : {}),
    })),
  })),
];
