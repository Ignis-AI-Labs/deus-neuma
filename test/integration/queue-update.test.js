/**
 * QUEUE EDITING (#208) — update + bulk primitives, approval law, revision
 * trail. Everything on the claimed path runs for real (RULE 0): the REAL
 * queue store against REAL temp disk — no mock, stub, or spy anywhere. The
 * pure decisions (patch whitelisting, the approval law, the bounded trail)
 * are tested as pure functions with real inputs and outputs.
 *
 * THE LAW (decided in #208): editable standings are draft and approved only;
 * new words or images on an APPROVED post reset it to draft (the operator
 * approved different copy — the decision renews); a schedule-only edit
 * preserves the approval; every update stamps its actor and records the
 * PREVIOUS values of what changed.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  postQueue, previewUpdate, normalizePatch, appendRevision, REVISIONS_MAX,
} from '../../backend/services/social/post-queue.js';

const LANE = 'queueeditlane';

describe('queue update — the edit transition on the REAL store (gnosis)', () => {
  let house, savedPath;

  beforeAll(async () => {
    house = await createTempDir('queue-update');
    savedPath = process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = `${house}/post-queue.json`;
  });

  afterAll(async () => {
    if (savedPath === undefined) delete process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
    else process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = savedPath;
    await fs.rm(house, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, '[]');
  });

  const stageApproved = async (text = 'the approved line') => {
    const staged = await postQueue.add({
      channelId: 'x', text, scheduledFor: '2999-01-01T09:00:00Z',
      campaignId: 'launch', pillar: 'build', authorNeumaId: LANE,
    });
    await postQueue.approve(staged.id, { decidedBy: 'Founder' });
    return staged.id;
  };

  test('THE RESET — new words on an approved post return it to draft, and the old words survive in revisions', async () => {
    const id = await stageApproved();
    const result = await postQueue.update(id, { text: 'the corrected line' }, { by: 'Founder' });

    expect(result.ok).toBe(true);
    const [entry] = await postQueue.load();
    expect(entry.text).toBe('the corrected line');
    expect(entry.status).toBe('draft');          // the decision renews
    expect(entry.decidedBy).toBeUndefined();     // not rewritten — cleared
    expect(entry.decidedAt).toBeUndefined();
    expect(entry.updatedBy).toBe('Founder');
    expect(entry.updatedAt).toBeTruthy();
    // The revision carries what the copy WAS — never just what it became.
    expect(entry.revisions).toHaveLength(1);
    expect(entry.revisions[0].by).toBe('Founder');
    expect(entry.revisions[0].at).toBe(entry.updatedAt);
    expect(entry.revisions[0].changed).toEqual({ text: 'the approved line' });
    // Untouched fields ride through unchanged.
    expect(entry.scheduledFor).toBe('2999-01-01T09:00:00Z');
    expect(entry.campaignId).toBe('launch');
    expect(entry.pillar).toBe('build');
  });

  test('THE PRESERVATION — a schedule-only edit on an approved post keeps the approval', async () => {
    const id = await stageApproved();
    const result = await postQueue.update(id,
      { scheduledFor: '2999-02-02T10:00:00Z' }, { by: 'Founder' });

    expect(result.ok).toBe(true);
    const [entry] = await postQueue.load();
    expect(entry.status).toBe('approved');       // the words didn't move
    expect(entry.decidedBy).toBe('Founder');
    expect(entry.decidedAt).toBeTruthy();
    expect(entry.scheduledFor).toBe('2999-02-02T10:00:00Z');
    expect(entry.revisions[0].changed).toEqual({ scheduledFor: '2999-01-01T09:00:00Z' });
  });

  test('bookkeeping (campaignId/pillar) never resets an approval either — they are not the approved words', async () => {
    const id = await stageApproved();
    const result = await postQueue.update(id, { campaignId: 'evergreen', pillar: 'craft' }, { by: 'Founder' });

    expect(result.ok).toBe(true);
    const [entry] = await postQueue.load();
    expect(entry.status).toBe('approved');
    expect(entry.campaignId).toBe('evergreen');
    expect(entry.pillar).toBe('craft');
    expect(entry.revisions[0].changed).toEqual({ campaignId: 'launch', pillar: 'build' });
  });

  test('a media change on an approved post resets — the operator approved different images', async () => {
    const id = await stageApproved();
    const result = await postQueue.update(id,
      { media: [{ path: '/tmp/chart.png', alt: 'the chart' }] }, { by: 'Founder' });

    expect(result.ok).toBe(true);
    const [entry] = await postQueue.load();
    expect(entry.status).toBe('draft');
    expect(entry.media).toEqual([{ path: '/tmp/chart.png', alt: 'the chart' }]);
    expect(entry.revisions[0].changed).toEqual({ media: [] });
  });

  test('edits on a draft keep it a draft — no decision existed to renew', async () => {
    const staged = await postQueue.add({ channelId: 'x', text: 'rough copy', authorNeumaId: LANE });
    const result = await postQueue.update(staged.id,
      { text: 'tighter copy', scheduledFor: '2999-03-03T03:00:00Z' }, { by: LANE });

    expect(result.ok).toBe(true);
    const [entry] = await postQueue.load();
    expect(entry.status).toBe('draft');
    expect(entry.text).toBe('tighter copy');
    expect(entry.scheduledFor).toBe('2999-03-03T03:00:00Z');
    expect(entry.revisions[0].changed).toEqual({ text: 'rough copy', scheduledFor: null });
  });

  test('sending, sent, rejected and withdrawn refuse honestly — locked in flight, history when settled', async () => {
    const sending = await postQueue.add({ channelId: 'x', text: 'going out', authorNeumaId: LANE });
    await postQueue.approve(sending.id, { decidedBy: 'Founder' });
    await postQueue.claimForSend(sending.id);
    const sent = await postQueue.add({ channelId: 'x', text: 'went out', authorNeumaId: LANE });
    await postQueue.approve(sent.id, { decidedBy: 'Founder' });
    await postQueue.claimForSend(sent.id);
    await postQueue.recordOutcome(sent.id, { ok: true, id: '1948800000000000009' });
    const rejected = await postQueue.add({ channelId: 'x', text: 'declined', authorNeumaId: LANE });
    await postQueue.reject(rejected.id, { decidedBy: 'Founder' });
    const withdrawn = await postQueue.add({ channelId: 'x', text: 'pulled', authorNeumaId: LANE });
    await postQueue.withdraw(withdrawn.id, { withdrawnBy: 'Founder' });

    for (const [id, standing] of [
      [sending.id, 'sending'], [sent.id, 'sent'], [rejected.id, 'rejected'], [withdrawn.id, 'withdrawn'],
    ]) {
      const result = await postQueue.update(id, { text: 'a rewrite' }, { by: 'Founder' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe(`cannot act on a ${standing} post`);
    }
    // Nothing moved — the record reads exactly as before the refused edits.
    const entries = await postQueue.load();
    expect(entries.map((e) => e.text)).toEqual(['going out', 'went out', 'declined', 'pulled']);
    expect(entries.every((e) => !e.revisions)).toBe(true);

    const missing = await postQueue.update('nosuchid00000000', { text: 'x' }, { by: 'Founder' });
    expect(missing).toEqual({ ok: false, error: 'no such queued post' });
  });

  test('the patch validates through the same law as a staged draft', async () => {
    const staged = await postQueue.add({ channelId: 'x', text: 'standing copy', authorNeumaId: LANE });

    const badTime = await postQueue.update(staged.id, { scheduledFor: 'next tuesday-ish' }, { by: 'Founder' });
    expect(badTime.ok).toBe(false);
    expect(badTime.error).toContain('ISO-8601');

    const emptyText = await postQueue.update(staged.id, { text: '   ' }, { by: 'Founder' });
    expect(emptyText.ok).toBe(false);
    expect(emptyText.error).toContain('needs text');

    const badMedia = await postQueue.update(staged.id, { media: 'not-a-list' }, { by: 'Founder' });
    expect(badMedia.ok).toBe(false);
    expect(badMedia.error).toContain('media must be a list');

    const pathless = await postQueue.update(staged.id, { media: [{ alt: 'no path' }] }, { by: 'Founder' });
    expect(pathless.ok).toBe(false);
    expect(pathless.error).toContain('needs a path');

    // A refused patch leaves the record untouched.
    const [entry] = await postQueue.load();
    expect(entry.text).toBe('standing copy');
    expect(entry.revisions).toBeUndefined();
  });

  test('unknown patch fields are dropped, never persisted onto the governance record', async () => {
    const staged = await postQueue.add({ channelId: 'x', text: 'clean copy', authorNeumaId: LANE });
    const result = await postQueue.update(staged.id,
      { text: 'still clean', hacker: 'smuggled', status: 'approved' }, { by: 'Founder' });

    expect(result.ok).toBe(true);
    const [entry] = await postQueue.load();
    expect(entry.text).toBe('still clean');
    expect(entry.hacker).toBeUndefined();
    expect(entry.status).toBe('draft'); // `status` is not an editable field
  });

  test('an empty patch and a no-op patch refuse — an edit that changes nothing is not an edit', async () => {
    const staged = await postQueue.add({ channelId: 'x', text: 'same words', authorNeumaId: LANE });

    const empty = await postQueue.update(staged.id, {}, { by: 'Founder' });
    expect(empty.ok).toBe(false);
    expect(empty.error).toContain('no editable field');

    const noop = await postQueue.update(staged.id, { text: '  same words  ' }, { by: 'Founder' });
    expect(noop.ok).toBe(false);
    expect(noop.error).toBe('the patch changes nothing');

    const [entry] = await postQueue.load();
    expect(entry.revisions).toBeUndefined();
    expect(entry.updatedBy).toBeUndefined();
  });

  test('a reply entry: a text edit keeps the linkage; media now rides a reply too', async () => {
    const staged = await postQueue.add({
      channelId: 'x', text: 'a warm answer', kind: 'reply',
      reply: { toPostId: '2001', toUserId: '42', toUsername: 'bluefriend' },
      authorNeumaId: LANE,
    });
    await postQueue.approve(staged.id, { decidedBy: '0xW' });

    // LAW CHANGE (2026-07-28): media rides a reply like any post — and new
    // images on an APPROVED answer renew the decision, back to draft.
    const media = await postQueue.update(staged.id,
      { media: [{ path: '/tmp/x.png', alt: 'x' }] }, { by: 'Founder' });
    expect(media.ok).toBe(true);
    expect(media.entry.status).toBe('draft');
    expect(media.entry.media).toEqual([{ path: '/tmp/x.png', alt: 'x' }]);

    const edited = await postQueue.update(staged.id, { text: 'a warmer answer' }, { by: 'Founder' });
    expect(edited.ok).toBe(true);
    const [entry] = await postQueue.load();
    expect(entry.text).toBe('a warmer answer');
    expect(entry.kind).toBe('reply');
    expect(entry.reply).toMatchObject({ toPostId: '2001', toUserId: '42' }); // linkage intact
    // The trail: the media patch recorded the images that WERE (none), then
    // the text edit recorded the words that were.
    expect(entry.revisions[0].changed).toEqual({ media: [] });
    expect(entry.revisions[1].changed).toEqual({ text: 'a warm answer' });
  });

  test('the revision trail is bounded at 20, attributed, and holds previous values only', async () => {
    const staged = await postQueue.add({ channelId: 'x', text: 'version 0', authorNeumaId: LANE });
    for (let i = 1; i <= 25; i += 1) {
      const r = await postQueue.update(staged.id, { text: `version ${i}` }, { by: `editor-${i}` });
      expect(r.ok).toBe(true);
    }
    const [entry] = await postQueue.load();
    expect(entry.text).toBe('version 25');
    expect(entry.revisions).toHaveLength(REVISIONS_MAX); // 20, never 25
    // The oldest surviving revision is update 6 (version 5 → 6); 1–5 fell off.
    expect(entry.revisions[0].changed).toEqual({ text: 'version 5' });
    expect(entry.revisions.at(-1).changed).toEqual({ text: 'version 24' });
    for (const [i, rev] of entry.revisions.entries()) {
      expect(rev.by).toBe(`editor-${i + 6}`);
      expect(rev.at).toBeTruthy();
      expect(Object.keys(rev.changed)).toEqual(['text']); // previous values only
    }
  });
});

describe('the pure decisions behind the edit (real inputs, real outputs)', () => {
  const entry = {
    id: 'abc', channelId: 'x', text: 'the approved line', scheduledFor: '2999-01-01T09:00:00Z',
    campaignId: 'launch', pillar: 'build', media: [], status: 'approved',
    decidedBy: 'Founder', decidedAt: '2026-07-28T00:00:00Z',
  };

  test('normalizePatch whitelists and normalizes to the stored shape', () => {
    expect(normalizePatch({
      text: '  padded  ', scheduledFor: ' 2999-05-05T05:00:00Z ', campaignId: ' ', pillar: ' craft ',
      media: [{ path: '/a.png', alt: 'a', evil: 'dropped' }], unknown: 'gone',
    })).toEqual({
      text: 'padded', scheduledFor: '2999-05-05T05:00:00Z', campaignId: null, pillar: 'craft',
      media: [{ path: '/a.png', alt: 'a' }],
    });
    expect(normalizePatch(null)).toEqual({});
    expect(normalizePatch('junk')).toEqual({});
    expect(normalizePatch({ text: undefined })).toEqual({});
  });

  test('previewUpdate is the one source of the approval law', () => {
    const copyChange = previewUpdate(entry, { text: 'different words' });
    expect(copyChange).toMatchObject({
      ok: true, resetsApproval: true, changed: { text: 'the approved line' },
    });

    const scheduleOnly = previewUpdate(entry, { scheduledFor: '2999-06-06T06:00:00Z' });
    expect(scheduleOnly).toMatchObject({ ok: true, resetsApproval: false });

    const mediaChange = previewUpdate(entry, { media: [{ path: '/a.png', alt: '' }] });
    expect(mediaChange.resetsApproval).toBe(true);

    // On a draft there is no approval to reset, even for new words.
    expect(previewUpdate({ ...entry, status: 'draft' }, { text: 'x' }).resetsApproval).toBe(false);

    // Refusals are honest: settled standings, unknown posts, no-ops.
    expect(previewUpdate({ ...entry, status: 'sent' }, { text: 'x' }).error)
      .toBe('cannot act on a sent post');
    expect(previewUpdate(null, { text: 'x' }).error).toBe('no such queued post');
    expect(previewUpdate(entry, { text: 'the approved line' }).error)
      .toBe('the patch changes nothing');
  });

  test('appendRevision keeps the last REVISIONS_MAX, in order', () => {
    let trail = [];
    for (let i = 0; i < 30; i += 1) trail = appendRevision(trail, { at: `${i}`, by: 'x', changed: {} });
    expect(trail).toHaveLength(REVISIONS_MAX);
    expect(trail[0].at).toBe('10');
    expect(trail.at(-1).at).toBe('29');
    // A corrupt/absent trail starts clean rather than throwing.
    expect(appendRevision(undefined, { at: '0', by: 'x', changed: {} })).toHaveLength(1);
  });
});
