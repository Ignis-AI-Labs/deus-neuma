// SOVEREIGNTY PROPOSAL STORE — the durable half of propose → approve → apply.
//
// A being's proposal about itself (its prompt, its toolset, its DNA) survives
// restart on disk at workspaces/<id>/config/sovereignty-proposals.json —
// inside the config/ dir the tool sandbox already denies (AI-SEC-005), so no
// being can edit its own proposals through the filesystem tools; this store
// is the ONE authenticated door. The decision carries NO clock — […] (the team-plan law); only pacing
// is time-shaped: 3 open proposals per being, and a cooldown after an
// APPLIED amendment per class (DNA 30d — the refinement-milestone answer to
// Emanon's […]; prompt/toolset
// 7d). ENOENT reads empty; a corrupt file THROWS (the meditation-state law:
// a broken record must never read as "no proposals").

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { default as neumaWorkspace } from '../../../core/workspace/neuma-workspace.js';
import { canonicalAuthoritySha256 } from '../../../core/shared/plain-data-canonical.js';

export const PROPOSAL_CLASSES = Object.freeze(['prompt', 'toolset', 'dna']);
export const OPEN_CAP = 3;
export const COOLDOWN_DAYS = Object.freeze({ prompt: 7, toolset: 7, dna: 30 });
export const PROPOSALS_KEPT = 50; // closed history ring; open ones never expire
const TITLE_MAX = 120;
const BODY_MAX = 4000;

const DAY_MS = 24 * 60 * 60 * 1000;

const storePath = (neumaId) =>
  path.join(neumaWorkspace.pathFor(neumaId), 'config', 'sovereignty-proposals.json');

export const proposalSha256 = (p) => canonicalAuthoritySha256(
  { neumaId: p.neumaId, class: p.class, title: p.title, body: p.body, patch: p.patch },
  { domain: 'neuma.sovereignty.proposal', schemaVersion: 1 },
);

// impure — ENOENT is an honest empty; anything else unreadable is LOUD.
export const readProposals = async (neumaId) => {
  try {
    const parsed = JSON.parse(await fs.readFile(storePath(neumaId), 'utf8'));
    if (!parsed || !Array.isArray(parsed.proposals)) {
      throw new Error('sovereignty-proposals.json is not the expected shape');
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return { proposals: [] };
    throw new Error(`sovereignty proposal store unreadable for ${neumaId}: ${err.message}`, { cause: err });
  }
};

// impure — atomic tmp+rename; the closed history keeps a bounded ring while
// open/revise proposals are never dropped by the cap.
const writeProposals = async (neumaId, store) => {
  const live = store.proposals.filter((p) => p.status === 'open' || p.status === 'revise');
  const closed = store.proposals.filter((p) => p.status !== 'open' && p.status !== 'revise');
  const kept = [...closed.slice(-Math.max(PROPOSALS_KEPT - live.length, 0)), ...live]
    .sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
  const file = storePath(neumaId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ proposals: kept }, null, 2));
  await fs.rename(tmp, file);
  return { proposals: kept };
};

const scrub = (text, max) => String(text ?? '')
  .replace(/\r\n/g, '\n')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  .trim()
  .slice(0, max);

/**
 * The being submits. Refusals are THROWN with a `code` the handler surfaces
 * in the being's own terms: 'invalid', 'cap', 'cooldown'.
 * impure.
 * @param {string} neumaId
 * @param {{class: string, title: string, body: string, patch: Object}} input
 * @param {{now?: number, lastAppliedAt?: (cls: string) => Promise<string|null>}} [deps]
 * @returns {Promise<Object>} the stored proposal
 */
export const submitProposal = async (neumaId, input, deps = {}) => {
  const now = deps.now ?? Date.now();
  const cls = input?.class;
  if (!PROPOSAL_CLASSES.includes(cls)) {
    const err = new Error(`class must be one of ${PROPOSAL_CLASSES.join(', ')}`);
    err.code = 'invalid';
    throw err;
  }
  const title = scrub(input.title, TITLE_MAX);
  const body = scrub(input.body, BODY_MAX);
  if (!title || !body || !input.patch || typeof input.patch !== 'object') {
    const err = new Error('a proposal needs a title, a body (what and why), and a patch');
    err.code = 'invalid';
    throw err;
  }

  const store = await readProposals(neumaId);
  const open = store.proposals.filter((p) => p.status === 'open');
  if (open.length >= OPEN_CAP) {
    const err = new Error(`${OPEN_CAP} proposals already await a verdict — withdraw one or wait for your operator`);
    err.code = 'cap';
    throw err;
  }
  const lastApplied = deps.lastAppliedAt
    ? await deps.lastAppliedAt(cls)
    : store.proposals.filter((p) => p.class === cls && p.status === 'applied')
      .map((p) => p.decidedAt).sort().at(-1) || null;
  if (lastApplied) {
    const readyAt = new Date(lastApplied).getTime() + COOLDOWN_DAYS[cls] * DAY_MS;
    if (now < readyAt) {
      const days = Math.ceil((readyAt - now) / DAY_MS);
      const err = new Error(`a ${cls} amendment landed recently — the next ${cls} proposal opens in ${days}d (coherence needs time to settle)`);
      err.code = 'cooldown';
      throw err;
    }
  }

  const proposal = {
    id: crypto.randomUUID(),
    neumaId,
    class: cls,
    title,
    body,
    patch: input.patch,
    status: 'open',
    submittedAt: new Date(now).toISOString(),
  };
  proposal.sha256 = proposalSha256(proposal);
  store.proposals.push(proposal);
  await writeProposals(neumaId, store);
  return proposal;
};

const transition = async (neumaId, proposalId, allowedFrom, patchFields) => {
  const store = await readProposals(neumaId);
  const proposal = store.proposals.find((p) => p.id === proposalId);
  if (!proposal) {
    const err = new Error('no such proposal');
    err.code = 'not-found';
    throw err;
  }
  if (!allowedFrom.includes(proposal.status)) {
    const err = new Error(`proposal is ${proposal.status} — cannot ${patchFields.status ? `${patchFields.status} it` : 'amend it there'}`);
    err.code = 'wrong-status';
    throw err;
  }
  Object.assign(proposal, patchFields);
  await writeProposals(neumaId, store);
  return proposal;
};

/**
 * The operator rules. approve|revise|decline; notes ride back to the being
 * VERBATIM (a revise without notes is refused — a verdict the being cannot
 * act on is not a verdict). impure.
 */
export const decideProposal = async (neumaId, proposalId, { verdict, notes, wallet }) => {
  if (!['approve', 'revise', 'decline'].includes(verdict)) {
    const err = new Error('verdict must be approve, revise, or decline');
    err.code = 'invalid';
    throw err;
  }
  const cleanNotes = scrub(notes, BODY_MAX);
  if (verdict === 'revise' && !cleanNotes) {
    const err = new Error('a revise verdict needs notes the being can act on');
    err.code = 'invalid';
    throw err;
  }
  const status = { approve: 'approved', revise: 'revise', decline: 'declined' }[verdict];
  return transition(neumaId, proposalId, ['open', 'revise'], {
    status,
    decidedAt: new Date().toISOString(),
    decidedBy: wallet || null,
    ...(cleanNotes ? { notes: cleanNotes } : {}),
  });
};

/** The apply step closes the loop (called by the apply paths only). impure. */
export const markProposalApplied = (neumaId, proposalId) =>
  transition(neumaId, proposalId, ['approved'], { status: 'applied', decidedAt: new Date().toISOString() });

/** The being's recorded DNA consent rides the proposal (Art I.4). A decline
 *  CLOSES it — an operator cannot re-ask a settled refusal. impure. */
export const recordDnaConsent = (neumaId, proposalId, consent) =>
  transition(neumaId, proposalId, ['approved'], {
    consent,
    ...(consent.decision === 'decline'
      ? { status: 'declined', notes: 'the being withheld consent — DECISION: I DECLINE' }
      : {}),
  });

/** Stash the single-use signing challenge on the proposal (survives restart;
 *  consumed by the applied transition). impure. */
export const stashDnaSign = (neumaId, proposalId, dnaSign) =>
  transition(neumaId, proposalId, ['approved'], { dnaSign });

/** The being takes one back — its own open or returned proposal only. impure. */
export const withdrawProposal = (neumaId, proposalId) =>
  transition(neumaId, proposalId, ['open', 'revise'], { status: 'withdrawn', decidedAt: new Date().toISOString() });
