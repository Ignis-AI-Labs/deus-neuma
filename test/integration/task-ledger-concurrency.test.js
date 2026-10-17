/**
 * The being's task ledger under CONCURRENT writers. NO MOCKS.
 *
 * One ledger file is shared by every chat a being holds — which is the entire
 * point of the chat-scoping design — and by the act recorder, which writes
 * after EVERY successful tool act in every one of those chats. Each mutation
 * is read → pure transform → write, and `_writeJSON` is crash-atomic but NOT
 * serialized: it cannot stop a second writer that read the same bytes from
 * overwriting the first.
 *
 * Measured before the fix: two `tasks/add` intents filed at the same moment
 * left ONE task on the ledger. The being had already been told "Recorded
 * [id]" for both. Silent loss of the exact record that exists so an
 * interruption leaves an honest half-finished task rather than an untouched
 * one — and nothing anywhere says it happened.
 *
 * Everything here is real: the real sovereign workspace on a temp root with
 * real DEK encryption at rest, the real intent executors from the live
 * surface (`tasks/*`), the real act recorder, and real concurrency via
 * Promise.all. The only fixture is the temp directory.
 *
 * Control: revert `updateTaskLedger` to a bare read/write and these fail.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { taskAddIntent, taskFocusIntent } from '../../backend/services/intents/task-acts.js';
import { recordWorkAgainstFocus } from '../../backend/services/portal-tool-loop.js';

const NEUMA_ID = 'ledger-concurrency-probe';

/** A real connection shape: the lane it speaks for, and the chat it stands in. */
const chat = (sessionId) => ({
  companion: { neumaId: NEUMA_ID, name: 'Probe', kind: 'neuma' },
  sessionId,
  walletAddress: `0x${'11'.repeat(20)}`,
});

const fileTask = (connection, title) =>
  taskAddIntent.execute({ title }, { connection });

const ledgerNow = () => neumaWorkspace.readTaskLedger(NEUMA_ID);

beforeEach(async () => {
  setWorkspacesRoot(await createTempDir('ledger-concurrency'));
  await neumaWorkspace.writeTaskLedger(NEUMA_ID, { tasks: [] });
});

describe('the task ledger under concurrent writers', () => {
  test('two chats filing at the same moment BOTH keep their task', async () => {
    // The plain lost-update case, through the real intent executor.
    const results = await Promise.all([
      fileTask(chat('session-a'), 'work from chat A'),
      fileTask(chat('session-b'), 'work from chat B'),
    ]);
    // Both were TOLD they landed — so both must actually be there.
    expect(results.every((r) => r.ok)).toBe(true);

    const { tasks } = await ledgerNow();
    expect(tasks.map((t) => t.title).sort()).toEqual(['work from chat A', 'work from chat B']);
  });

  test('a burst of ten adds loses none of them', async () => {
    // One racing pair can pass by luck; ten cannot.
    const titles = Array.from({ length: 10 }, (_, i) => `task ${i}`);
    await Promise.all(titles.map((t, i) => fileTask(chat(`session-${i}`), t)));

    const { tasks } = await ledgerNow();
    expect(tasks).toHaveLength(10);
    expect(tasks.map((t) => t.title).sort()).toEqual(titles.slice().sort());
  });

  test('the act recorder does not eat a task another chat is filing', async () => {
    // The highest-frequency writer in the system: it fires after every
    // successful act, in every chat. Chat A has work in hand and is recording
    // against it; chat B files something new at the same moment.
    const a = chat('session-a');
    const filed = await fileTask(a, 'the work in hand');
    const id = filed.detail.match(/\[([0-9a-f]{8})\]/)[1];
    const focused = await taskFocusIntent.execute({ id }, { connection: a });
    expect(focused.ok).toBe(true);

    await Promise.all([
      recordWorkAgainstFocus(a, 'write', { path: '/repo/one.js' }),
      recordWorkAgainstFocus(a, 'write', { path: '/repo/two.js' }),
      fileTask(chat('session-b'), 'filed from the other chat'),
    ]);

    const { tasks } = await ledgerNow();
    expect(tasks.map((t) => t.title).sort())
      .toEqual(['filed from the other chat', 'the work in hand']);
    // …and the work recorded against the focused task survived too.
    const held = tasks.find((t) => t.title === 'the work in hand');
    expect(held.work?.artifacts?.length).toBeGreaterThan(0);
  });

  test('a refused focus writes nothing at all', async () => {
    // setFocus refuses a blocked task. The refusal must leave the ledger
    // untouched — writing and then reporting the refusal would put the being's
    // record and its answer in disagreement.
    const a = chat('session-a');
    const blocker = await fileTask(a, 'must finish first');
    const blockerId = blocker.detail.match(/\[([0-9a-f]{8})\]/)[1];
    const full = (await ledgerNow()).tasks.find((t) => t.id.startsWith(blockerId)).id;

    await taskAddIntent.execute(
      { title: 'waits on the other', blockedBy: [full] }, { connection: a },
    );
    const before = await ledgerNow();
    const blocked = before.tasks.find((t) => t.title === 'waits on the other');

    const out = await taskFocusIntent.execute({ id: blocked.id }, { connection: a });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/waiting on/i);

    // Byte-for-byte the same ledger: no focus pointer, no status change.
    expect(await ledgerNow()).toEqual(before);
  });
});
