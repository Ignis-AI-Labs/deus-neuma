/**
 * THE QUEUE READ LAYER (RULE 0) — Design note, 2026-08-03, relaying the CMO lane:
 * […]
 *
 * Everything here runs for real: the REAL queue store on real temp disk, the
 * REAL social handler, the REAL policy cascade, and a REAL WebSocket pair.
 * Nothing on the claimed path is mocked. The pure view functions are called
 * with real entries the real store wrote.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { postQueue } from '../../backend/services/social/post-queue.js';

const { _handleSocialTool, SOCIAL_TOOLS } = __test;
const LANE = 'queuereadlane';

describe('the queue read layer — a being can enumerate the whole month, not one corner of it', () => {
  let house, httpServer, wss, serverWs, client, savedPath;
  let frames;

  const connection = () => ({
    ws: serverWs,
    toolMode: 'auto', // lifts the chip; the cascade itself is real
    companion: { name: 'Kagipem', neumaId: LANE },
  });

  const call = (toolName, args = {}) =>
    _handleSocialTool(serverWs, connection(), null, 'auto', { toolName, tool: `social/${toolName}` }, args);

  // Real staged copy through the real store — never a hand-written file.
  const stage = (text, extra = {}) =>
    postQueue.add({ channelId: 'x', text, authorNeumaId: LANE, queuedBy: LANE, ...extra });

  const idsIn = (content) => [...content.matchAll(/^\[([0-9a-f]{16})\]/gm)].map((m) => m[1]);

  beforeAll(async () => {
    house = await createTempDir('queue-read-layer');
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

  describe('the surface', () => {
    test('queue_list carries a real query schema, and queue_get stands beside it', () => {
      const names = SOCIAL_TOOLS.map((t) => t.name);
      expect(names).toContain('queue_get');
      const list = SOCIAL_TOOLS.find((t) => t.name === 'queue_list');
      // It advertised `properties: {}` — no way to ask for anything.
      expect(Object.keys(list.inputSchema.properties).sort()).toEqual([
        'campaignId', 'channelId', 'from', 'kind', 'limit', 'offset',
        'order', 'pillar', 'q', 'status', 'to', 'view',
      ]);
      // Every one optional: a standing plan that calls it bare still answers.
      expect(list.inputSchema.required).toBeUndefined();
    });

    test('a bare call still answers, so nothing already staged shifts under a being', async () => {
      await stage('one staged line');
      const result = await call('queue_list');
      expect(result.status).toBe('ok');
      expect(result.content).toContain('one staged line');
    });
  });

  describe('enumeration', () => {
    test('every post is reachable by paging — 45 staged, 45 read, none repeated', async () => {
      const staged = [];
      for (let i = 0; i < 45; i += 1) staged.push(await stage(`post number ${i}`));

      const first = await call('queue_list');
      const second = await call('queue_list', { offset: 30 });
      const seen = [...idsIn(first.content), ...idsIn(second.content)];

      expect(idsIn(first.content)).toHaveLength(30);
      expect(idsIn(second.content)).toHaveLength(15);
      expect(new Set(seen).size).toBe(45);
      expect(seen.sort()).toEqual(staged.map((e) => e.id).sort());
    });

    test('the tail names the exact next call instead of a board the being cannot open', async () => {
      for (let i = 0; i < 32; i += 1) await stage(`line ${i}`);
      const result = await call('queue_list');

      expect(result.content).toContain('showing 1–30 of 32');
      expect(result.content).toContain('queue_list {offset: 30}');
      // The dead end this replaces.
      expect(result.content).not.toContain("operator's board carries the full queue");
    });

    test("view:'index' is the densest walk of the month — fitted to the window, and it pages", async () => {
      // This test used to be called […], and
      // that was never true past a certain size: the live 155-entry index
      // renders at 25,167 chars against a 4,000-char result cap, so the
      // exchange folded its middle out and the "whole month" was a claim, not
      // a delivery (2026-08-28). The index is still the densest way to walk
      // the month; it is fitted to the window and it names the next call.
      const staged = [];
      for (let i = 0; i < 60; i += 1) staged.push(await stage(`indexed line ${i}`));

      const seen = [];
      let offset = 0;
      for (let read = 0; read < 20; read += 1) {
        const result = await call('queue_list', { view: 'index', offset });
        expect(result.content).toContain('index view');
        // A preview, and it says so — the verbatim copy lives in the full view.
        expect(result.content).toContain("view:'full'");
        seen.push(...idsIn(result.content));
        const next = result.content.match(/next: queue_list \{offset: (\d+)/);
        if (!next) break;
        offset = Number(next[1]);
      }
      // Every one reached, exactly once — the paging hint counts what was
      // RENDERED, so nothing the window held back is stepped over.
      expect(new Set(seen).size).toBe(60);
      expect(seen.sort()).toEqual(staged.map((e) => e.id).sort());
    });

    test('sent copy is reachable, which the fixed 30-entry decision window buried', async () => {
      // The old ranking put approvals first, then drafts, then the record —
      // so with more than 30 live drafts, no sent post could ever be read,
      // and the duplicate check the verbatim text exists for was blind.
      for (let i = 0; i < 31; i += 1) await stage(`draft ${i}`);
      const old = await stage('the line that already went out');
      await postQueue.approve(old.id, { decidedBy: 'Founder' });
      await postQueue.claimForSend(old.id);
      await postQueue.recordOutcome(old.id, { ok: true, id: '1948800000000000003' });

      const bare = await call('queue_list');
      expect(bare.content).not.toContain('already went out');

      const sent = await call('queue_list', { status: 'sent' });
      expect(sent.content).toContain('the line that already went out');
      expect(sent.content).toContain('https://x.com/i/status/1948800000000000003');
    });

    test('the chip reports the window the being received, not the whole record', async () => {
      for (let i = 0; i < 40; i += 1) await stage(`counted ${i}`);
      await call('queue_list');
      await new Promise((r) => { setTimeout(r, 30); });

      const chip = frames.filter((f) => f.type === 'tool:usage' && f.tool === 'social/queue_list').pop();
      // It read "40 staged post(s)" while handing over 30 — a summary the
      // operator would have to catch.
      expect(chip.summary).toBe('30 of 40 staged post(s)');
    });
  });

  describe('filters', () => {
    test('campaign, pillar, kind, schedule window and text each narrow the read', async () => {
      const inCampaign = await stage('umbrae routes the risk', {
        campaignId: 'aug2026', pillar: 'Market Structure', scheduledFor: '2026-08-10T14:00:00Z',
      });
      await stage('unrelated copy', { campaignId: 'jul2026', scheduledFor: '2026-07-10T14:00:00Z' });
      const follow = await stage('the follow-up line', { kind: 'self-reply', thread: { parentId: inCampaign.id } });

      const byCampaign = await call('queue_list', { campaignId: 'aug2026' });
      expect(idsIn(byCampaign.content)).toEqual([inCampaign.id]);

      const byPillar = await call('queue_list', { pillar: 'Market Structure' });
      expect(idsIn(byPillar.content)).toEqual([inCampaign.id]);

      const byKind = await call('queue_list', { kind: 'self-reply' });
      expect(idsIn(byKind.content)).toEqual([follow.id]);

      // The follow-up rides in on its parent's moment — it publishes in the
      // window even though it carries no slot of its own.
      const byWindow = await call('queue_list', { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' });
      expect(idsIn(byWindow.content).sort()).toEqual([inCampaign.id, follow.id].sort());

      const byText = await call('queue_list', { q: 'ROUTES THE RISK' });
      expect(idsIn(byText.content)).toEqual([inCampaign.id]);
    });

    test('a ONE-SIDED window is still a window — unscheduled copy is not in the calendar', async () => {
      // The regression this exists for: `_slot` is +Infinity for undated copy,
      // so `Infinity >= from` is true and a from-only window admitted every
      // unscheduled draft. On the real queue that was 182 matched where 123
      // were in the window. A `to` bound hid it (Infinity <= t is false),
      // which is exactly why only the two-sided window had ever been proven.
      const dated = await stage('a dated line', { scheduledFor: '2026-08-10T14:00:00Z' });
      const undated = await stage('a line with no slot at all');

      const fromOnly = await call('queue_list', { from: '2026-08-01T00:00:00Z' });
      expect(idsIn(fromOnly.content)).toEqual([dated.id]);
      expect(fromOnly.content).not.toContain(undated.id);

      const toOnly = await call('queue_list', { to: '2026-08-31T23:59:59Z' });
      expect(idsIn(toOnly.content)).toEqual([dated.id]);

      const both = await call('queue_list', { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' });
      expect(idsIn(both.content)).toEqual([dated.id]);

      // And with no window at all, the undated draft is of course still there.
      const unbounded = await call('queue_list');
      expect(idsIn(unbounded.content).sort()).toEqual([dated.id, undated.id].sort());
    });

    test('several statuses at once, comma-separated the way a being writes them', async () => {
      const a = await stage('awaiting a decision');
      const b = await stage('decided');
      await postQueue.approve(b.id, { decidedBy: 'Founder' });

      const result = await call('queue_list', { status: 'draft,approved' });
      expect(idsIn(result.content).sort()).toEqual([a.id, b.id].sort());
    });

    test('withdrawn copy stays out by default and opens only when it is named', async () => {
      const dropped = await stage('copy the operator killed');
      await postQueue.withdraw(dropped.id, { withdrawnBy: 'Founder', reason: 'superseded' });

      const bare = await call('queue_list');
      expect(bare.content).not.toContain('copy the operator killed');
      expect(bare.content).toContain("read them with status:'withdrawn,rejected'");

      // Design note, 2026-08-03: reachable on explicit opt-in, so an audit does not
      // rewrite a post into copy that was already dropped.
      const named = await call('queue_list', { status: 'withdrawn' });
      expect(named.content).toContain('copy the operator killed');
      expect(named.content).toContain('withdrawn by Founder (superseded)');
    });

    test('the dead-copy hint names a key that actually reads BOTH dead standings', async () => {
      // The hint counted `withdrawn` AND `rejected` (both are dead to a being)
      // but named `status:'withdrawn'`, which reaches only half of them — so a
      // being that followed it would never see a post the operator DECLINED.
      const pulled = await stage('copy that was withdrawn');
      const declined = await stage('copy the operator declined');
      await postQueue.withdraw(pulled.id, { withdrawnBy: 'Founder' });
      await postQueue.reject(declined.id, { decidedBy: 'Founder' });
      await stage('a live line so the header renders');

      const bare = await call('queue_list');
      const hint = bare.content.match(/status:'([^']+)' reads them/);
      expect(hint).not.toBeNull();
      expect(bare.content).toContain('2 withdrawn/declined');

      // Follow the hint literally: it must return everything it counted.
      const followed = await call('queue_list', { status: hint[1] });
      expect(idsIn(followed.content).sort()).toEqual([pulled.id, declined.id].sort());
    });

    test('a query it cannot honour refuses with its reason — never an empty page', async () => {
      await stage('something is staged');

      const badStatus = await call('queue_list', { status: 'nonsense' });
      expect(badStatus.status).toBe('error');
      expect(badStatus.error).toContain('unknown status nonsense');

      const badTime = await call('queue_list', { from: 'next tuesday' });
      expect(badTime.status).toBe('error');
      expect(badTime.error).toContain('ISO-8601');

      const badView = await call('queue_list', { view: 'summary' });
      expect(badView.status).toBe('error');
      expect(badView.error).toContain('unknown view');
    });

    test('a filter that matches nothing says so, and echoes what was asked', async () => {
      await stage('staged copy');
      const result = await call('queue_list', { campaignId: 'nosuchcampaign' });
      expect(result.status).toBe('ok');
      expect(result.content).toContain('campaignId: nosuchcampaign');
      expect(result.content).toContain('1 post(s) stand in the record');
    });
  });

  describe('threads — the 50 follow-ups that read as orphan drafts', () => {
    test('a follow-up names its parent and the moment it rides, never "unscheduled"', async () => {
      const parent = await stage('the opening line', { scheduledFor: '2026-08-06T20:00:00Z' });
      const child = await stage('the line that answers it', { kind: 'self-reply', thread: { parentId: parent.id } });

      const result = await call('queue_list');
      const line = result.content.split('\n').find((l) => l.startsWith(`[${child.id}]`));

      expect(line).toContain(`FOLLOW-UP to [${parent.id}]`);
      expect(line).toContain('2026-08-06T20:00:00Z');
      expect(line).not.toContain('unscheduled');
      // And the parent announces what hangs off it.
      expect(result.content.split('\n').find((l) => l.startsWith(`[${parent.id}]`)))
        .toContain(`+1 follow-up(s): [${child.id}]`);
    });

    test('a parent on another page is still a living parent, not an orphan claim', async () => {
      // The page-scoped thread index got this wrong: a child read alone
      // reported […] — alarming, and false.
      const parent = await stage('the parent post', { scheduledFor: '2026-08-06T20:00:00Z' });
      const child = await stage('a distinctive follow-up phrase', { kind: 'self-reply', thread: { parentId: parent.id } });

      const alone = await call('queue_list', { q: 'distinctive follow-up phrase' });
      expect(idsIn(alone.content)).toEqual([child.id]);
      expect(alone.content).not.toContain('GONE');
      expect(alone.content).toContain(`FOLLOW-UP to [${parent.id}]`);
      expect(alone.content).toContain('2026-08-06T20:00:00Z');
    });

    test('a follow-up rides into a date window on its PARENT\'S moment', async () => {
      // A follow-up carries no slot of its own, so reading its own
      // `scheduledFor` put it outside every window — on the real queue an
      // August audit omitted 40 follow-ups whose parents publish in August.
      // That copy WILL go out that month; an audit that cannot see it is the
      // exact blindness this whole read layer exists to end.
      const inMonth = await stage('the August parent', { scheduledFor: '2026-08-10T14:00:00Z' });
      const rides = await stage('the August follow-up', { kind: 'self-reply', thread: { parentId: inMonth.id } });
      const outMonth = await stage('the September parent', { scheduledFor: '2026-09-10T14:00:00Z' });
      const away = await stage('the September follow-up', { kind: 'self-reply', thread: { parentId: outMonth.id } });

      const august = await call('queue_list', { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' });
      expect(idsIn(august.content).sort()).toEqual([inMonth.id, rides.id].sort());
      expect(august.content).not.toContain(away.id);
    });

    test('a follow-up under a parent that can never publish stands in no window', async () => {
      const parent = await stage('a parent about to be pulled', { scheduledFor: '2026-08-10T14:00:00Z' });
      const child = await stage('its orphaned follow-up', { kind: 'self-reply', thread: { parentId: parent.id } });
      await postQueue.withdraw(parent.id, { withdrawnBy: 'Founder' });

      const august = await call('queue_list', { from: '2026-08-01T00:00:00Z', to: '2026-08-31T23:59:59Z' });
      // The parent is dead copy (out by default); the child can never publish,
      // so it stands on no calendar either.
      expect(idsIn(august.content)).toEqual([]);
    });

    test('calendar order reads a thread in the order it will be posted', async () => {
      const later = await stage('the later post', { scheduledFor: '2026-08-20T14:00:00Z' });
      const parent = await stage('the earlier parent', { scheduledFor: '2026-08-10T14:00:00Z' });
      const first = await stage('follow-up one', { kind: 'self-reply', thread: { parentId: parent.id } });
      const second = await stage('follow-up two', { kind: 'self-reply', thread: { parentId: parent.id } });

      const calendar = await call('queue_list', { order: 'calendar' });
      // Parent, then its follow-ups in staging order, then the later post —
      // not every follow-up swept past the end of the month.
      expect(idsIn(calendar.content)).toEqual([parent.id, first.id, second.id, later.id]);
    });

    test('a follow-up whose parent died says plainly that it can never publish', async () => {
      const parent = await stage('a parent that gets pulled');
      const child = await stage('the follow-up left behind', { kind: 'self-reply', thread: { parentId: parent.id } });
      await postQueue.withdraw(parent.id, { withdrawnBy: 'Founder' });

      const result = await call('queue_list');
      const line = result.content.split('\n').find((l) => l.startsWith(`[${child.id}]`));
      expect(line).toContain('parent withdrawn, so this can never publish');
    });
  });

  describe('queue_get — one post, whole', () => {
    test('the full id or an unambiguous prefix reaches the same post', async () => {
      const staged = await stage('the copy under audit');

      const byFull = await call('queue_get', { id: staged.id });
      const byPrefix = await call('queue_get', { id: staged.id.slice(0, 6) });
      expect(byFull.status).toBe('ok');
      expect(byPrefix.content).toBe(byFull.content);
      expect(byFull.content).toContain('the copy under audit');
    });

    test('an id that names two posts refuses rather than guessing which to show', async () => {
      // Two ids sharing a first character is enough — a guess here becomes an
      // edit to the wrong post one call later.
      const all = [];
      for (let i = 0; i < 12; i += 1) all.push(await stage(`candidate ${i}`));
      const clash = all.map((e) => e.id[0]).find((c, i, arr) => arr.indexOf(c) !== i);
      expect(clash).toBeDefined();

      const result = await call('queue_get', { id: clash });
      expect(result.status).toBe('error');
      expect(result.error).toContain('use more of it');
    });

    test('an unknown id is answered honestly and points at the list', async () => {
      const result = await call('queue_get', { id: 'ffffffffffffffff' });
      expect(result.status).toBe('error');
      expect(result.error).toContain('no queue entry');
      expect(result.error).toContain("queue_list shows every entry's id");
    });

    test('the copy comes back VERBATIM — line breaks are content', async () => {
      const broken = 'DeFi should not ask for blind trust.\n\nIt should show the route.';
      const staged = await stage(broken);
      const result = await call('queue_get', { id: staged.id });
      expect(result.content).toContain(broken);
    });

    test('the revision trail shows what the copy WAS, which no list line can carry', async () => {
      const staged = await stage('the first wording');
      await postQueue.update(staged.id, { text: 'the second wording' }, { by: 'Kagipem' });

      const result = await call('queue_get', { id: staged.id });
      expect(result.content).toContain('the second wording');
      expect(result.content).toContain('REVISIONS (1');
      expect(result.content).toContain('was: "the first wording"');
      expect(result.content).toContain('by Kagipem');
    });

    test('the whole thread comes with it, in publish order, with this one marked', async () => {
      const parent = await stage('the opening', { scheduledFor: '2026-08-06T20:00:00Z' });
      const first = await stage('the middle', { kind: 'self-reply', thread: { parentId: parent.id } });
      const second = await stage('the close', { kind: 'self-reply', thread: { parentId: parent.id } });

      const result = await call('queue_get', { id: second.id });
      expect(result.content).toContain('THREAD (3 post(s), in publish order):');
      const order = result.content.split('\n').filter((l) => /^ {2}\d\. \[/.test(l));
      expect(order.map((l) => l.slice(6, 22))).toEqual([parent.id, first.id, second.id]);
      expect(order[2]).toContain('← this one');
      expect(order[0]).not.toContain('← this one');
    });

    test('media rides with its alt text, so a missing description is visible', async () => {
      const staged = await stage('a post with pictures', {
        media: [{ path: '/tmp/one.png', alt: 'a routed swap' }, { path: '/tmp/two.png' }],
      });
      const result = await call('queue_get', { id: staged.id });
      expect(result.content).toContain('alt: "a routed swap"');
      expect(result.content).toContain('NO ALT TEXT');
    });
  });
});
