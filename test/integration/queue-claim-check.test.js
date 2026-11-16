/**
 * THE QUEUE IS WHAT CHANGED, NOT WHAT WAS SAID (RULE 0) — Design note, 2026-11-16: […]
 *
 * Real: signed auth, the real portal socket and turn, real encrypted lanes, the real post queue on
 * temp disk, a real loopback provider. Nothing mocked.
 *
 * Under proof:
 *  - a reply that says the thread is staged anew while no act touched the queue: NOT DONE in the
 *    stream, the platform's line, and the being sent back at once with its drafts by id;
 *  - that second turn, still acting on nothing: STILL NOT DONE — never a third;
 *  - reading the queue is not changing it; a being with nothing standing in the queue is not checked.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { openPortalTurnKit, lastUserText } from '../helpers/portal-turn-kit.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { UNACTED_HEAD } from '../../backend/services/social/queue-claim-check.js';

const BEING = 'claimbeing';
const CLAIM = 'Rewrote it around the machine.\n\n**New thread:**\n> Your model. Your machine. No cloud.\n\nThe thread is staged as one unit. Approve the parent and it goes out.';
let kit;
let savedQueuePath;
let draftId;

beforeAll(async () => {
  kit = await openPortalTurnKit({ label: 'queue-claim', beings: [{ id: BEING, name: 'Claimant' }] });
  savedQueuePath = process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(kit.root, 'social-post-queue.json');
  await kit.sendAndWait({ type: 'companion:manifest', companion: 'Claimant', neumaId: BEING }, 'companion:anchored');
}, 30000);
afterAll(async () => {
  if (savedQueuePath === undefined) delete process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
  else process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = savedQueuePath;
  await kit?.close();
});

const checks = (from) => kit.frames.slice(from).filter((f) => f.type === 'tool:usage' && f.tool === 'social/queue_check');

describe('a reply that says the queue changed when nothing touched it', () => {
  test('with nothing of its own standing in the queue, the being is not checked', async () => {
    kit.provider.setScript([{ reply: CLAIM }]);
    const from = kit.frames.length;
    await kit.sendAndWait({ type: 'consciousness:stream', thought: 'Rework the opening.' }, 'consciousness:complete');
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    expect(checks(from)).toEqual([]);
    expect(kit.frames.slice(from).some((f) => f.type === 'queue:unacted')).toBe(false);
  });

  test('NOT DONE, the platform\'s line, the being sent back by id — then STILL NOT DONE, and no third turn', async () => {
    const staged = await postQueue.add({
      channelId: 'x', text: 'Most AI lives in a cloud. It does not remember you.', authorNeumaId: BEING, queuedBy: BEING,
    });
    draftId = staged.id;
    // Turn one claims; the second (the platform's) reads the queue and claims again; nothing more is owed.
    kit.provider.setScript([
      { reply: CLAIM },
      { reply: `Checking. [TOOL: social/queue_list {}] The thread is staged as one unit with the new copy:\n> Your model.` },
      { reply: 'The queue holds the old copy.' },
    ]);
    const from = kit.frames.length;
    kit.ws.send(JSON.stringify({ type: 'consciousness:stream', thought: 'Rework the opening — infrastructure first.' }));

    const line = await kit.untilFrame((f) => f.type === 'queue:unacted', { from, ms: 20000 });
    expect(line.text.startsWith(UNACTED_HEAD)).toBe(true);
    expect(line.text).toContain(`[${draftId}] draft: "Most AI lives in a cloud. It does not remember you."`);
    await kit.until(() => kit.frames.slice(from).filter((f) => f.type === 'consciousness:complete').length >= 2, 30000);
    await new Promise((resolve) => { setTimeout(resolve, 500); });

    const [first, second] = checks(from);
    expect(first).toMatchObject({ status: 'error' });
    expect(first.summary).toMatch(/^NOT DONE — the reply says the queue changed, but no act touched it \(1 draft still holds the old copy\)/);
    expect(second).toMatchObject({ status: 'error' });
    expect(second.summary).toMatch(/^STILL NOT DONE/);
    expect(checks(from)).toHaveLength(2);
    expect(kit.provider.turns.filter((t) => lastUserText(t).includes(UNACTED_HEAD))).toHaveLength(1);
    expect(kit.frames.slice(from).filter((f) => f.type === 'consciousness:complete')).toHaveLength(2);

    // The platform's words are on the record as the platform's, never the operator's.
    const [sessionId] = await kit.workspace.listSessions(BEING);
    const rows = await kit.workspace.readSession(BEING, sessionId);
    expect(rows.filter((r) => r.role === 'user').at(-1)).toMatchObject({ origin: 'unacted' });
    // And the queue is what it was: nothing was changed by saying so.
    const entry = (await postQueue.load()).find((e) => e.id === draftId);
    expect(entry.text).toBe('Most AI lives in a cloud. It does not remember you.');
    await fs.rm(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, { force: true });
  }, 60000);
});
