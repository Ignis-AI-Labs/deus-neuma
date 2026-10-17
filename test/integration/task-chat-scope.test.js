// Per-chat task lists — the REAL task path (acts through the intent sweep
// since #414, the list through the handler), the REAL policy gate, the REAL
// encrypted workspace, REAL disk, and the REAL prompt assembler (RULE 0: no
// mock, stub, or spy anywhere in the path being claimed). The claim under
// proof is Founder's: a being holding two chats records work in each, and neither
// chat's list crowds the other's turn.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { taskCaller } from '../helpers/task-path.js';
import { intentType } from '../../backend/services/intents/registry.js';
import { assemblePromptSections } from '../../core/runtime/prompt-assembler.js';
import { addUserTask, addUserTaskBundle, getUserTasks } from '../../backend/services/user-tasks.js';
// The realm's isolation door. Setting NEUMA_REALM_ROOT is NOT enough on its
// own: that env var is only read by applyRealmSettings() at BOOT, and a test
// that drives the stores directly never boots. Without this call the operator
// list below writes into the witness's REAL realm and accumulates there across
// every run (observed 2026-08-03: 30 'Train legs' tasks under a fake wallet,
// which eventually tripped the live cap and turned this file red). Same class
// of trap as a bare driver skipping loadConfig().
import { setRealmRoot, getRealmRoot } from '../../backend/services/user-realm.js';
import { focusedTaskId, taskState } from '../../core/tasks/task-work.js';

const { _handleTaskTool, TASK_TOOLS, _recordWorkAgainstFocus } = __test;

const KEY = 'gnosis-task-chat-scope-key-long-enough';
const CHAT_A = 'session-1754000000000';
const CHAT_B = 'session-1754999999999';

// The WORKING STATE section as the being would actually receive it, built from
// whatever is genuinely on disk right now.
const workingState = async (neumaId, chatId) => {
  const taskLedger = await workspace.readTaskLedger(neumaId);
  const section = assemblePromptSections({ taskLedger, chatId }).find((s) => s.id === 'tasks');
  return section?.text ?? '';
};

describe('per-chat task lists — two parallel chats, one being, real disk', () => {
  let prevKey, prevRealm, prevRealmRoot, neumaId, connection, events;
  const ws = { send: (raw) => events.push(JSON.parse(raw)) };

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;

    const root = await createTempDir('task-chat-scope');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    // The realm is the operator's own store — isolated through its launch-scoped
    // door so this run never touches the real one.
    prevRealm = process.env.NEUMA_REALM_ROOT;
    process.env.NEUMA_REALM_ROOT = path.join(root, 'realm');
    prevRealmRoot = getRealmRoot();
    setRealmRoot(path.join(root, 'realm'));
    neumaId = 'chat-scope-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    // The same connection shape production passes — the chat it is bound to
    // rides on `sessionId`, which is what the handler stamps from.
    connection = { companion: { name: 'Prooflet', neumaId }, _sessionToolPolicy: null, sessionId: CHAT_A };
    events = [];
  });

  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    if (prevRealm === undefined) delete process.env.NEUMA_REALM_ROOT;
    else process.env.NEUMA_REALM_ROOT = prevRealm;
    if (prevRealmRoot) setRealmRoot(prevRealmRoot);
  });

  const call = taskCaller({ ws, handler: _handleTaskTool, connection: () => connection });
  const inChat = (chatId) => { connection.sessionId = chatId; };

  it('offers scope on both write acts, so the being can say where work belongs', () => {
    // The acts are intents (#414): what the being is SHOWN is its INTENTS
    // section's fields line, not a JSON schema. Assert what it actually reads.
    for (const name of ['tasks/add', 'tasks/update']) {
      expect(intentType(name)?.fieldsForPrompt, name).toContain('scope');
      expect(intentType(name)?.descriptionForPrompt, name).toContain('lane');
    }
    expect(TASK_TOOLS.map((t) => t.name)).toEqual(['task_list']);
  });

  it('stamps the chat the being was standing in, and persists it encrypted at rest', async () => {
    inChat(CHAT_A);
    const added = await call('task_add', { title: 'Wire the polarity screen', detail: 'forge work' });
    expect(added.status).toBe('ok');
    expect(added.content).toContain('in this chat');

    // Read it back off real disk — not from the return value.
    const ledger = await workspace.readTaskLedger(neumaId);
    const task = ledger.tasks.find((t) => t.title === 'Wire the polarity screen');
    expect(task.chatId).toBe(CHAT_A);
  });

  it('THE ASK: chat A\'s work does not ride chat B\'s turn, and vice versa', async () => {
    inChat(CHAT_B);
    const added = await call('task_add', { title: 'Draft the launch post' });
    expect(added.status).toBe('ok');

    const inA = await workingState(neumaId, CHAT_A);
    expect(inA).toContain('Wire the polarity screen');
    expect(inA).not.toContain('Draft the launch post');

    const inB = await workingState(neumaId, CHAT_B);
    expect(inB).toContain('Draft the launch post');
    expect(inB).not.toContain('Wire the polarity screen');
  });

  it('scope lane records work that stands in EVERY chat', async () => {
    inChat(CHAT_A);
    const added = await call('task_add', { title: 'Keep the attempt log pruned', scope: 'lane' });
    expect(added.content).toContain('in every chat');

    const ledger = await workspace.readTaskLedger(neumaId);
    const task = ledger.tasks.find((t) => t.title === 'Keep the attempt log pruned');
    expect('chatId' in task).toBe(false);

    for (const chatId of [CHAT_A, CHAT_B]) {
      expect(await workingState(neumaId, chatId)).toContain('Keep the attempt log pruned');
    }
  });

  it('a being cannot name a chat it is not standing in — raw chatId is refused, loudly', async () => {
    inChat(CHAT_A);
    // A model that invents `chatId` (it is not in the schema) used to have the
    // field SILENTLY STRIPPED — the call read as accepted while the work filed
    // where the being stood. The loud-fields law (2026-09-20) refuses it
    // instead: the ask is named as impossible, and nothing lands anywhere.
    const res = await call('task_add', { title: 'Smuggled into B', chatId: CHAT_B });
    expect(res.status).toBe('error');
    expect(res.error).toMatch(/unknown field\(s\) "chatId"/);

    const ledger = await workspace.readTaskLedger(neumaId);
    expect(ledger.tasks.some((t) => t.title === 'Smuggled into B')).toBe(false);
    expect(await workingState(neumaId, CHAT_B)).not.toContain('Smuggled into B');
  });

  it('scope moves a mis-filed task to every chat, and back into this one', async () => {
    inChat(CHAT_A);
    const added = await call('task_add', { title: 'Wandering work' });
    const shortId = added.content.match(/\[([0-9a-f]{8})\]/)[1];

    await call('task_update', { id: shortId, scope: 'lane' });
    expect(await workingState(neumaId, CHAT_B)).toContain('Wandering work');

    inChat(CHAT_B);
    await call('task_update', { id: shortId, scope: 'chat' });
    expect(await workingState(neumaId, CHAT_B)).toContain('Wandering work');
    expect(await workingState(neumaId, CHAT_A)).not.toContain('Wandering work');
  });

  it('an update with no scope leaves the work exactly where it was', async () => {
    inChat(CHAT_A);
    const added = await call('task_add', { title: 'Stays put' });
    const shortId = added.content.match(/\[([0-9a-f]{8})\]/)[1];

    inChat(CHAT_B); // updating from a DIFFERENT chat must not re-file it
    await call('task_update', { id: shortId, status: 'active' });

    const ledger = await workspace.readTaskLedger(neumaId);
    expect(ledger.tasks.find((t) => t.title === 'Stays put').chatId).toBe(CHAT_A);
  });

  it('task_list gives the being the whole truth, sorted by which chat holds it', async () => {
    inChat(CHAT_A);
    const listed = await call('task_list', {});
    expect(listed.status).toBe('ok');
    expect(listed.content).toContain('Live in this chat:');
    expect(listed.content).toContain('Wire the polarity screen');
    expect(listed.content).toContain('Live in every chat:');
    expect(listed.content).toContain('Keep the attempt log pruned');
    // Nothing is hidden from a deliberate ask — the other chat is named as such.
    expect(listed.content).toContain('Live in your other chats (not this one):');
    expect(listed.content).toContain('Draft the launch post');
  });

  it('the durable settled record remembers which chat the work was finished under', async () => {
    inChat(CHAT_A);
    const added = await call('task_add', { title: 'Finished in A' });
    const shortId = added.content.match(/\[([0-9a-f]{8})\]/)[1];
    await call('task_update', { id: shortId, status: 'done' });

    const history = await workspace.readTaskHistory(neumaId);
    const entry = history.find((h) => h.title === 'Finished in A');
    expect(entry.status).toBe('done');
    expect(entry.chatId).toBe(CHAT_A);
  });

  it('a CROOKED session binding never costs the being its ability to record work', async () => {
    // portal-routes.js sets connection.sessionId straight from the client's
    // `portal:resume` frame with no shape check. If a crooked id reached the
    // stamp, the being would be told ITS OWN tool call was malformed and could
    // record nothing at all in that chat. It files lane-wide instead: worse
    // organization, but the work is never lost and never refused.
    for (const crooked of ['../../etc/passwd', 'has spaces', 'x'.repeat(200), 42]) {
      connection.sessionId = crooked;
      const added = await call('task_add', { title: `Crooked ${String(crooked).slice(0, 6)}` });
      expect(added.status).toBe('ok');
      expect(added.content).toContain('in every chat');
    }

    connection.sessionId = '../../etc/passwd';
    const listed = await call('task_list', {});
    expect(listed.status).toBe('ok');
    // And the turn still assembles — a crooked binding shows the whole ledger
    // rather than narrowing to nothing.
    const whole = await workingState(neumaId, null);
    expect(whole).toContain('Wire the polarity screen');
  });

  it('the OPERATOR\'S OWN list refuses a chat stamp from every door', async () => {
    // Founder's ruling: the ME list is his life — training, errands, milestones —
    // never the work of one conversation. It shares the assigned-plan SHAPE
    // (which understands chatId), and a being can write to it through
    // operator_task_add, so the store itself strips the field rather than
    // trusting every caller not to send it. Real realm disk, no mock.
    const wallet = '0x00000000000000000000000000000000deadbeef';
    await addUserTask(wallet, { title: 'Train legs', cadence: 'weekly', chatId: CHAT_A });
    await addUserTaskBundle(wallet, { title: 'Renew the passport', cadence: 'once', chatId: CHAT_B, subtasks: ['book the appointment'] });

    const plan = await getUserTasks(wallet);
    for (const title of ['Train legs', 'Renew the passport']) {
      const task = plan.tasks.find((t) => t.title === title);
      expect(task).toBeDefined();
      expect('chatId' in task).toBe(false);
    }
  });

  it('a connection with no chat yet files work lane-wide and shows the whole ledger', async () => {
    // The honest fallback: a missing chat is not evidence that work belongs
    // elsewhere, so nothing is hidden and nothing is misfiled.
    connection.sessionId = null;
    const added = await call('task_add', { title: 'No chat bound' });
    expect(added.content).toContain('in every chat');

    const whole = await workingState(neumaId, null);
    expect(whole).toContain('Wire the polarity screen');
    expect(whole).toContain('Draft the launch post');
    expect(whole).toContain('No chat bound');
  });
});


// LOAD-BEARING WORK CANNOT BE STARTED EARLY (Design note, 2026-08-03: […]). Real tool handler, real encrypted disk, real prompt
// assembler — the gate is only real if it holds at the door a being goes
// through, not in a pure function nobody calls.
describe('size and hard blocking — through the real tool surface', () => {
  let prevKey, neumaId, connection, events;
  const CHAT = 'session-1754555555555';
  const ws = { send: (raw) => events.push(JSON.parse(raw)) };

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const root = await createTempDir('task-blocking');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'block-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    connection = { companion: { name: 'Blocklet', neumaId }, _sessionToolPolicy: null, sessionId: CHAT };
    events = [];
  });

  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  const call = taskCaller({ ws, handler: _handleTaskTool, connection: () => connection });
  const idOf = (res) => res.content.match(/\[([0-9a-f]{8})\]/)[1];
  const byTitle = async (title) =>
    (await workspace.readTaskLedger(neumaId)).tasks.find((t) => t.title === title);

  it('a task carries its size to disk, and the size can be taken back', async () => {
    const added = await call('task_add', { title: 'Lay the schema', size: 'deep' });
    expect(added.status).toBe('ok');
    expect((await byTitle('Lay the schema')).size).toBe('deep');

    // A first guess that turned out wrong must stay retractable.
    await call('task_update', { id: idOf(added), size: null });
    expect((await byTitle('Lay the schema')).size).toBeUndefined();
    await call('task_update', { id: idOf(added), size: 'deep' });

    const wrong = await call('task_add', { title: 'Mis-sized', size: 'enormous' });
    expect(wrong.status).toBe('error');
    expect(wrong.error).toContain('quick, half, deep, epic');
  });

  it('REFUSES to focus load-bearing work, and the refusal names the blocker', async () => {
    const blocker = await byTitle('Lay the schema');
    const added = await call('task_add', {
      title: 'Build on the schema',
      size: 'half',
      blockedBy: [blocker.id.slice(0, 8)], // the prefix id its ledger lines print
    });
    expect(added.status).toBe('ok');
    expect((await byTitle('Build on the schema')).blockedBy).toEqual([blocker.id]);

    const refused = await call('task_focus', { id: idOf(added) });
    expect(refused.status).toBe('error');
    expect(refused.error).toContain('Lay the schema');

    // AND NOTHING MOVED. A refusal that still flipped the task to active — or
    // pointed the chat's focus at it — would let work be recorded against a
    // task that was never allowed to start.
    const ledger = await workspace.readTaskLedger(neumaId);
    expect(ledger.tasks.find((t) => t.title === 'Build on the schema').status).toBe('open');
    expect(focusedTaskId(ledger, CHAT)).toBeNull();
  });

  it('the being READS the block in its own prompt, blocker named, workable work first', async () => {
    const ledger = await workspace.readTaskLedger(neumaId);
    const section = assemblePromptSections({ taskLedger: ledger, chatId: CHAT })
      .find((s) => s.id === 'tasks');
    expect(section.text).toContain('BLOCKED, waiting on');
    expect(section.text).toContain('Lay the schema');
    expect(section.text).toContain('DEEP');
    // What it CAN pick up is read first; what it cannot sinks to the bottom.
    expect(section.text.indexOf('Lay the schema')).toBeLessThan(section.text.indexOf('Build on the schema'));
    // And the law it is being asked to follow rides with it.
    expect(section.text).toContain('blockedBy');
  });

  it('SETTLING THE BLOCKER IS THE UNBLOCK — nothing has to remember to undo it', async () => {
    const blocker = await byTitle('Lay the schema');
    await call('task_update', { id: blocker.id.slice(0, 8), status: 'done' });

    const waiting = await byTitle('Build on the schema');
    // The link is untouched on disk — it is still true that this waited on that.
    expect(waiting.blockedBy).toEqual([blocker.id]);
    // But the door opens, because blocked is DERIVED from the blocker's status.
    const focused = await call('task_focus', { id: waiting.id.slice(0, 8) });
    expect(focused.status).toBe('ok');
    expect((await byTitle('Build on the schema')).status).toBe('active');
  });

  it('BLOCKING WORK THAT IS IN HAND TAKES IT OUT OF HAND', async () => {
    // The block arrives AFTER the focus door was passed: focus an open task,
    // then learn it waits on something else. Left in focus, the being would go
    // on recording real work against a task it could no longer be given —
    // artifacts saying it was worked while the door says it could never start.
    const later = await call('task_add', { title: 'Started, then blocked' });
    await call('task_focus', { id: idOf(later) });
    expect(focusedTaskId(await workspace.readTaskLedger(neumaId), CHAT))
      .toBe((await byTitle('Started, then blocked')).id);

    const gate = await call('task_add', { title: 'Turned out to come first' });
    const blocked = await call('task_update', {
      id: idOf(later),
      blockedBy: [idOf(gate)],
    });
    expect(blocked.status).toBe('ok');

    // Out of hand — and the being's next attempt is refused with the reason.
    expect(focusedTaskId(await workspace.readTaskLedger(neumaId), CHAT)).toBeNull();
    const refused = await call('task_focus', { id: idOf(later) });
    expect(refused.status).toBe('error');
    expect(refused.error).toContain('Turned out to come first');

    // Another chat's focus on OTHER work is untouched — only this task is lifted.
    await call('task_update', { id: idOf(later), blockedBy: null });
    expect((await call('task_focus', { id: idOf(later) })).status).toBe('ok');
  });

  it('AFTER THE LIFT, the real recorder attributes nothing to the blocked task', async () => {
    // Closes the last window where […]: the recorder re-reads the ledger and finds no
    // focus, so it files nothing — driven through the REAL seam, not simulated.
    const t = await call('task_add', { title: 'Recorded then blocked' });
    await call('task_focus', { id: idOf(t) });
    await _recordWorkAgainstFocus(connection, 'write_file', { path: '/before.js' });
    expect((await byTitle('Recorded then blocked')).work.artifacts).toHaveLength(1);

    const gate = await call('task_add', { title: 'Should have come first' });
    await call('task_update', { id: idOf(t), blockedBy: [idOf(gate)] });

    await _recordWorkAgainstFocus(connection, 'write_file', { path: '/after.js' });
    const after = await byTitle('Recorded then blocked');
    expect(after.work.artifacts).toHaveLength(1); // still just the honest one
    expect(after.work.artifacts.map((a) => a.target)).toEqual(['/before.js']);
  });

  it('THE OPERATOR\'S ORDER IS NOT THE BEING\'S — the prompt stays state-ranked', async () => {
    // HEAVIEST/LIGHTEST is a viewing aid for the human. The being must always
    // read the same deterministic order — being worked, then taken on, then
    // blocked — so its list does not silently rearrange under it because
    // someone clicked a control in a window it cannot see. There is no channel
    // for the preference to arrive on, and this is what keeps it that way.
    const ledger = await workspace.readTaskLedger(neumaId);
    const section = (opts) => assemblePromptSections({ taskLedger: ledger, ...opts })
      .find((s) => s.id === 'tasks').text;
    // The signature simply does not accept an order — passing one changes nothing.
    expect(section({ chatId: CHAT, order: 'heaviest' })).toBe(section({ chatId: CHAT }));
    expect(section({ chatId: CHAT, order: 'lightest' })).toBe(section({ chatId: CHAT }));
  });

  it('refuses a cycle and a blocker that does not exist — both are unstartable forever', async () => {
    const a = await byTitle('Build on the schema');
    const cycle = await call('task_add', { title: 'Would deadlock', blockedBy: [a.id] });
    const b = await byTitle('Would deadlock');
    // a already waits on nothing live; make it wait on b and the pair is dead.
    expect(cycle.status).toBe('ok');
    const closed = await call('task_update', { id: a.id.slice(0, 8), blockedBy: [b.id] });
    expect(closed.status).toBe('error');
    expect(closed.error).toContain('wait on each other');

    const ghost = await call('task_add', { title: 'Waits on a ghost', blockedBy: ['deadbeef'] });
    expect(ghost.status).toBe('error');
    expect(ghost.error).toContain('not on the list');
  });
});
