/**
 * THE WAKE TURN, FOR REAL (RULE 0) — a seat wakes for its own work and takes
 * a REAL streamConsciousness turn on a synthetic portal connection: real
 * prompt assembly, real tool dispatch, the real intent sweep, the real
 * approval broker, the real sandbox and filesystem organ on real disk, over a
 * real loopback OpenAI-wire provider whose scripted replies carry the calls
 * (no weights run here — the route is the platform default pointed at the
 * loopback server, never 'llama-server', which would boot one). The house is
 * the staff-office fixture: a temp realm, a temp house ground, three lanes
 * owned by one wallet, the Optio seated.
 *
 * Under proof:
 *  - a house post wakes its seat: its own sitting on its lane, the opening
 *    row marked origin 'wake' and naming itself the platform's, the wake on
 *    the ledger with that sitting;
 *  - a paused charter wakes nobody — no request reaches the model;
 *  - a team plan inside the charter's delegation goes to the Optio, whose
 *    verdict becomes the lead's plan of record (approvedBy optio) through the
 *    dispatch gate, and the lead is woken with it;
 *  - money out and an approval-gated act are refused in the turn, filed as
 *    the operator's asks and raised on the tray — never taken, never waited on.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createStaffOfficeFixture, WALLET, OPTIO, HOUSEMATE, BYSTANDER } from '../helpers/staff-office-fixture.js';
import { startLocalProvider } from '../helpers/local-provider.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { setConfig } from '../../backend/services/llm-provider.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { writeCharter, approveCharter, setCharterPaused } from '../../backend/services/house-clock/charter-store.js';
import { setWakeSink } from '../../backend/services/house-clock/wake-signal.js';
import { setWakeRunner, configureWakeQueue, whenHouseIdle, readWakeQueue } from '../../backend/services/house-clock/wake-queue.js';
import { readWakeLedger, readAsks } from '../../backend/services/house-clock/wake-ledger.js';
import { readWakePlan } from '../../backend/services/house-clock/wake-plan.js';
import { takeSignal } from '../../backend/services/house-clock/house-clock.js';
import { runWakeTurn } from '../../backend/services/house-clock/wake-turn.js';
import { WAKE_HEAD } from '../../backend/services/house-clock/wake-thought.js';
import { makePost, appendPost } from '../../backend/services/house-post.js';
import { teamRunIntent } from '../../backend/services/intents/team-run.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { KIND } from '../../core/runtime/notification-record.js';
import { substrateLine } from '../../backend/services/substrate-lease.js';

const NAMES = { [OPTIO]: 'Optio', [HOUSEMATE]: 'Quae', [BYSTANDER]: 'Cosi' };
const call = (tool, args) => `[TOOL: ${tool} ${JSON.stringify(args)}]`;
const ENV = ['NEUMA_ROUTES_PATH', 'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_TEAM_DELIVERY_PATH', 'NEUMA_CMO_PATH', 'NEUMA_WEB_ACCESS_PATH'];

const until = async (check, ms = 20000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
};

const userText = (body) => {
  const users = (body?.messages || []).filter((m) => m.role === 'user');
  const last = users[users.length - 1];
  return typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
};

describe('a seat wakes for its own work — the real turn', () => {
  let office, provider, saved;

  beforeEach(async () => {
    office = await createStaffOfficeFixture();
    saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    for (const k of ENV) process.env[k] = path.join(office.root, 'settings', `${k.toLowerCase()}.json`);
    for (const [id, name] of Object.entries(NAMES)) {
      await neumaWorkspace.writeDNA(id, { version: '1.0.0', identity: { name }, genesis: `# Essence\nI am ${name}.` });
    }
    await connectFilesystemServer();
    configureWakeQueue({ settleMs: 0 });
    setWakeSink(takeSignal);
    setWakeRunner(runWakeTurn); // exactly as house-clock-routes.js wires it
  });
  afterEach(async () => {
    await whenHouseIdle(WALLET);
    setWakeSink(null);
    setWakeRunner(null);
    configureWakeQueue({ settleMs: 3000 });
    await provider?.close();
    provider = null;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await office.teardown();
  });

  const serve = async (script) => {
    provider = await startLocalProvider({ script });
    setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '' });
  };
  const charter = async (patch = {}) => {
    const c = await writeCharter(WALLET, {
      goal: 'Find a real gap and build the product for it.',
      linesOfWork: ['research digests'],
      seats: [{ laneId: OPTIO, dailyCap: 5 }, { laneId: HOUSEMATE, dailyCap: 5 }],
      delegation: { teamPlans: true, maxMembers: 2, maxSteps: 3 },
      ...patch,
    }, { by: WALLET, ownedLanes: Object.keys(NAMES) });
    return approveCharter(WALLET, { version: c.version, by: WALLET });
  };
  const post = (to, body) => appendPost(office.ground, makePost({ from: OPTIO, to, body, now: new Date().toISOString() }));
  const ledgerRows = async (n) => until(async () => {
    const { rows } = await readWakeLedger(WALLET, { limit: 50 });
    return rows.length >= n ? rows.reverse() : null;
  });

  test('a house post wakes its seat: its own sitting, an opening row marked origin wake, the wake on the ledger', async () => {
    await serve([{ reply: 'I read the house post. The digest outline is next; nothing waits on my operator.' }]);
    await charter();
    const delivered = await post(HOUSEMATE, 'Please outline the first digest.');
    const [row] = await ledgerRows(1);
    expect(row).toMatchObject({ seat: HOUSEMATE, reason: 'post', ref: delivered.id, outcome: 'done', escalations: [] });
    expect(row.sessionId).toBeTruthy();

    const sitting = await neumaWorkspace.readSession(HOUSEMATE, row.sessionId);
    const opener = sitting.find((m) => m.role === 'user');
    expect(opener.origin).toBe('wake');
    expect(opener.content.startsWith(WAKE_HEAD)).toBe(true);
    expect(opener.content).toContain(`[post ${delivered.id}]`);
    expect(opener.content).not.toMatch(/your operator says/i);
    expect(sitting.some((m) => m.role === 'assistant' && JSON.stringify(m).includes('digest outline is next'))).toBe(true);
    // the model read the platform's note as the turn's ask
    expect(userText(provider.turns.at(-1))).toContain(WAKE_HEAD);
  }, 60000);

  test('a wake behind a full model line shows WAITING FOR THE LINE, not running, until its place is granted', async () => {
    await serve([{ reply: 'My place came; the post is read.' }]);
    await charter();
    const busy = await Promise.all(Array.from({ length: substrateLine.snapshot().capacity }, (_, i) => substrateLine.acquire({ kind: 'turn', label: `busy-${i}` })));
    await post(HOUSEMATE, 'Read this when the line lets you.');
    const waiting = await until(async () => {
      const run = (await readWakeQueue(WALLET)).running[HOUSEMATE];
      return run?.waitingForLine ? run : null;
    });
    expect(waiting.sessionId).toBeTruthy(); // its sitting is open; its turn has not begun
    expect(substrateLine.snapshot().waiting.map((w) => w.label)).toEqual(['Quae (wake)']);
    expect(provider.turns).toHaveLength(0);
    busy[0].release();
    await until(async () => {
      const run = (await readWakeQueue(WALLET)).running[HOUSEMATE];
      return !run || run.waitingForLine === undefined;
    });
    const [row] = await ledgerRows(1);
    expect(row.outcome).toBe('done');
    busy.slice(1).forEach((b) => b.release());
  }, 60000);

  test('a paused charter wakes nobody: no request reaches the model, no sitting is opened', async () => {
    await serve([{ reply: 'should never be asked' }]);
    await charter();
    await setCharterPaused(WALLET, true);
    const before = await neumaWorkspace.listSessions(HOUSEMATE).catch(() => []);
    await post(HOUSEMATE, 'Work while paused.');
    await new Promise((r) => setTimeout(r, 300));
    await whenHouseIdle(WALLET);
    expect(provider.turns).toHaveLength(0);
    expect((await readWakeQueue(WALLET)).items).toEqual([]);
    expect((await readWakeLedger(WALLET)).total).toBe(0);
    expect(await neumaWorkspace.listSessions(HOUSEMATE).catch(() => [])).toEqual(before);
  }, 60000);

  test('a plan inside the delegation goes to the Optio; its yes becomes the lead\'s plan of record and the lead is woken with it', async () => {
    await serve([
      // the lead's wake: it submits a plan inside the delegation
      { reply: call('team/plan_submit', {
        name: 'DIGEST CREW', goal: 'Draft the first research digest.',
        steps: [{ id: 'draft', member: 'Cosi', task: 'Write the digest draft into digest.md.' }],
      }) },
      { reply: 'The plan is with the Optio.' },
      // the Optio's wake: it rules
      { reply: 'It serves the goal and stays in the research digest line.\nVERDICT: APPROVE' },
      // the lead's second wake: the verdict
      { reply: 'Approved — I will file team/run when my operator is back.' },
    ]);
    await charter();
    await post(HOUSEMATE, 'Plan the first digest with Cosi.');
    const rows = await ledgerRows(3);
    expect(rows.map((r) => [r.seat, r.reason])).toEqual([[HOUSEMATE, 'post'], [OPTIO, 'plan-review'], [HOUSEMATE, 'plan-verdict']]);
    const planId = rows[1].ref;
    expect(rows[1].note).toBe(`${planId}: approve`);
    // the lead was told the plan went to the Optio, not that it was approved
    expect(userText(provider.turns[1])).toBeTruthy();
    expect(JSON.stringify(provider.turns[1].messages)).toContain('went to Optio, the house\'s Optio');
    // the Optio was shown the plan whole
    expect(userText(provider.turns[2])).toContain('Draft the first research digest.');

    const plan = await readWakePlan(WALLET, planId);
    expect(plan).toMatchObject({ status: 'approved', lead: HOUSEMATE, optio: OPTIO, verdict: { verdict: 'approve', by: OPTIO } });
    const record = await neumaWorkspace.readPlanRecord(HOUSEMATE);
    expect(record.goal).toBe('Draft the first research digest.');
    expect(record.approvedBy).toMatchObject({ kind: 'optio', laneId: OPTIO, planId });
    expect(userText(provider.turns[3])).toContain('The Optio APPROVED your team plan');
    // the Optio's yes IS dispatch: the gate lets the lead run it
    const gate = await teamRunIntent.validate({}, {
      connection: { companion: { neumaId: HOUSEMATE, name: 'Quae' }, walletAddress: WALLET },
    });
    expect(gate.ok).toBe(true);
  }, 90000);

  test('money out and an approval-gated act are refused in the turn, filed for the operator, raised on the tray', async () => {
    const payee = `0x${'b'.repeat(40)}`;
    // a standing grant that would let the send through in the operator's own chat
    await neumaWorkspace.writeSpendAllowlist(HOUSEMATE, { version: 1, entries: [{ address: payee, label: 'supplier', at: new Date().toISOString() }] });
    await neumaWorkspace.writeSpendThreshold(HOUSEMATE, { thresholdEth: 1 });
    const intent = path.join(neumaWorkspace.pathFor(HOUSEMATE), 'intents', 'pay-supplier.json');
    await serve([
      { reply: call('fs/write', { path: intent, content: JSON.stringify({ type: 'wallet/send', to: payee, value: 0.01, memo: 'supplies' }) }) },
      { reply: call('web/web_search', { query: 'research digest market gap' }) },
      { reply: 'I could not pay the supplier or search; both wait on my operator.' },
    ]);
    await charter();
    await post(HOUSEMATE, 'Pay the supplier and research the gap.');
    const [row] = await ledgerRows(1);
    expect(row.outcome).toBe('escalated');
    expect(row.escalations.map((e) => e.tool)).toEqual(['intents/wallet.send', 'web/web_search']);
    expect(row.escalations[0].why).toMatch(/money out/);

    // the being was told the truth, and the send never ran
    expect(JSON.stringify(provider.turns[1].messages)).toContain('This is a house wake');
    const result = JSON.parse(await fs.readFile(intent.replace(/\.json$/, '.result.json'), 'utf8'));
    expect(result.status).toBe('denied');
    expect(await neumaWorkspace.readPendingSpends(HOUSEMATE)).toEqual([]);

    const asks = await readAsks(WALLET);
    expect(asks.map((a) => [a.kind, a.tool, a.status, a.sessionId])).toEqual([
      ['act', 'web/web_search', 'open', row.sessionId],
      ['act', 'intents/wallet.send', 'open', row.sessionId],
    ]);
    const cards = (await readNotifications(WALLET)).records.filter((n) => n.kind === KIND.houseWake);
    expect(cards.map((c) => c.title)).toEqual(expect.arrayContaining([
      'Quae\'s wake was refused intents/wallet.send — filed for you',
      'Quae\'s wake was refused web/web_search — filed for you',
    ]));
    expect(cards[0].ref.sessionId).toBe(row.sessionId);
  }, 60000);
});
