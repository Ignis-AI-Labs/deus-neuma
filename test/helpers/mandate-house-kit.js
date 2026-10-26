/**
 * THE MANDATE HOUSE — one real temp house for the mandate suites (RULE 0, no
 * mock anywhere on a claimed path): the reply-lane house (real realm on temp
 * disk, X bound to the house's own lane, real reply candidates, a real
 * WebSocket pair) plus that lane seated as the house's CMO and a LOOPBACK X —
 * a real HTTP server on 127.0.0.1 answering in X's shapes — that the real
 * poster publishes to. Dummy keys only: no real social key ever reaches it.
 *
 * Every act goes through its real door: a post is a filed social/queue intent
 * settled by the real sweep, a send is the real scheduler tick, a grant or a
 * withdrawal is the real lifecycle.
 */
import http from 'http';
import fs from 'fs/promises';
import { buildReplyLaneHouse, teardownReplyLaneHouse, freshConnection, NEUMA_ID } from './reply-lane-house.js';
import { SERVED_WALLET } from './served-house.js';
import { viaIntent } from './intent-path.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import workspace from '../../core/workspace/neuma-workspace.js';

export { SERVED_WALLET as HOUSE, NEUMA_ID as CMO };

/** X's own words when it refuses a post as automated (its 226 refusal). */
export const SPAM_DETAIL = 'This request looks like it might be automated. To protect our users from spam and other malicious activity, we can\'t complete this action right now.';

// impure — the loopback X: me, a standing post, and POST /2/tweets that
// answers live (or refuses as spam while `state.mode === 'spam'`).
const standX = async () => {
  const state = { mode: 'ok', posts: [], next: 7000 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://loopback');
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/2/users/me') return json(200, { data: { id: '1000', username: 'neuma_house', name: 'Neuma' } });
    if (url.pathname.startsWith('/2/tweets/') && req.method === 'GET') {
      return json(200, { data: { id: url.pathname.slice('/2/tweets/'.length), author_id: '42' } });
    }
    if (url.pathname === '/2/tweets' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (state.mode === 'spam') return json(403, { title: 'Forbidden', detail: SPAM_DETAIL });
        state.next += 1;
        state.posts.push(JSON.parse(body));
        return json(201, { data: { id: String(state.next), text: 'out' } });
      });
      return undefined;
    }
    return json(404, { detail: 'not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { state, server, root: `http://127.0.0.1:${server.address().port}/2` };
};

/** Stand the house. impure. */
export const buildMandateHouse = async () => {
  const h = await buildReplyLaneHouse();
  h.x = await standX();
  process.env.NEUMA_X_API_ROOT = h.x.root;
  await cmoDesignation.designate(SERVED_WALLET, NEUMA_ID);
  h.connection = { ...freshConnection(h), walletAddress: SERVED_WALLET };
  // The operator's card answer resolves against this connection (reply-lane-house's ws relay).
  h.serverWs.__connection = h.connection;
  return h;
};

/** Tear it down. impure. */
export const teardownMandateHouse = async (h) => {
  h?.x?.server.close();
  await teardownReplyLaneHouse(h);
};

/** Empty the queue between tests (a governance record, so via its own file). impure. */
export const resetHouse = async (h) => {
  await fs.rm(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, { force: true });
  const { mandatePath } = await import('../../backend/services/marketing/mandate/mandate-store.js');
  await fs.rm(mandatePath(SERVED_WALLET), { force: true });
  await fs.rm(mandatePath(SERVED_WALLET).replace('house-mandate.json', 'house-mandate-journal.jsonl'), { force: true });
  await fs.rm(mandatePath(SERVED_WALLET).replace('house-mandate.json', 'house-mandate-holds.json'), { force: true });
  h.connection.sessionId = null;
  h.x.state.mode = 'ok';
  h.x.state.posts.length = 0;
  h.clientLog.length = 0;
  h.decide = null;
};

/** The CMO stages a post the way a being does: a filed intent, the real sweep. */
export const stagePost = (h, payload) => viaIntent(h.connection, 'social/queue', { channel: 'x', ...payload });

/** The house's queue entry by id (the real store). impure. */
export const entryOf = async (id) => (await postQueue.load()).find((e) => e.id === id);

/** The only entry the last stage wrote. impure. */
export const lastEntry = async () => (await postQueue.load()).at(-1);

/** The house's notifications of one kind. impure. */
export const notified = async (kind) => (await readNotifications(SERVED_WALLET)).records.filter((r) => r.kind === kind);

/** What the seat's own journal says about its mandate. impure. */
export const seatTold = async () => (await workspace.readJournal(NEUMA_ID)).filter((e) => e.type === 'mandate').map((e) => e.content);

/** A grant input of the usual shape: x-1 at the given pace, posts + renders, 7 days, UTC. */
export const grantInput = (over = {}) => ({ accounts: [{ id: 'x-1', pace: 2 }], timeZone: 'UTC', ...over });

/** An ISO time `ms` from now, inside the same UTC day when it can be. */
export const soon = (ms) => new Date(Date.now() + ms).toISOString();
