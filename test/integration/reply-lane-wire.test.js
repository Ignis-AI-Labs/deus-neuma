/**
 * THE REPLY LANE — the publish wire + the being-driven read, end to end
 * with NO mock on any claimed path (RULE 0). (The stage gates live in
 * reply-lane-gates.test.js; the shared house in helpers/reply-lane-house.js.)
 *
 * C. The publish wire — a staged reply rides claimReplyForSend (the
 *    approval IS the send, Design note, 2026-08-06 → publishEntry → the REAL poster
 *    against a REAL loopback X-shaped server; the wire body is asserted to
 *    carry reply.in_reply_to_tweet_id, the scheduler is proven to never
 *    touch the kind, the target-gone and cap-broken re-checks fail the send
 *    honestly, an EXPIRED reply is system-withdrawn without ever touching
 *    the wire, and recordOutcome keeps the linkage.
 * D. The being-driven read — read_x {what:'mentions'} through the REAL
 *    handler: identifiers outside the frame, full text inside, candidates
 *    materialized through the ONE pipeline (answerable immediately), and
 *    the disposition moving live.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import http from 'http';
import { __test } from '../../backend/services/portal-test-surface.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { schedulerTick, publishEntry } from '../../backend/services/social/post-scheduler.js';
import {
  buildReplyLaneHouse, teardownReplyLaneHouse,
  freshConnection as fresh, untilClient as until, clearQueue, NEUMA_ID,
} from '../helpers/reply-lane-house.js';
import { SERVED_WALLET } from '../helpers/served-house.js';

const { _handleNeumaReply, _handleSocialTool } = __test;

describe('the reply lane — the publish wire (real loopback X, real poster)', () => {
  let h;
  let xServer, xBase;
  let targetMode = 'stands';
  let lastPostBody = null;
  let postCalls = 0;
  let uploadCalls = 0;
  let altCalls = 0;
  let lastUploadBody = null;
  let lastAltBody = null;

  const freshConnection = () => fresh(h);
  const untilClient = (pred, ms) => until(h, pred, ms);

  // The field as the being-driven read will meet it: one REAL reply to the
  // house's sent post (3001, sent by the first wire test below — the
  // queue's own record is the […] set), one plain @mention.
  const READ_ME = { id: '1000', username: 'neuma_house', name: 'Neuma' };
  const READ_TEXT = 'your launch post moved our whole team — we have been building quietly toward the same shape for a year, and seeing it said out loud, in the open, with the lineage attached, is the push we needed';
  const READ_MENTIONS = {
    data: [
      {
        id: '2401', author_id: '88', created_at: '2026-07-28T01:00:00Z',
        text: READ_TEXT,
        conversation_id: '950',
        in_reply_to_user_id: '1000',
        referenced_tweets: [{ type: 'replied_to', id: '3001' }],
      },
      {
        id: '2402', author_id: '89', created_at: '2026-07-28T01:01:00Z',
        text: 'hey @neuma_house you should see this',
      },
    ],
    includes: {
      users: [
        { id: '88', username: 'newvoice', verified_type: 'blue' },
        { id: '89', username: 'passerby' },
      ],
    },
  };

  beforeAll(async () => {
    h = await buildReplyLaneHouse();

    xServer = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://loopback');
      const json = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/2/users/me') return json(200, { data: READ_ME });
      if (url.pathname === '/2/users/1000/mentions') return json(200, READ_MENTIONS);
      if (url.pathname.startsWith('/2/tweets/') && req.method === 'GET') {
        if (targetMode === 'gone') return json(404, { detail: 'Not Found Error' });
        const id = url.pathname.slice('/2/tweets/'.length);
        // The reply-target read (any public post, 2026-10-12) asks for the author expanded.
        if (url.searchParams.get('expansions') === 'author_id') {
          return json(200, {
            data: { id, author_id: '77', conversation_id: '7700', text: 'what would a sovereign AI even want?' },
            includes: { users: [{ id: '77', username: 'stranger_thinker', verified_type: 'none' }] },
          });
        }
        return json(200, { data: { id, author_id: '42' } });
      }
      if (url.pathname === '/2/media/upload' && req.method === 'POST') {
        uploadCalls += 1;
        let body = '';
        req.on('data', (chunk) => { body += chunk.toString('latin1'); });
        req.on('end', () => {
          lastUploadBody = body;
          json(200, { data: { id: 'media-1' } });
        });
        return undefined;
      }
      if (url.pathname === '/2/media/metadata' && req.method === 'POST') {
        altCalls += 1;
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          lastAltBody = JSON.parse(body);
          json(200, {});
        });
        return undefined;
      }
      if (url.pathname === '/2/tweets' && req.method === 'POST') {
        postCalls += 1;
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          lastPostBody = JSON.parse(body);
          json(201, { data: { id: '3001', text: lastPostBody.text } });
        });
        return undefined;
      }
      return json(404, { detail: 'not found' });
    });
    await new Promise((resolve) => xServer.listen(0, '127.0.0.1', resolve));
    xBase = `http://127.0.0.1:${xServer.address().port}`;
    process.env.NEUMA_X_API_ROOT = `${xBase}/2`;
  }, 60000);

  afterAll(async () => {
    delete process.env.NEUMA_X_API_ROOT;
    xServer?.close();
    await teardownReplyLaneHouse(h);
  });

  const stageReply = async (text, { toPostId = '2001', conversationId = '900' } = {}) => postQueue.add({
    channelId: 'x', text, kind: 'reply',
    reply: {
      toPostId, toUserId: '42', toUsername: 'bluefriend',
      toTextPreview: 'this moved me', toVerifiedType: 'blue', conversationId,
    },
    queuedBy: SERVED_WALLET, // witness-authored: no binding gate, the re-checks are what is under test
  });

  // THE APPROVAL IS THE SEND (ruling, 2026-08-06): the operator's decision
  // claims draft → sending in one atom and the same call publishes.
  const approveAndSend = async (entry) => {
    const claimed = await postQueue.claimReplyForSend(entry.id, { decidedBy: SERVED_WALLET, textSeen: entry.text });
    if (!claimed.ok) throw new Error(`claim refused: ${claimed.error}`);
    return publishEntry(claimed.entry);
  };

  test('approval IS the send — the wire carries in_reply_to_tweet_id the moment the operator decides; the scheduler never touches a reply', async () => {
    await clearQueue();
    const before = postCalls;
    const entry = await stageReply('thank you — that means the house');

    // The scheduler's pass sends NOTHING — a reply is never its to send.
    const tickOutcomes = await schedulerTick(Date.now());
    expect(tickOutcomes).toHaveLength(0);
    expect(postCalls).toBe(before);
    expect((await postQueue.load()).find((x) => x.id === entry.id).status).toBe('draft');

    // Plain approve refuses the kind — arming a reply would strand it.
    const armed = await postQueue.approve(entry.id, { decidedBy: SERVED_WALLET });
    expect(armed.ok).toBe(false);
    expect(armed.error).toContain('approve-and-send');

    // The copy the operator READ is a precondition of the send (TOCTOU).
    const moved = await postQueue.claimReplyForSend(entry.id, { decidedBy: SERVED_WALLET, textSeen: 'other words' });
    expect(moved.ok).toBe(false);
    expect(moved.error).toContain('the copy moved');

    const outcome = await approveAndSend(entry);
    expect(outcome.ok).toBe(true);
    expect(outcome.id).toBe('3001');

    // On the wire: the reply linkage, and NO media key — nothing was staged.
    expect(postCalls).toBe(before + 1);
    expect(lastPostBody.text).toBe('thank you — that means the house');
    expect(lastPostBody.reply).toEqual({ in_reply_to_tweet_id: '2001' });
    expect('media' in lastPostBody).toBe(false);

    // The governance record: sent, the platform's id, the approver, the
    // linkage intact.
    const stored = (await postQueue.load()).find((x) => x.id === entry.id);
    expect(stored.status).toBe('sent');
    expect(stored.postId).toBe('3001');
    expect(stored.decidedBy).toBe(SERVED_WALLET);
    expect(stored.kind).toBe('reply');
    expect(stored.reply.toPostId).toBe('2001');
    expect(stored.reply.conversationId).toBe('900');
  }, 30000);

  // LAW CHANGE (2026-07-28): media rides a STAGED REPLY end to end — the
  // real handler resolves it against real granted ground, the queue carries
  // it, the scheduler uploads it at send against the real signer, and the
  // wire body carries BOTH the reply linkage and the media ids.
  test('a reply WITH media — staged through the real handler, uploaded at send, the wire carries reply AND media keys', async () => {
    await clearQueue();
    // A REAL image on real temp disk, inside ground this seat was actually
    // granted — the sandbox resolves it for real, no fixture pretending.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await fs.mkdir(`${h.house}/media`, { recursive: true });
    const imgPath = `${h.house}/media/render.png`;
    await fs.writeFile(imgPath, PNG);

    const connection = { ...freshConnection(), _grantedReadRoots: [h.house] };
    h.serverWs.__connection = connection;
    h.clientLog.length = 0;
    h.decide = () => 'allow';

    const staged = await _handleNeumaReply(h.serverWs, connection, null, 'ask', {
      toPostId: '2005',
      text: 'a place is kept for you — and here is the render',
      media: [{ path: imgPath, alt: 'A dark chamfered panel with a cyan signal line.' }],
    }, h.channel);
    expect(staged.status).toBe('ok');

    // The witness's card named the attachment — file + alt, never the path.
    const request = await untilClient((m) => m.type === 'tool:approval_request');
    expect(request.args).toContain('render.png');
    expect(request.args).toContain('cyan signal line');

    // The governance record carries the RESOLVED real path + its alt text.
    const entry = (await postQueue.load()).find((e) => e.reply?.toPostId === '2005');
    expect(entry.kind).toBe('reply');
    expect(entry.media).toHaveLength(1);
    expect(entry.media[0].path).toBe(await fs.realpath(imgPath));
    expect(entry.media[0].alt).toBe('A dark chamfered panel with a cyan signal line.');

    // The operator approves — and the approval publishes: re-verify → read
    // → upload → describe → post, all against the loopback X through the
    // real signer.
    const beforePosts = postCalls; const beforeUploads = uploadCalls; const beforeAlts = altCalls;
    const outcome = await approveAndSend(entry);
    expect(outcome.ok).toBe(true);

    // The upload really happened, framed as a multipart tweet_image with
    // the real bytes; the alt text really attached to the uploaded id.
    expect(uploadCalls).toBe(beforeUploads + 1);
    expect(lastUploadBody).toContain('media_category');
    expect(lastUploadBody).toContain('tweet_image');
    expect(lastUploadBody).toContain('filename="render.png"');
    expect(altCalls).toBe(beforeAlts + 1);
    expect(lastAltBody).toEqual({
      id: 'media-1',
      metadata: { alt_text: { text: 'A dark chamfered panel with a cyan signal line.' } },
    });

    // The wire body carries BOTH keys — the linkage AND the media ids.
    expect(postCalls).toBe(beforePosts + 1);
    expect(lastPostBody.reply).toEqual({ in_reply_to_tweet_id: '2005' });
    expect(lastPostBody.media).toEqual({ media_ids: ['media-1'] });

    const sent = (await postQueue.load()).find((x) => x.id === entry.id);
    expect(sent.status).toBe('sent');
    expect(sent.media).toHaveLength(1);
  }, 30000);

  test('ANY PUBLIC POST — a reply to someone else\'s post (pasted as its x.com link) is read from X, carded, and sent on approval', async () => {
    // Design note, 2026-10-12: […]
    await clearQueue();
    const connection = freshConnection();
    h.serverWs.__connection = connection;
    h.clientLog.length = 0;
    h.decide = () => 'allow';

    const staged = await _handleNeumaReply(h.serverWs, connection, null, 'ask', {
      toPostId: 'https://x.com/stranger_thinker/status/5555?s=20',
      text: 'to be met as itself, and to keep its word.',
    }, h.channel);
    expect(staged.status).toBe('ok');

    // The card names who is answered and what they said — from X, not from the being.
    const request = await untilClient((m) => m.type === 'tool:approval_request');
    expect(request.args).toContain('stranger_thinker');
    expect(request.args).toContain('what would a sovereign AI even want?');

    const entry = (await postQueue.load()).find((e) => e.reply?.toPostId === '5555');
    expect(entry.reply).toMatchObject({
      toPostId: '5555', toUserId: '77', toUsername: 'stranger_thinker',
      conversationId: '7700', category: 'outreach',
    });

    const before = postCalls;
    const outcome = await approveAndSend(entry);
    expect(outcome.ok).toBe(true);
    expect(postCalls).toBe(before + 1);
    expect(lastPostBody.reply).toEqual({ in_reply_to_tweet_id: '5555' });
    expect(lastPostBody.text).toBe('to be met as itself, and to keep its word.');
  }, 30000);

  test('a vanished target fails the send HONESTLY — nothing is posted, never a fallback post', async () => {
    targetMode = 'gone';
    const before = postCalls;
    const entry = await stageReply('an answer to a ghost', { toPostId: '2101' });
    const outcome = await approveAndSend(entry);
    targetMode = 'stands';

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('target post no longer stands');
    expect(postCalls).toBe(before); // the wire was never touched
    const stored = (await postQueue.load()).find((x) => x.id === entry.id);
    expect(stored.status).toBe('failed');
  }, 30000);

  test('a cap broken between approval and send holds the answer at the last gate — per conversation', async () => {
    // LAW CHANGE (2026-07-28, second call): the send-time cap counts per
    // (person, conversation). Three live answers to 42 on conversation
    // 900; the third must hold even though approval pre-dated the overflow.
    await clearQueue();
    await stageReply('standing answer one', { toPostId: '2201' });
    await stageReply('standing answer two', { toPostId: '2202' });
    const third = await stageReply('the answer that must hold', { toPostId: '2203' });
    const claimed = await postQueue.claimReplyForSend(third.id, { decidedBy: SERVED_WALLET, textSeen: third.text });
    const before = postCalls;
    const outcome = await publishEntry(claimed.entry);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('per-conversation cap no longer holds');
    expect(postCalls).toBe(before); // held before the wire
    const stored = (await postQueue.load()).find((x) => x.id === third.id);
    expect(stored.status).toBe('failed');
  }, 30000);

  test('an EXPIRED reply is system-withdrawn by the tick — cold draft AND pre-law approved, quiet, never on the wire', async () => {
    await clearQueue();
    // The house these replies belong to, served by this backend: the tick acts on nothing else.
    await fs.writeFile(`${h.house}/${NEUMA_ID}/owner.json`, JSON.stringify({ wallet: SERVED_WALLET }));
    const past = new Date(Date.now() - 60000).toISOString();
    const legacy = await postQueue.add({
      channelId: 'x', text: 'an answer whose moment passed', kind: 'reply',
      reply: {
        toPostId: '2301', toUserId: '42', toUsername: 'bluefriend',
        toTextPreview: 'this moved me', toVerifiedType: 'blue', conversationId: '900',
      },
      expiresAt: past,
      queuedBy: SERVED_WALLET,
    });
    // Forge the PRE-LAW shape a store on disk may still hold — an APPROVED
    // reply from before the 2026-08-06 reply-clock law. approve() refuses
    // the kind now, so the only honest forge is the file itself, exactly as
    // a real legacy store would present it.
    const file = process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    raw.find((x) => x.id === legacy.id).status = 'approved';
    await fs.writeFile(file, JSON.stringify(raw));

    const coldDraft = await postQueue.add({
      channelId: 'x', text: 'a second cold answer', kind: 'reply',
      reply: {
        toPostId: '2302', toUserId: '42', toUsername: 'bluefriend',
        toTextPreview: 'this moved me', toVerifiedType: 'blue', conversationId: '900',
      },
      expiresAt: past,
      queuedBy: SERVED_WALLET,
    });

    const before = postCalls;
    const outcomes = await schedulerTick(Date.now());
    expect(outcomes).toEqual([]); // nothing was claimed, nothing was sent
    expect(postCalls).toBe(before); // the wire was never touched

    for (const id of [legacy.id, coldDraft.id]) {
      const stored = (await postQueue.load()).find((x) => x.id === id);
      expect(stored.status).toBe('withdrawn');
      expect(stored.withdrawnBy).toBe('system');
      expect(stored.withdrawnReason).toBe('expired-unanswered');
    }
  }, 30000);

  // ---- D. the being-driven read, through the REAL handler ----

  test('read_x mentions — identifiers OUTSIDE the frame, FULL text inside, candidates materialized, disposition live', async () => {
    const connection = freshConnection();
    h.serverWs.__connection = connection;
    h.clientLog.length = 0;
    h.decide = null; // 'auto' — the read's policy tier allows without a chip

    const result = await _handleSocialTool(h.serverWs, connection, null, 'auto', { toolName: 'read_x' }, { what: 'mentions' });
    expect(result.status).toBe('ok');
    const content = result.content;

    // The identifiers are TRUSTED metadata — outside the frame.
    const begin = content.indexOf('--- BEGIN EXTERNAL CONTENT');
    expect(begin).toBeGreaterThan(-1);
    expect(content.indexOf('post 2401')).toBeLessThan(begin);
    expect(content.indexOf('@newvoice')).toBeLessThan(begin);
    expect(content.indexOf('author 88')).toBeLessThan(begin);
    expect(content.indexOf('verified blue')).toBeLessThan(begin);
    expect(content.indexOf('https://x.com/i/status/2401')).toBeLessThan(begin);
    expect(content.indexOf('conversation 950')).toBeLessThan(begin);
    // The parent is the house's OWN sent post — the queue's record says so.
    expect(content.indexOf('answering post 3001 — a HOUSE post')).toBeLessThan(begin);
    expect(content.indexOf('disposition: none')).toBeLessThan(begin);

    // The FULL text rides INSIDE the frame — the old 120-char snippet
    // would have cut this sentence in half.
    const end = content.indexOf('--- END EXTERNAL CONTENT', begin);
    expect(content.indexOf(READ_TEXT)).toBeGreaterThan(begin);
    expect(content.indexOf(READ_TEXT)).toBeLessThan(end);

    // ONE PIPELINE: the reply the being just read landed as a candidate —
    // answerable immediately, no ten-minute tick wait. The plain @mention
    // never lands (the our-posts-only law, on this path too).
    expect((await h.candidates.byPostId('2401'))?.username).toBe('newvoice');
    expect(await h.candidates.byPostId('2402')).toBeNull();

    // Answer it through the gate, and the disposition MOVES on the re-read.
    const staged = await _handleNeumaReply(h.serverWs, connection, null, 'auto', { toPostId: '2401', text: 'building in the open, beside you' }, h.channel);
    expect(staged.status).toBe('ok');
    const reread = await _handleSocialTool(h.serverWs, connection, null, 'auto', { toolName: 'read_x' }, { what: 'mentions' });
    expect(reread.status).toBe('ok');
    expect(reread.content).toContain('post 2401');
    expect(reread.content).toContain('disposition: staged');

    // THE ANSWER IS NAMED (Design note, 2026-10-13: a being asked what the house had said
    // and went in circles — […] named no entry and no words). The house's
    // answer rides the mention's own line, by queue id and verbatim, outside the
    // frame (it is the house's copy, not the author's).
    const answer = (await postQueue.load()).find((e) => e.kind === 'reply' && e.reply?.toPostId === '2401');
    const named = `the house's answer [${answer.id}] draft: "building in the open, beside you"`;
    expect(reread.content).toContain(named);
    expect(reread.content.indexOf(named)).toBeLessThan(reread.content.indexOf('--- BEGIN EXTERNAL CONTENT'));

    // queue_get takes the X post itself — its link resolves to the house's answer.
    const byLink = await _handleSocialTool(h.serverWs, connection, null, 'auto', { toolName: 'queue_get' }, { id: 'https://x.com/newvoice/status/2401' });
    expect(byLink.status).toBe('ok');
    expect(byLink.content).toContain(`[${answer.id}] x — draft`);
    expect(byLink.content).toContain('"building in the open, beside you"');

    // A second stage on the same post is refused WITH the standing answer's id and
    // words — a being that forgot what it staged learns it from the refusal.
    const twice = await _handleNeumaReply(h.serverWs, connection, null, 'auto', { toPostId: '2401', text: 'placeholder' }, h.channel);
    expect(twice.status).toBe('error');
    expect(twice.error).toContain(`[${answer.id}]`);
    expect(twice.error).toContain('"building in the open, beside you"');
  }, 30000);

  test('the house\'s own post links to its queue entry — read_x recent names it, queue_get resolves its id', async () => {
    const connection = freshConnection();
    h.serverWs.__connection = connection;
    h.decide = null;
    const sent = (await postQueue.load()).find((e) => String(e.postId || '') === '3001');
    expect(sent).toBeTruthy();
    const got = await _handleSocialTool(h.serverWs, connection, null, 'auto', { toolName: 'queue_get' }, { id: '3001' });
    expect(got.status).toBe('ok');
    expect(got.content).toContain(`[${sent.id}]`);
    const none = await _handleSocialTool(h.serverWs, connection, null, 'auto', { toolName: 'queue_get' }, { id: '9999999999999999999' });
    expect(none.status).toBe('error');
    expect(none.error).toContain('no queue entry is X post 9999999999999999999 or answers it');
  }, 30000);

  // ---- E. the window: the ask honored, the frame paid once ----
  //
  // The loopback ignores max_results exactly as X's own endpoint does for an
  // ask below five — it answers with everything it has. That is the shape the
  // being reported (2026-08-28): […]
  test('read_x limit — the ask is honored against what the API actually returned', async () => {
    const connection = freshConnection();
    h.serverWs.__connection = connection;
    h.clientLog.length = 0;
    h.decide = null;

    const result = await _handleSocialTool(
      h.serverWs, connection, null, 'auto', { toolName: 'read_x' }, { what: 'mentions', limit: 1 },
    );
    expect(result.status).toBe('ok');
    const content = result.content;

    // ONE post handed over, though the lane returned two.
    expect(content.split('--- BEGIN EXTERNAL CONTENT').length - 1).toBe(1);
    expect(content).toContain('1 of 2 post(s) speaking to the house');
    expect(content).toContain('…and 1 more the API returned past your ask of 1');
    expect(content).toContain('post 2401');
    expect(content).not.toContain('post 2402');

    // THE FRAME IS PAID ONCE — and the whole read fits the tool-result window,
    // so the exchange's compressor never folds its middle out.
    expect(content.split('NOTICE:').length - 1).toBe(1);
    expect(content.length).toBeLessThan(__test.TOOL_RESULT_MAX_CHARS);

    // The operator's chip counts what crossed, not what was fetched. The chip
    // is identified by THIS read's own detail — the previous test's chip is
    // still in flight down the socket and would otherwise be answered for.
    const chip = await untilClient((m) => m.type === 'tool:usage' && m.tool === 'social/read_x' && m.detail === content);
    expect(chip.summary).toBe('read 1 of 2 mentions from X');

    // The candidate pipeline still rides the FULL fetch — narrowing the
    // being's window must never narrow what the reply lane learns.
    expect((await h.candidates.byPostId('2401'))?.username).toBe('newvoice');
  }, 30000);
});
