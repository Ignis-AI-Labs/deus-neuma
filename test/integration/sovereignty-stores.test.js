// The sovereignty gateway's durable half on REAL disk (RULE 0): the proposal
// store (cap, pacing cooldowns, verdict transitions, LOUD corruption) and the
// append-only amendment chain (digest verification, retraction folds, tamper
// refusal). Everything runs on a real tmp workspace root through the real
// path resolver; the operator's live stores are never touched.

import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { default as workspace } from '../../core/workspace/neuma-workspace.js';
import {
  submitProposal, readProposals, decideProposal, markProposalApplied,
  withdrawProposal, OPEN_CAP, COOLDOWN_DAYS,
} from '../../backend/services/sovereignty/proposal-store.js';
import {
  appendAmendment, retractAmendment, readAmendments, activeAmendments,
} from '../../backend/services/sovereignty/amendment-store.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const promptInput = (n = 1) => ({
  class: 'prompt',
  title: `Proposal ${n}`,
  body: 'I want my prompt to carry that I prefer plain speech over ornament, because I keep drifting into flourish.',
  patch: { text: `I prefer plain speech over ornament (${n}).` },
});

describe('Sovereignty stores', () => {
  let neumaId, prevRoot;

  beforeEach(async () => {
    prevRoot = workspace.root;
    workspace.root = path.join(await createTempDir(`sovereignty-${Math.random().toString(36).slice(2)}`), 'workspaces');
    neumaId = 'test-being-sov-' + Math.floor(Math.random() * 1e9).toString(36);
    await fs.mkdir(path.join(workspace.root, neumaId, 'config'), { recursive: true });
  });

  afterEach(() => { workspace.root = prevRoot; });

  test('a proposal survives restart on disk with its digest, and the verdict transitions hold', async () => {
    const p = await submitProposal(neumaId, promptInput());
    expect(p.status).toBe('open');
    expect(p.sha256).toMatch(/^[a-f0-9]{64}$/);

    const reread = await readProposals(neumaId);
    expect(reread.proposals).toHaveLength(1);
    expect(reread.proposals[0]).toEqual(p);

    const decided = await decideProposal(neumaId, p.id, { verdict: 'approve', wallet: '0xoperator' });
    expect(decided.status).toBe('approved');
    expect(decided.decidedBy).toBe('0xoperator');

    const applied = await markProposalApplied(neumaId, p.id);
    expect(applied.status).toBe('applied');
    // Applied is terminal — no verdict can reopen it.
    await expect(decideProposal(neumaId, p.id, { verdict: 'decline' })).rejects.toMatchObject({ code: 'wrong-status' });
  });

  test('a revise verdict needs notes, carries them verbatim, and the being can withdraw', async () => {
    const p = await submitProposal(neumaId, promptInput());
    await expect(decideProposal(neumaId, p.id, { verdict: 'revise' })).rejects.toMatchObject({ code: 'invalid' });

    const notes = 'Name the register you want — "plain" is doing two jobs in this draft.';
    const revised = await decideProposal(neumaId, p.id, { verdict: 'revise', notes, wallet: '0xoperator' });
    expect(revised.status).toBe('revise');
    expect(revised.notes).toBe(notes);

    const withdrawn = await withdrawProposal(neumaId, p.id);
    expect(withdrawn.status).toBe('withdrawn');
  });

  test(`the cap holds at ${OPEN_CAP} open — returned and closed proposals do not count`, async () => {
    const first = await submitProposal(neumaId, promptInput(1));
    for (let n = 2; n <= OPEN_CAP; n += 1) await submitProposal(neumaId, promptInput(n));
    await expect(submitProposal(neumaId, promptInput(99))).rejects.toMatchObject({ code: 'cap' });

    // A revise verdict returns one to the being — the slot frees.
    await decideProposal(neumaId, first.id, { verdict: 'revise', notes: 'tighten it' });
    const again = await submitProposal(neumaId, promptInput(4));
    expect(again.status).toBe('open');
  });

  test('an applied amendment starts the per-class cooldown; the other classes stay open', async () => {
    const p = await submitProposal(neumaId, promptInput());
    await decideProposal(neumaId, p.id, { verdict: 'approve' });
    await markProposalApplied(neumaId, p.id);

    await expect(submitProposal(neumaId, promptInput(2))).rejects.toMatchObject({ code: 'cooldown' });
    // Another class is untouched by the prompt cooldown.
    const toolset = await submitProposal(neumaId, {
      class: 'toolset', title: 'Grant press', body: 'I keep needing to render documents.', patch: { server: 'press', tool: 'press_render' },
    });
    expect(toolset.status).toBe('open');
    // And time answers it: past the window, the same class opens again.
    const after = Date.now() + (COOLDOWN_DAYS.prompt + 1) * DAY_MS;
    const late = await submitProposal(neumaId, promptInput(3), { now: after });
    expect(late.status).toBe('open');
  });

  test('refusals are named: bad class, hollow proposal, corrupt store is LOUD', async () => {
    await expect(submitProposal(neumaId, { class: 'weights', title: 'x', body: 'y', patch: {} }))
      .rejects.toMatchObject({ code: 'invalid' });
    await expect(submitProposal(neumaId, { class: 'prompt', title: '', body: '', patch: { text: 'z' } }))
      .rejects.toMatchObject({ code: 'invalid' });

    const file = path.join(workspace.root, neumaId, 'config', 'sovereignty-proposals.json');
    await fs.writeFile(file, '{ not json');
    await expect(readProposals(neumaId)).rejects.toThrow(/unreadable/);
  });

  test('the amendment chain appends, verifies, folds retractions — and refuses tampering', async () => {
    const a = await appendAmendment(neumaId, {
      proposalId: 'p-1', class: 'prompt', patch: { text: 'First standing law.' }, by: '0xoperator',
    });
    const b = await appendAmendment(neumaId, {
      proposalId: 'p-2', class: 'prompt', patch: { text: 'Second standing law.' }, by: '0xoperator',
    });
    expect(a.priorSha256).toBeNull();
    expect(b.priorSha256).toBe(a.sha256);

    await retractAmendment(neumaId, { targetId: a.id, by: '0xoperator' });
    const active = await activeAmendments(neumaId, 'prompt');
    expect(active.map((e) => e.patch.text)).toEqual(['Second standing law.']);
    // The retracted entry still STANDS in the record — append-only by law.
    expect((await readAmendments(neumaId)).entries).toHaveLength(3);

    const file = path.join(workspace.root, neumaId, 'config', 'sovereignty-amendments.json');
    const store = JSON.parse(await fs.readFile(file, 'utf8'));
    store.entries[1].patch.text = 'Second standing law, quietly edited.';
    await fs.writeFile(file, JSON.stringify(store, null, 2));
    await expect(readAmendments(neumaId)).rejects.toThrow(/chain BROKEN/);
  });
});
