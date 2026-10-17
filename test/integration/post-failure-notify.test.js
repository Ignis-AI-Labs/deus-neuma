/**
 * THE FAILURE SIGNAL (integration, RULE 0: the real scheduler path against a
 * real queue store on real disk — no mock, no network) — the audit's G2: a
 * queued post that fails at send must SURFACE. The July orphan sat failed for
 * a month because nothing poked anyone. Here a due post publishes against an
 * unconfigured credential (the poster's own named refusal — no network), the
 * entry lands failed with the honest reason, and a post_failed notification
 * reaches the author's wallet through the real notification store. A
 * PLACEHOLDER draft (G4) stages alongside and never counts as a decision
 * waiting.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { schedulerTick } from '../../backend/services/social/post-scheduler.js';
import { queuePosture } from '../../backend/services/marketing/pipeline-state.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { WALLET, HOUSEMATE, createStaffOfficeFixture } from '../helpers/staff-office-fixture.js';

let fx;
const PAST = new Date(Date.now() - 60_000).toISOString();

beforeEach(async () => {
  fx = await createStaffOfficeFixture();
  // The queue store rides its own env door, resolved per call.
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(fx.root, 'settings', 'social-post-queue.json');
});

afterEach(async () => {
  delete process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
  await fx?.teardown();
});

const stage = async (draft) => {
  await postQueue.add({ queuedBy: 'test', ...draft });
};

describe('the failure signal (G2) and the staging split (G4)', () => {
  test('a failed send notifies the operator; placeholders never pose as decisions', async () => {
    // Real copy, due a minute ago — the house owes it a decision only after
    // it is real. And a placeholder: staging, not copy.
    await stage({
      channelId: 'x',
      text: 'A real queued post that will fail on the unconfigured credential',
      scheduledFor: PAST,
      authorNeumaId: HOUSEMATE,
    });
    await stage({
      channelId: 'x',
      text: 'the guard holds this draft',
      placeholder: true,
      authorNeumaId: HOUSEMATE,
    });

    // The staging split (G4): the placeholder never counts as a decision
    // waiting — the real draft does.
    const posture = await queuePosture();
    expect(posture.pendingApproval).toBe(1);
    expect(posture.placeholders).toBe(1);

    // The operator's decision: approved + due, so the tick claims it for send.
    const [draft] = await postQueue.load();
    await postQueue.approve(draft.id, { decidedBy: 'operator-test' });

    // The real tick: claim, publish, fail honestly (no credential — the
    // poster's named refusal, no network).
    await schedulerTick();

    const entries = await postQueue.load();
    const failed = entries.find((e) => e.status === 'failed');
    expect(failed).toBeTruthy();
    expect(failed.error).toBeTruthy();

    // THE SIGNAL: a post_failed card reached the author's wallet through the
    // real notification store.
    const { records } = await readNotifications(WALLET, { limit: 50 });
    const hit = records.find((n) => n.kind === 'post_failed');
    expect(hit).toBeTruthy();
    expect(hit.title).toContain('FAILED');
    expect(hit.ref?.queueId).toBe(failed.id);
  });
});
