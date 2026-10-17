// The campaign lane — post queue + scheduler. RULE 0: real temp disk, real
// state machine, and the REAL publish path (binding re-check → credential
// resolution → the real poster), ended by the poster's own honest
// not-configured outcome so no packet ever leaves the machine.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  createPostQueue, postQueue, postQueuePath, validateDraft, duePosts,
} from '../../backend/services/social/post-queue.js';
import { createChannelBindings } from '../../backend/services/social/channel-bindings.js';
import { createSectorCrew } from '../../backend/services/sector-crew.js';
import { schedulerTick, publishEntry } from '../../backend/services/social/post-scheduler.js';
import { CHANNEL_CATALOG } from '../../backend/services/social/channel-registry.js';
import { useServedHouse, SERVED_WALLET } from '../helpers/served-house.js';

const ENV_KEYS = [
  'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH',
  'NEUMA_SECTOR_CREW_PATH',
  ...new Set(CHANNEL_CATALOG.flatMap((c) => c.fields.map((f) => f.env))),
];
let savedEnv;
let dir;
let house;

beforeEach(async () => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  dir = await createTempDir(`post-queue-${Math.random().toString(36).slice(2)}`);
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(dir, 'queue.json');
  process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(dir, 'bindings.json');
  process.env.NEUMA_SECTOR_CREW_PATH = path.join(dir, 'sector-crew.json');
  process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = path.join(dir, 'credentials.json');
  // The house the tick serves: the scheduler acts only on its own house's entries.
  house = await useServedHouse({ lanes: ['keir', 'galen', 'metidar', 'witness-openai-Kagipem'] });
});

afterEach(() => {
  house.restore();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe('validateDraft / duePosts (pure)', () => {
  test('rejects unknown channel, empty text, oversize text, bad time', () => {
    expect(validateDraft({ channelId: 'myspace', text: 'hi' })).toMatch(/Unknown channel/);
    expect(validateDraft({ channelId: 'x', text: '   ' })).toBe('the post needs text');
    expect(validateDraft({ channelId: 'x', text: 'a'.repeat(4001) })).toMatch(/beyond any postable/);
    expect(validateDraft({ channelId: 'x', text: 'hi', scheduledFor: 'not-a-time' })).toMatch(/ISO-8601/);
    expect(validateDraft({ channelId: 'x', text: 'hi', scheduledFor: '2026-07-21T00:00:00Z' })).toBeNull();
    expect(validateDraft({ channelId: 'x', text: 'hi' })).toBeNull();
  });

  test('duePosts: approved + time arrived (or no schedule) — nothing else', () => {
    const now = Date.parse('2026-07-21T12:00:00Z');
    const entries = [
      { id: 'a', status: 'approved', scheduledFor: '2026-07-21T11:00:00Z' },
      { id: 'b', status: 'approved', scheduledFor: '2026-07-21T13:00:00Z' },
      { id: 'c', status: 'approved', scheduledFor: null },
      { id: 'd', status: 'draft', scheduledFor: '2026-07-21T11:00:00Z' },
      { id: 'e', status: 'sent', scheduledFor: '2026-07-21T11:00:00Z' },
      { id: 'f', status: 'sending', scheduledFor: '2026-07-21T11:00:00Z' },
    ];
    expect(duePosts(entries, now).map((e) => e.id)).toEqual(['a', 'c']);
  });
});

describe('post queue store (real disk)', () => {
  test('full life: add → approve → claim → sent, with the record intact', async () => {
    const entry = await postQueue.add({ channelId: 'x', text: 'first light', queuedBy: '0xWitness', authorNeumaId: 'keir' });
    expect(entry.status).toBe('draft');

    const approved = await postQueue.approve(entry.id, { decidedBy: '0xWitness', scheduledFor: '2026-07-21T00:00:00Z' });
    expect(approved.ok).toBe(true);
    expect(approved.entry.status).toBe('approved');
    expect(approved.entry.scheduledFor).toBe('2026-07-21T00:00:00Z');

    const claimed = await postQueue.claimForSend(entry.id);
    expect(claimed.ok).toBe(true);
    // A second claim must refuse — the double-publish guard.
    expect((await postQueue.claimForSend(entry.id)).ok).toBe(false);

    await postQueue.recordOutcome(entry.id, { ok: true, id: 'post-123' });
    const [stored] = await postQueue.load();
    expect(stored.status).toBe('sent');
    expect(stored.postId).toBe('post-123');
    expect(stored.queuedBy).toBe('0xWitness');
    expect(stored.authorNeumaId).toBe('keir');
  });

  test('reject and remove rules: decisions stick, sent history is permanent', async () => {
    const a = await postQueue.add({ channelId: 'x', text: 'declined speech', queuedBy: SERVED_WALLET });
    const rejected = await postQueue.reject(a.id, { decidedBy: SERVED_WALLET });
    expect(rejected.entry.status).toBe('rejected');
    expect((await postQueue.approve(a.id, { decidedBy: SERVED_WALLET })).ok).toBe(false); // decided is decided
    expect(await postQueue.remove(a.id)).toBe(true);

    const b = await postQueue.add({ channelId: 'x', text: 'published speech', queuedBy: SERVED_WALLET });
    await postQueue.approve(b.id, { decidedBy: SERVED_WALLET });
    await postQueue.claimForSend(b.id);
    await postQueue.recordOutcome(b.id, { ok: true, id: 'p1' });
    expect(await postQueue.remove(b.id)).toBe(false); // sent history stays
  });

  test('store lands 0600/0700; a corrupt store surfaces, never collapses', async () => {
    await postQueue.add({ channelId: 'x', text: 'hello', queuedBy: SERVED_WALLET });
    expect((await fs.stat(postQueuePath())).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(postQueuePath()))).mode & 0o777).toBe(0o700);
    await fs.writeFile(postQueuePath(), '{"not":"an array"}');
    await expect(postQueue.load()).rejects.toThrow('not an array');
  });

  test('an invalid draft never persists', async () => {
    await expect(postQueue.add({ channelId: 'myspace', text: 'hi', queuedBy: SERVED_WALLET }))
      .rejects.toThrow('Unknown channel');
    const q = createPostQueue();
    expect(await q.load()).toEqual([]);
  });

  test('campaignId and pillar ride the draft through add(), trimmed and defaulted', async () => {
    const e = await postQueue.add({
      channelId: 'x', text: 'pillar speech', queuedBy: SERVED_WALLET,
      campaignId: '  cmp-1  ', pillar: ' craft ',
    });
    expect(e.campaignId).toBe('cmp-1');
    expect(e.pillar).toBe('craft');
    const [stored] = await postQueue.load();
    expect(stored.campaignId).toBe('cmp-1');
    expect(stored.pillar).toBe('craft');

    const bare = await postQueue.add({ channelId: 'x', text: 'unaffiliated speech', queuedBy: SERVED_WALLET });
    expect(bare.campaignId).toBeNull();
    expect(bare.pillar).toBe('');
  });

  test('an over-long campaignId or pillar is refused and never persists', async () => {
    await expect(postQueue.add({ channelId: 'x', text: 'hi', queuedBy: SERVED_WALLET, campaignId: 'c'.repeat(101) }))
      .rejects.toThrow('campaignId is too long');
    await expect(postQueue.add({ channelId: 'x', text: 'hi', queuedBy: SERVED_WALLET, pillar: 'p'.repeat(101) }))
      .rejects.toThrow('pillar is too long');
    expect(validateDraft({ channelId: 'x', text: 'hi', campaignId: 7 })).toBe('campaignId must be a string');
    expect(await postQueue.load()).toEqual([]);
  });
});

describe('scheduler publish path (real stores, real poster, no network)', () => {
  test('a due approved post travels the REAL path and records the poster\'s honest outcome', async () => {
    // Bind keir to x on the real (temp) bindings store; leave credentials
    // absent — the real x poster answers "not configured", no packet leaves.
    const bindings = createChannelBindings({ path: process.env.NEUMA_SOCIAL_BINDINGS_PATH });
    await bindings.bind('x', { neumaId: 'keir', boundBy: SERVED_WALLET });

    const e = await postQueue.add({ channelId: 'x', text: 'due speech', queuedBy: SERVED_WALLET, authorNeumaId: 'keir' });
    await postQueue.approve(e.id, { decidedBy: SERVED_WALLET });

    const outcomes = await schedulerTick(Date.now());
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].ok).toBe(false);
    expect(outcomes[0].detail).toContain('not configured');

    const [stored] = await postQueue.load();
    expect(stored.status).toBe('failed');
    expect(stored.error).toContain('not configured');
  });

  test('NO CROSS-ROUTING at send time: a stale approval dies when the binding moved', async () => {
    const bindings = createChannelBindings({ path: process.env.NEUMA_SOCIAL_BINDINGS_PATH });
    await bindings.bind('x', { neumaId: 'keir', boundBy: SERVED_WALLET });
    const e = await postQueue.add({ channelId: 'x', text: 'stale speech', queuedBy: SERVED_WALLET, authorNeumaId: 'keir' });
    await postQueue.approve(e.id, { decidedBy: SERVED_WALLET });

    // The witness rebinds the channel between approval and send.
    await bindings.bind('x', { neumaId: 'galen', boundBy: SERVED_WALLET });

    const outcomes = await schedulerTick(Date.now());
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].ok).toBe(false);
    // The law is now stated in crew terms (sector-crew.js): the author must
    // still be crew-or-holder at SEND time. Keir is neither once the channel
    // moves to Galen and no crew seats her — same refusal, wider vocabulary.
    expect(outcomes[0].detail).toContain('approval does not outlive membership');
    const [stored] = await postQueue.load();
    expect(stored.status).toBe('failed');
  });

  test('a CREW member\'s approved post sends on the holder\'s keys', async () => {
    // Under the crew model the author is usually NOT the holder: Kagipem
    // drafts, Founder approves, and it leaves on Metidar's binding. Before this
    // the scheduler demanded author === holder, so every crew draft died.
    const bindings = createChannelBindings({ path: process.env.NEUMA_SOCIAL_BINDINGS_PATH });
    await bindings.bind('x', { neumaId: 'metidar', boundBy: SERVED_WALLET });
    const crew = createSectorCrew({ path: process.env.NEUMA_SECTOR_CREW_PATH });
    await crew.add('x', { neumaId: 'witness-openai-Kagipem', kind: 'witness', remit: 'strategy' });

    const e = await postQueue.add({
      channelId: 'x', text: 'crew speech', queuedBy: SERVED_WALLET,
      authorNeumaId: 'witness-openai-Kagipem',
    });
    await postQueue.approve(e.id, { decidedBy: SERVED_WALLET });

    const outcomes = await schedulerTick(Date.now());
    expect(outcomes).toHaveLength(1);
    // It got PAST the membership gate — it fails later, on credentials, which
    // is the honest outcome for an unconfigured channel in this suite.
    expect(outcomes[0].detail || '').not.toContain('approval does not outlive membership');
  });

  test('a witness-authored entry (no author neuma) needs no binding and still resolves honestly', async () => {
    const e = await postQueue.add({ channelId: 'telegram', text: 'witness speech', queuedBy: SERVED_WALLET });
    await postQueue.approve(e.id, { decidedBy: SERVED_WALLET });
    const claimed = await postQueue.claimForSend(e.id);
    const outcome = await publishEntry(claimed.entry);
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('not configured');
  });

  test('drafts and future posts are untouched by a tick', async () => {
    await postQueue.add({ channelId: 'x', text: 'still a draft', queuedBy: SERVED_WALLET });
    const f = await postQueue.add({ channelId: 'x', text: 'future speech', queuedBy: SERVED_WALLET });
    await postQueue.approve(f.id, { decidedBy: SERVED_WALLET, scheduledFor: '2999-01-01T00:00:00Z' });
    expect(await schedulerTick(Date.now())).toHaveLength(0);
    const statuses = (await postQueue.load()).map((e) => e.status).sort();
    expect(statuses).toEqual(['approved', 'draft']);
  });
});

// A being stages copy, then needs to pull it back. Until 2026-07-27 it could
// not: queue_cancel calls withdraw(), withdraw accepted `approved` only, and
// everything a being stages starts as a `draft` — so every attempt came back
// "not pullable". The rule being protected was never […]; it was […].
describe('withdraw — pulling staged copy back', () => {
  const staged = (q, over = {}) => q.add({
    channelId: 'x', text: 'staged copy', queuedBy: 'being', authorNeumaId: 'ember', ...over,
  });

  test('a DRAFT can be pulled back by the being that staged it', async () => {
    const q = createPostQueue({ path: path.join(dir, 'q.json') });
    const e = await staged(q);
    expect(e.status).toBe('draft');
    const out = await q.withdraw(e.id, { withdrawnBy: 'Kagipem', reason: 'copy superseded' });
    expect(out.ok).toBe(true);
    expect(out.entry.status).toBe('withdrawn');
    expect(out.entry.withdrawnReason).toBe('copy superseded');
  });

  test('an APPROVED post can still be pulled back', async () => {
    const q = createPostQueue({ path: path.join(dir, 'q.json') });
    const e = await staged(q);
    await q.approve(e.id, { decidedBy: '0xELI' });
    const out = await q.withdraw(e.id, { withdrawnBy: 'Kagipem' });
    expect(out.ok).toBe(true);
    expect(out.entry.status).toBe('withdrawn');
  });

  test('withdrawing NEVER writes the witness’s verdict — that stays reject’s alone', async () => {
    const q = createPostQueue({ path: path.join(dir, 'q.json') });
    const e = await staged(q);
    const out = await q.withdraw(e.id, { withdrawnBy: 'Kagipem' });
    expect(out.entry.withdrawnBy).toBe('Kagipem');
    expect(out.entry.decidedBy).toBeUndefined(); // no operator decision invented
    expect(out.entry.status).not.toBe('rejected');
  });

  test('an approval is never rewritten into a rejection', async () => {
    const q = createPostQueue({ path: path.join(dir, 'q.json') });
    const e = await staged(q);
    await q.approve(e.id, { decidedBy: '0xELI' });
    const out = await q.withdraw(e.id, { withdrawnBy: 'Kagipem' });
    expect(out.entry.decidedBy).toBe('0xELI');  // the operator's decision stands
    expect(out.entry.status).toBe('withdrawn'); // recorded as its own act
  });

  test('a post that already went out can NEVER be reported as recalled', async () => {
    const q = createPostQueue({ path: path.join(dir, 'q.json') });
    const e = await staged(q);
    await q.approve(e.id, { decidedBy: '0xELI' });
    await q.claimForSend(e.id);
    await q.recordOutcome(e.id, { ok: true, id: '1234567890' });
    const out = await q.withdraw(e.id, { withdrawnBy: 'Kagipem' });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/cannot act on a sent post/);
  });

  test('a post mid-send refuses too — the packet is already in flight', async () => {
    const q = createPostQueue({ path: path.join(dir, 'q.json') });
    const e = await staged(q);
    await q.approve(e.id, { decidedBy: '0xELI' });
    await q.claimForSend(e.id);
    expect((await q.withdraw(e.id, { withdrawnBy: 'x' })).ok).toBe(false);
  });

  test('withdrawing twice refuses the second time', async () => {
    const q = createPostQueue({ path: path.join(dir, 'q.json') });
    const e = await staged(q);
    expect((await q.withdraw(e.id, { withdrawnBy: 'x' })).ok).toBe(true);
    expect((await q.withdraw(e.id, { withdrawnBy: 'x' })).ok).toBe(false);
  });

  test('a withdrawn draft is inert — the scheduler will never send it', async () => {
    const q = createPostQueue({ path: path.join(dir, 'q.json') });
    const e = await staged(q, { scheduledFor: new Date(Date.now() - 60000).toISOString() });
    await q.withdraw(e.id, { withdrawnBy: 'Kagipem' });
    expect(duePosts(await q.load(), Date.now())).toEqual([]);
  });
});
