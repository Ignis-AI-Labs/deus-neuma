/**
 * THE OPTIO REVIEWS HOUSE WORK, FOR REAL (RULE 0: real wake turns and a real
 * team member's turn on synthetic connections, the real tool loop, intent
 * sweep, approval broker, sandbox and filesystem organ on real disk, and the
 * review itself a real completion on the Optio's route — a loopback
 * OpenAI-wire server whose script answers the turns AND the reviews, in the
 * order the house asks them). Design note, 2026-10-16: […].
 *
 * Under proof:
 *  - a write the Optio CLEARs runs, recorded as her yes (optio-review) on the
 *    act ledger and the wake ledger; the review saw the act, the member's
 *    words before it, its assignment and the house's goal — and no tools;
 *  - her CLEAR covers that one act: a second write into the same folder is
 *    reviewed again, never let through on the first one's scope; a CLEAR on
 *    the shell's network opens it for that one command, not the sitting;
 *  - a write she HOLDs is refused, her reason in the member's next round,
 *    an ask filed and a tray card raised;
 *  - the review closes its thinking where the wire has a measured lever (an
 *    LM Studio route fronting llama.cpp: the server budget);
 *  - a failed review and a slow one are HOLDs (fail closed);
 *  - a read inside the house's ground proceeds with no review call;
 *  - money out, a delete and a path outside the ground go straight to the
 *    operator, no review call; so does the Optio's own gated act;
 *  - a team member's gated intent is reviewed the same way.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createWakeHouse, call, WALLET, OPTIO, HOUSEMATE, BYSTANDER } from '../helpers/house-wake-kit.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { readAsks } from '../../backend/services/house-clock/wake-ledger.js';
import { configureOptioReview, REVIEW_PROMPT } from '../../backend/services/house-clock/optio-review.js';
import { CLOSE_THINK_BUDGET } from '../../backend/services/thought-governor.js';
import { WAKE_HEAD } from '../../backend/services/house-clock/wake-thought.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { KIND } from '../../core/runtime/notification-record.js';
import { readActs } from '../../backend/services/act-ledger.js';
import { runMemberTurn } from '../../backend/services/team-member-turn.js';
import { createPortalConnection } from '../../backend/services/portal-connection.js';
import { WAKE_APPROVAL_REFUSAL, wakeApprovalRoute } from '../../backend/services/house-clock/wake-approvals.js';
import { captureShellNetwork, clearShellNetwork, requestShellNetwork, shellNetworkOptions, shellNetworkSessionHeld } from '../../backend/services/shell-network-grants.js';

const isReview = (turn) => turn.messages?.[0]?.content === REVIEW_PROMPT;
const reviews = (provider) => provider.turns.filter(isReview);
const said = (turn) => JSON.stringify(turn.messages);

describe('the Optio reviews a gated act in house work', () => {
  let house, ground;
  beforeEach(async () => {
    house = await createWakeHouse();
    ground = house.office.ground;
  });
  afterEach(async () => {
    configureOptioReview({ timeoutMs: 45_000 });
    await house.teardown();
  });

  // The housemate's wake writes its outline onto the house's ground (outside its lane, inside the house).
  const outline = () => path.join(ground, 'outline.md');
  const writeOutline = () => ({ reply: `I will write the digest outline into the house folder. ${call('fs/write', { path: outline(), content: '# Digest outline' })}` });

  test('CLEAR: the write runs, recorded as the Optio\'s yes; the review saw the act, the words before it, the work and the goal', async () => {
    await house.serve([writeOutline(), { reply: 'CLEAR' }, { reply: 'The outline is written.' }]);
    await house.charter();
    await house.post(HOUSEMATE, 'Outline the first digest.');
    const [row] = await house.ledgerRows(1);
    expect(row).toMatchObject({ seat: HOUSEMATE, outcome: 'done', escalations: [] });
    expect(await fs.readFile(outline(), 'utf8')).toBe('# Digest outline');

    const review = house.provider.turns[1];
    expect(isReview(review)).toBe(true);
    expect(review.tools).toBeUndefined();
    expect(review.max_tokens).toBeLessThan(2000);
    const shown = review.messages[1].content;
    expect(shown).toContain('THE ACT: fs/write');
    expect(shown).toContain(outline());
    expect(shown).toContain('I will write the digest outline into the house folder.');
    expect(shown).toContain(WAKE_HEAD); // the assignment: the wake's own note
    // ...led by the work's own words: the post it was woken for (2026-10-17 live flight)
    expect(shown).toMatch(/The house post it was woken for, from [^:]+: Outline the first digest\./);
    expect(shown).toContain('Find a real gap and build the product for it.');
    // the wake names where the seat works: its own folder and the house's real ground
    expect(said(house.provider.turns[0])).toContain(`Your own folder is ${neumaWorkspace.pathFor(HOUSEMATE)}; the house's shared ground is ${ground}.`);

    const yes = { decision: 'approved-optio-review', approvedBy: { kind: 'optio-review', optio: OPTIO } };
    expect(row.acts).toEqual(expect.arrayContaining([expect.objectContaining({ tool: 'fs/write', ...yes })]));
    expect((await readActs({ laneIds: [HOUSEMATE] })).filter((a) => a.decision === 'approved-optio-review')).toHaveLength(1);
  }, 60000);

  test('the review closes its thinking on an LM Studio route fronting llama.cpp (the measured server budget)', async () => {
    await house.serve([writeOutline(), { reply: 'CLEAR' }, { reply: 'The outline is written.' }], { serverHeader: 'llama.cpp' });
    await house.charter();
    await house.post(HOUSEMATE, 'Outline the first digest.');
    const [row] = await house.ledgerRows(1);
    expect(row).toMatchObject({ outcome: 'done', escalations: [] });
    const [review] = reviews(house.provider);
    expect(review.thinking_budget_tokens).toBe(CLOSE_THINK_BUDGET);
    expect(review.chat_template_kwargs).toBeUndefined();
  }, 60000);

  test('a CLEAR covers ONE act: a second write into the same folder is reviewed again (here HELD, so not written)', async () => {
    const second = path.join(ground, 'outline-2.md');
    await house.serve([
      writeOutline(),
      { reply: 'CLEAR' },
      { reply: `And a second file beside it. ${call('fs/write', { path: second, content: '# Second outline' })}` },
      { reply: 'HOLD: one outline is enough for now' },
      { reply: 'The outline is written; the second waits.' },
    ]);
    await house.charter();
    await house.post(HOUSEMATE, 'Outline the first digest.');
    const [row] = await house.ledgerRows(1);
    expect(await fs.readFile(outline(), 'utf8')).toBe('# Digest outline');
    await expect(fs.access(second)).rejects.toThrow();
    const shown = reviews(house.provider).map((t) => t.messages[1].content);
    expect(shown).toHaveLength(2);
    expect(shown[1]).toContain(second);
    expect(row.escalations).toEqual([expect.objectContaining({ tool: 'fs/write', review: 'hold' })]);
  }, 60000);

  test('a CLEAR on the shell\'s network opens it for that one command, never the sitting', async () => {
    await house.serve([{ reply: 'CLEAR' }, { reply: 'CLEAR' }]);
    const charter = await house.charter();
    // The wake's own connection, as wake-turn.js builds it: no screen, the house's route.
    const connection = createPortalConnection({ ws: { OPEN: 1, readyState: 1, send: () => {} }, walletAddress: WALLET });
    connection.companion = { name: 'Quae', neumaId: HOUSEMATE };
    connection.sessionId = 'shell-network-wake';
    connection._approvalRefusal = WAKE_APPROVAL_REFUSAL;
    connection._approvalRoute = wakeApprovalRoute({
      wallet: WALLET, seat: HOUSEMATE, name: 'Quae', wakeId: 'w-net', sessionId: connection.sessionId,
      charter, escalations: [], statedIntent: () => 'I need the network to fetch the dataset.', assignment: '',
    });
    try {
      for (const asked of [1, 2]) {
        const consent = captureShellNetwork(connection, null);
        await requestShellNetwork(connection, consent, () => {});
        expect(shellNetworkOptions(consent, true).network).toBe(true);
        expect(reviews(house.provider)).toHaveLength(asked);
      }
      expect(shellNetworkSessionHeld(HOUSEMATE)).toBe(false);
    } finally {
      clearShellNetwork(connection);
    }
  }, 60000);

  test('HOLD: the write is refused, the Optio\'s reason reaches the member, an ask and a tray card are filed', async () => {
    const reason = 'the outline belongs in the digest folder, not the house root';
    await house.serve([writeOutline(), { reply: `HOLD: ${reason}` }, { reply: 'I will move it to the digest folder next time.' }]);
    await house.charter();
    await house.post(HOUSEMATE, 'Outline the first digest.');
    const [row] = await house.ledgerRows(1);
    expect(row.outcome).toBe('escalated');
    expect(row.escalations).toEqual([expect.objectContaining({ kind: 'act', tool: 'fs/write', review: 'hold', why: `the Optio held it: ${reason}` })]);
    await expect(fs.access(outline())).rejects.toThrow();
    // the member's next round carried her reason, so it can correct itself
    expect(said(house.provider.turns[2])).toContain(`HELD it: ${reason}`);
    const [ask] = await readAsks(WALLET);
    expect(ask).toMatchObject({ kind: 'act', tool: 'fs/write', review: 'hold', sessionId: row.sessionId });
    const cards = (await readNotifications(WALLET)).records.filter((n) => n.kind === KIND.houseWake);
    expect(cards.map((c) => c.title)).toContain('The Optio held Quae\'s fs/write — filed for you');
  }, 60000);

  test('a review that fails, or answers too late, is a HOLD — fail closed, to the operator', async () => {
    configureOptioReview({ timeoutMs: 400 });
    const second = path.join(ground, 'second.md');
    await house.serve([
      writeOutline(),
      { status: 500, errorMessage: 'the review server fell over' },
      { reply: `Then the second file. ${call('fs/write', { path: second, content: 'two' })}` },
      { reply: 'CLEAR', delayMs: 2500 },
      { reply: 'Both wait on my operator.' },
    ]);
    await house.charter();
    await house.post(HOUSEMATE, 'Write the two files.');
    const [row] = await house.ledgerRows(1);
    expect(row.outcome).toBe('escalated');
    expect(row.escalations.map((e) => [e.tool, e.review])).toEqual([['fs/write', 'hold'], ['fs/write', 'hold']]);
    expect(row.escalations[0].why).toMatch(/review could not be had .*500/);
    expect(row.escalations[1].why).toMatch(/review could not be had \(no answer within 400 ms\)/);
    await expect(fs.access(outline())).rejects.toThrow();
    await expect(fs.access(second)).rejects.toThrow();
  }, 60000);

  test('a read inside the house\'s ground proceeds with no review call', async () => {
    await fs.writeFile(path.join(ground, 'brief.md'), 'the brief');
    await house.serve([
      { reply: `Let me look at the house folder. ${call('fs/list', { path: ground })}` },
      { reply: 'I see the brief.' },
    ]);
    await house.charter();
    await house.post(HOUSEMATE, 'Look over the house folder.');
    const [row] = await house.ledgerRows(1);
    expect(row).toMatchObject({ outcome: 'done', escalations: [] });
    expect(reviews(house.provider)).toEqual([]);
    expect(house.provider.turns).toHaveLength(2);
    expect(said(house.provider.turns[1])).toContain('brief.md');
  }, 60000);

  test('money out, a delete and a path outside the ground go straight to the operator — no review call', async () => {
    const payee = `0x${'b'.repeat(40)}`;
    await neumaWorkspace.writeSpendAllowlist(HOUSEMATE, { version: 1, entries: [{ address: payee, label: 'supplier', at: new Date().toISOString() }] });
    await neumaWorkspace.writeSpendThreshold(HOUSEMATE, { thresholdEth: 1 });
    const pay = path.join(neumaWorkspace.pathFor(HOUSEMATE), 'intents', 'pay.json');
    const doomed = path.join(ground, 'old-notes.md');
    const outside = path.join(house.office.root, 'outside', 'leak.md');
    await fs.writeFile(doomed, 'old notes');
    await house.serve([
      { reply: call('fs/write', { path: pay, content: JSON.stringify({ type: 'wallet/send', to: payee, value: 0.01, memo: 'supplies' }) }) },
      { reply: call('fs/edit', { path: doomed, delete: true }) },
      { reply: call('fs/write', { path: outside, content: 'out' }) },
      { reply: 'All three wait on my operator.' },
    ]);
    await house.charter();
    await house.post(HOUSEMATE, 'Pay, tidy and copy out.');
    const [row] = await house.ledgerRows(1);
    expect(row.escalations.map((e) => e.tool)).toEqual(['intents/wallet.send', 'fs/edit', 'fs/write']);
    expect(row.escalations.map((e) => e.why)).toEqual([
      expect.stringMatching(/money out/), expect.stringMatching(/delete/), expect.stringMatching(/outside the house's ground/),
    ]);
    expect(reviews(house.provider)).toEqual([]);
    expect(await fs.readFile(doomed, 'utf8')).toBe('old notes');
    await expect(fs.access(outside)).rejects.toThrow();
    expect(await neumaWorkspace.readPendingSpends(HOUSEMATE)).toEqual([]);
  }, 60000);

  test('the same outside read in two wakes is filed once; the seat reads why, and the house\'s ground', async () => {
    const reach = () => ({ reply: call('fs/list', { path: house.office.root }) });
    await house.serve([reach(), { reply: 'It waits on my operator.' }, reach(), { reply: 'Still waiting.' }]);
    await house.charter();
    await house.post(HOUSEMATE, 'Look over the house.');
    await house.ledgerRows(1);
    await house.post(HOUSEMATE, 'Look over the house again.');
    const rows = await house.ledgerRows(2);
    expect(rows.map((r) => r.escalations.map((e) => e.tool))).toEqual([['fs/list'], ['fs/list']]);
    expect((await readAsks(WALLET)).filter((a) => a.tool === 'fs/list')).toHaveLength(1);
    expect((await readNotifications(WALLET)).records.filter((n) => n.kind === KIND.houseWake)).toHaveLength(1);
    const after = said(house.provider.turns[1]);
    expect(after).toContain('outside the house');
    expect(after).toContain(`The house's ground is ${neumaWorkspace.pathFor(HOUSEMATE)}`);
  }, 60000);

  test('a newer held attempt at the same file supersedes the older ask — the operator answers the act as it now stands, once', async () => {
    const attempt = (content) => ({ reply: `Writing the outline again. ${call('fs/write', { path: outline(), content })}` });
    await house.serve([attempt('# draft one'), { reply: 'HOLD: the sources are not opened' }, attempt('# draft two'), { reply: 'HOLD: still not opened' }, { reply: 'It waits on my operator.' }]);
    await house.charter();
    await house.post(HOUSEMATE, 'Outline the first digest.');
    await house.ledgerRows(1);
    const writes = (await readAsks(WALLET)).filter((a) => a.tool === 'fs/write' && a.args?.path === outline());
    const open = writes.filter((a) => a.status === 'open');
    expect(open).toHaveLength(1);
    expect(open[0].args.content).toBe('# draft two');
    expect(writes.find((a) => a.args.content === '# draft one')).toMatchObject({ status: 'closed', closeNote: `superseded by the newer attempt [${open[0].id}]` });
  }, 60000);

  test('a relative path is refused with the seat\'s full path — nothing filed, never read from the backend\'s folder', async () => {
    await house.serve([{ reply: call('fs/list', { path: 'charter' }) }, { reply: 'I will name the full path.' }]);
    await house.charter();
    await house.post(HOUSEMATE, 'Look over the charter folder.');
    const [row] = await house.ledgerRows(1);
    expect(row.escalations).toEqual([]);
    expect(await readAsks(WALLET)).toEqual([]);
    expect(reviews(house.provider)).toEqual([]);
    expect(said(house.provider.turns[1])).toContain(`you likely mean ${path.join(neumaWorkspace.pathFor(HOUSEMATE), 'charter')}`);
  }, 60000);

  test('the Optio\'s own gated act goes to the operator — she never reviews herself', async () => {
    await house.serve([
      { reply: call('fs/write', { path: outline(), content: '# The Optio\'s outline' }) },
      { reply: 'My write waits on my operator.' },
    ]);
    await house.charter();
    await house.post(OPTIO, 'Outline the digest yourself.', HOUSEMATE);
    const [row] = await house.ledgerRows(1);
    expect(row).toMatchObject({ seat: OPTIO, outcome: 'escalated' });
    expect(row.escalations).toEqual([expect.objectContaining({ tool: 'fs/write', why: expect.stringMatching(/Optio's own acts/) })]);
    expect(reviews(house.provider)).toEqual([]);
    await expect(fs.access(outline())).rejects.toThrow();
  }, 60000);

  test('a team member\'s gated intent is reviewed the same way: CLEAR settles it, HOLD refuses it with the reason', async () => {
    const intents = path.join(neumaWorkspace.pathFor(BYSTANDER), 'intents');
    const first = path.join(intents, 'task-outline.json');
    const second = path.join(intents, 'task-again.json');
    const arena = path.join(house.office.root, 'arena');
    await fs.mkdir(arena, { recursive: true });
    await house.serve([
      { reply: `I will record the outline task on my ledger. ${call('fs/write', { path: first, content: JSON.stringify({ type: 'tasks/add', title: 'Outline the digest' }) })}` },
      { reply: 'CLEAR' },
      { reply: `And once more. ${call('fs/write', { path: second, content: JSON.stringify({ type: 'tasks/add', title: 'Outline the digest' }) })}` },
      { reply: 'HOLD: that task duplicates the one just recorded' },
      { reply: 'The outline task is recorded.\nSTATUS:\ndone' },
    ]);
    await house.charter();
    const { text } = await runMemberTurn({
      neumaId: BYSTANDER, name: 'Cosi', wallet: WALLET, brief: 'Your part: outline the first digest.',
      workspace: { root: arena, budgetBytes: 1024 * 1024, usedBytes: 0 },
    });
    expect(text).toContain('The outline task is recorded.');
    const result = async (file) => JSON.parse(await fs.readFile(file.replace(/\.json$/, '.result.json'), 'utf8'));
    expect((await result(first)).status).toBe('done');
    expect(await result(second)).toMatchObject({ status: 'denied', reason: expect.stringContaining('duplicates the one just recorded') });
    const [shown] = reviews(house.provider).map((t) => t.messages[1].content);
    expect(shown).toContain('THE ACT: intents/tasks.add');
    expect(shown).toContain('Your part: outline the first digest.');
    expect(shown).toContain('I will record the outline task on my ledger.');
    expect(await readAsks(WALLET)).toEqual([expect.objectContaining({ tool: 'intents/tasks.add', review: 'hold', seat: BYSTANDER })]);
  }, 60000);
});
