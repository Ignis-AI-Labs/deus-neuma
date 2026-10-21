/**
 * QUEUE CONTROL (RULE 0) — Kagipem, 2026-07-26: […]
 *
 * Everything here runs for real: the REAL queue store on real temp disk, the
 * REAL social handler, the REAL policy cascade, and a REAL WebSocket pair.
 * Nothing on the claimed path is mocked.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { postQueue, duePosts } from '../../backend/services/social/post-queue.js';
import { formatQueueForBeing, liveQueueForBeing } from '../../backend/services/social/queue-view.js';

const { _handleSocialTool, SOCIAL_TOOLS } = __test;
const LANE = 'queuecontrollane';

describe('queue control — a being can see, address, and pull its own staged copy', () => {
  let house, httpServer, wss, serverWs, client, savedPath;
  let frames;

  const connection = () => ({
    ws: serverWs,
    toolMode: 'auto', // lifts the chip; the cascade itself is real
    companion: { name: 'Kagipem', neumaId: LANE },
  });

  const call = (toolName, args = {}) =>
    _handleSocialTool(serverWs, connection(), null, 'auto', { toolName, tool: `social/${toolName}` }, args);

  beforeAll(async () => {
    house = await createTempDir('queue-control');
    savedPath = process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = `${house}/post-queue.json`;

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
    const linked = new Promise((r) => wss.once('connection', (s) => { serverWs = s; r(); }));
    client = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}`);
    const opened = new Promise((r) => client.once('open', r));
    await Promise.all([linked, opened]);
    frames = [];
    client.on('message', (d) => frames.push(JSON.parse(d.toString())));
  });

  afterAll(async () => {
    if (client?.readyState === WebSocket.OPEN) client.terminate();
    if (serverWs?.readyState === WebSocket.OPEN) serverWs.terminate();
    await new Promise((r) => wss.close(r));
    await new Promise((r) => httpServer.close(r));
    if (savedPath === undefined) delete process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
    else process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = savedPath;
    await fs.rm(house, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, '[]');
    frames.length = 0;
  });

  test('the family carries a cancel beside the reads', () => {
    expect(SOCIAL_TOOLS.map((t) => t.name)).toContain('queue_cancel');
  });

  test('queue_list gives the FULL id and the EXACT text, not a prefix and a preview', async () => {
    const staged = await postQueue.add({
      channelId: 'x', text: 'A line of copy long enough that an eighty character preview would certainly cut it off mid-sentence right about here.',
      authorNeumaId: LANE,
    });
    const result = await call('queue_list');

    expect(result.status).toBe('ok');
    // The whole id — an addressable handle. It printed id.slice(0, 8) before,
    // so a being could see a draft and had no way to name it.
    expect(result.content).toContain(staged.id);
    expect(staged.id.length).toBeGreaterThan(8);
    // The exact copy, so a duplicate is visible as a duplicate.
    expect(result.content).toContain('cut it off mid-sentence right about here.');
  });

  test('a sent post reports its public URL so publication can be verified', async () => {
    const staged = await postQueue.add({ channelId: 'x', text: 'shipped', authorNeumaId: LANE });
    await postQueue.approve(staged.id, { decidedBy: 'Founder' });
    await postQueue.claimForSend(staged.id);
    await postQueue.recordOutcome(staged.id, { ok: true, id: '1948800000000000001' });

    const result = await call('queue_list');
    expect(result.content).toContain('https://x.com/i/status/1948800000000000001');
    expect(result.content).toContain('sent ');
  });

  test('a failed send reports the honest reason, not silence', async () => {
    const staged = await postQueue.add({ channelId: 'x', text: 'did not land', authorNeumaId: LANE });
    await postQueue.approve(staged.id, { decidedBy: 'Founder' });
    await postQueue.claimForSend(staged.id);
    await postQueue.recordOutcome(staged.id, { ok: false, detail: 'X credentials are not configured' });

    const result = await call('queue_list');
    expect(result.content).toContain('FAILED X credentials are not configured');
  });

  test('a withdrawal never rewrites the witness\'s decision as a rejection', async () => {
    // […] — the REST rules forbid rejecting an approved
    // post, and this must not become a back door around them. Withdrawal is a
    // DIFFERENT act, recorded under its own name and actor.
    const staged = await postQueue.add({ channelId: 'x', text: 'stale line', authorNeumaId: LANE });
    await postQueue.approve(staged.id, { decidedBy: 'Founder' });
    await call('queue_cancel', { id: staged.id, reason: 'superseded' });

    const [entry] = await postQueue.load();
    expect(entry.status).toBe('withdrawn');
    expect(entry.status).not.toBe('rejected');
    expect(entry.decidedBy).toBe('Founder');          // the approval still stands in the record
    expect(entry.withdrawnBy).toBe('Kagipem');   // the withdrawal is attributed separately
    expect(entry.withdrawnReason).toBe('superseded');
    // Inert: the scheduler publishes only `approved`.
    expect(duePosts(await postQueue.load(), Date.now())).toEqual([]);
  });

  test('queue_cancel pulls superseded copy before it publishes, and keeps the record', async () => {
    const staged = await postQueue.add({ channelId: 'x', text: 'superseded copy', authorNeumaId: LANE });
    await postQueue.approve(staged.id, { decidedBy: 'Founder' });

    const result = await call('queue_cancel', { id: staged.id, reason: 'figure was corrected' });
    expect(result.status).toBe('ok');
    expect(result.content).toContain('will not publish');
    expect(result.content).toContain('figure was corrected');

    // REAL disk: rejected, so the scheduler (which sends only `approved`)
    // can never pick it up — and the entry survives as a governance record.
    const entries = await postQueue.load();
    const entry = entries.find((e) => e.id === staged.id);
    expect(entry.status).toBe('withdrawn');
    expect(entries).toHaveLength(1);
  });

  test('an already-sent post cannot be "recalled" — the tool refuses honestly', async () => {
    const staged = await postQueue.add({ channelId: 'x', text: 'already public', authorNeumaId: LANE });
    await postQueue.approve(staged.id, { decidedBy: 'Founder' });
    await postQueue.claimForSend(staged.id);
    await postQueue.recordOutcome(staged.id, { ok: true, id: '1948800000000000002' });

    const result = await call('queue_cancel', { id: staged.id });
    expect(result.status).toBe('error');
    expect(result.error).toContain('cannot act on a sent post');
    expect((await postQueue.load())[0].status).toBe('sent');
  });

  test('a prefix is refused as an id — the being must use the whole handle', async () => {
    const staged = await postQueue.add({ channelId: 'x', text: 'prefix test', authorNeumaId: LANE });
    const result = await call('queue_cancel', { id: staged.id.slice(0, 8) });

    expect(result.status).toBe('error');
    expect((await postQueue.load())[0].status).toBe('draft');
  });

  test('a missing id is answered, never thrown', async () => {
    const result = await call('queue_cancel', {});
    expect(result.status).toBe('error');
    expect(result.error).toContain('full id from queue_list');
  });

  test('the copy is VERBATIM — line breaks survive the being\'s view (2026-07-28: a collapsed render became a bunched post)', () => {
    // The being's queue view is its one source of truth for its own copy;
    // formatting is content. Collapsing \n\n here once put a one-liner on X.
    const broken = 'DeFi should not ask for blind trust.\n\nIt should show the route.\n\nExpose the risk.';
    const out = formatQueueForBeing([{ id: 'v1', status: 'draft', channelId: 'x', text: broken }]);
    expect(out).toContain(broken); // every break intact, exactly as staged
    expect(out).not.toContain('blind trust. It should show'); // never the collapsed line
  });

  test('an approved post carries THE SCHEDULE LOCK — the id and the confirmation timestamp (ruling, 2026-07-28)', () => {
    const out = formatQueueForBeing([{
      id: 'lock1', status: 'approved', channelId: 'x', text: 'locked copy',
      scheduledFor: '2026-07-28T13:00:00Z', decidedBy: '0xW', decidedAt: '2026-07-28T06:38:00Z',
    }]);
    expect(out).toContain('[lock1]'); // the lock id — citeable, verifiable
    expect(out).toContain('schedule LOCKED 2026-07-28T06:38:00Z'); // the confirmation timestamp
    // The protocol truth, stated where the being reads it — so it never
    // waits for an X-side id that cannot exist.
    expect(out).toContain('X holds no schedule');
  });

  test('an empty queue reads as empty rather than as a broken tool', async () => {
    expect(formatQueueForBeing([])).toContain('empty');
  });

  // Design note, 2026-07-27: […] The being's context is precious —
  // dead copy is the witness's record, never the being's material.
  describe('the being\'s scan carries only live copy', () => {
    const e = (id, status) => ({ id, status, channelId: 'x', text: `copy ${id}` });

    test('withdrawn and rejected posts never reach the being', () => {
      const out = formatQueueForBeing([
        e('d1', 'draft'), e('w1', 'withdrawn'), e('r1', 'rejected'), e('a1', 'approved'),
      ]);
      expect(out).toContain('2 post(s) in the campaign queue');
      expect(out).toContain('d1');
      expect(out).toContain('a1');
      expect(out).not.toContain('[w1]');
      expect(out).not.toContain('[r1]');
      expect(out).not.toContain('copy w1');
      expect(out).not.toContain('copy r1');
      // The exclusion is stated honestly — never a silent gap.
      expect(out).toContain('2 withdrawn/declined left in the record, not shown');
    });

    test('sent and failed STAY — anti-duplication memory and actionable failure', () => {
      const out = formatQueueForBeing([e('s1', 'sent'), e('f1', 'failed')]);
      expect(out).toContain('[s1]');
      expect(out).toContain('[f1]');
    });

    test('a queue of ONLY dead copy reads as nothing-live, never as broken', () => {
      const out = formatQueueForBeing([e('w1', 'withdrawn'), e('r1', 'rejected')]);
      expect(out).toContain('Nothing live');
      expect(out).toContain('2 withdrawn/declined');
      expect(out).not.toContain('[w1]');
    });

    test('liveQueueForBeing filters exactly the two dead standings', () => {
      const all = ['draft', 'approved', 'sending', 'sent', 'failed', 'rejected', 'withdrawn'].map((s) => e(s, s));
      expect(liveQueueForBeing(all).map((x) => x.id).sort())
        .toEqual(['approved', 'draft', 'failed', 'sending', 'sent']);
      expect(liveQueueForBeing(null)).toEqual([]);
    });
  });
});
