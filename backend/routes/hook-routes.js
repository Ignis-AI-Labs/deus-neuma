/**
 * WEBHOOKS — events from outside (GitHub, Slack, Linear, any signed script)
 * wake a being of the house to act on them. Mounted at /api/v1/hooks.
 *
 *   POST /in/:id            a delivery. Public on purpose (GitHub cannot sign in),
 *                           so everything rests on the signature: no valid one, no wake.
 *   GET  /                  the house's hooks (never their secrets)        requireAuth
 *   POST /                  give out a hook {seat, source, name} → secret, shown once
 *   POST /:id/rotate        a new secret; the old one stops working at once
 *   DELETE /:id             take a hook back; its address stops answering
 *   GET  /:id/events        what it delivered, newest first
 *
 * A delivery is believed only when it is signed with the hook's secret, fresh
 * where the source signs a time, and not seen before. Then it is kept, and its
 * seat is woken through the house clock — so the charter still decides: a seat
 * the charter does not name, a paused charter, quiet hours or a spent daily cap
 * hold the wake exactly as they hold every other, and every act the woken
 * being takes goes through the same gates. The event's words are a third
 * party's; the wake says so (wake-thought.js `hook`).
 *
 * The whole door is a connection (electron/connections.json `webhooks`), off
 * until the operator turns it on: while off, a delivery is answered 404,
 * exactly as an address that does not exist.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import { isConnectionOn } from '../services/connections/connection-switches.js';
import { verifyDelivery } from '../services/hooks/hook-verify.js';
import { summarizeEvent } from '../services/hooks/hook-summary.js';
import {
  createHook, listHooks, removeHook, rotateHookSecret, hookForDelivery, noteDelivery,
  appendHookEvent, readHookEvents, HookError,
} from '../services/hooks/hook-store.js';
import { signalWake } from '../services/house-clock/wake-signal.js';
import { servesLane } from '../services/house-served.js';
import { ownedLanes } from '../services/house-deadlines.js';

const log = createLogger('Hooks');

/** Deliveries one hook may land per minute; past this, 429 until the minute turns. */
export const HOOK_RATE_PER_MINUTE = 120;
/** The largest delivery taken. GitHub's own cap is 25 MB; a wake needs far less. */
export const HOOK_BODY_LIMIT = '1mb';
/** What of a payload is kept in the event log. */
const KEPT_BODY_CHARS = 64 * 1024;
/** The wake queue's own cap on a wake's detail (wake-queue.js DETAIL_MAX). */
const DETAIL_CHARS = 390;

const router = express.Router();

// impure — per hook, per minute: a flood is refused before any work is done.
const counts = new Map();
const withinRate = (id, now = Date.now()) => {
  const minute = Math.floor(now / 60_000);
  const c = counts.get(id);
  if (!c || c.minute !== minute) { counts.set(id, { minute, n: 1 }); return true; }
  c.n += 1;
  return c.n <= HOOK_RATE_PER_MINUTE;
};

/**
 * The wake's detail: the summary, fit under the queue's cap by dropping the
 * least needed fields first (the text, then the link), never by cutting JSON. Pure.
 */
export const wakeDetail = (hook, summary) => {
  const detail = { hook: hook.name, source: hook.source, ...summary };
  for (const field of ['text', 'url', 'who', 'where', 'title']) {
    if (JSON.stringify(detail).length <= DETAIL_CHARS) break;
    delete detail[field];
  }
  return detail;
};

const keptBody = (body) => {
  const text = JSON.stringify(body);
  return text.length <= KEPT_BODY_CHARS ? body : { truncated: true, head: text.slice(0, KEPT_BODY_CHARS) };
};

// ── the delivery door ────────────────────────────────────────────────────────
router.post('/in/:id', express.raw({ type: () => true, limit: HOOK_BODY_LIMIT }), async (req, res) => {
  if (!isConnectionOn('webhooks')) return res.status(404).end();
  const hook = await hookForDelivery(req.params.id);
  if (!hook) return res.status(404).end();
  if (!withinRate(hook.id)) return res.status(429).json({ error: 'too many deliveries this minute' });

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const verdict = verifyDelivery({ source: hook.source, secret: hook.secret, headers: req.headers, raw, now: Date.now() });
  if (!verdict.ok) {
    log.warn('delivery refused', { hook: hook.id, why: verdict.why });
    return res.status(401).json({ error: verdict.why });
  }
  // Slack proves the address once, with a challenge to echo back; nothing wakes.
  if (hook.source === 'slack' && verdict.body?.type === 'url_verification') {
    return res.json({ challenge: String(verdict.body.challenge ?? '') });
  }
  const { fresh } = await noteDelivery(hook.id, verdict.deliveryId);
  if (!fresh) return res.status(200).json({ ok: true, duplicate: true });

  const summary = summarizeEvent(hook.source, verdict.event, verdict.body);
  const receivedAt = new Date().toISOString();
  // GitHub's ping only proves the address works: kept, never a wake.
  const ping = hook.source === 'github' && verdict.event === 'ping';
  const ours = !ping && Boolean(await servesLane(hook.seat, hook.wallet).catch(() => null));
  await appendHookEvent(hook.id, {
    deliveryId: verdict.deliveryId, receivedAt, event: verdict.event, summary,
    woke: ours, ...(ping ? { note: 'ping' } : !ours ? { note: 'the seat is no longer this house\'s — nothing woke' } : {}),
    body: keptBody(verdict.body),
  });
  if (ours) signalWake({ seat: hook.seat, reason: 'hook', ref: `hook:${hook.id}:${verdict.deliveryId}`, detail: wakeDetail(hook, summary) });
  return res.status(202).json({ ok: true, accepted: true, ...(ping ? { ping: true } : {}) });
});

// ── the house's own management, signed in ────────────────────────────────────
const refuse = (res, error) => {
  if (error instanceof HookError) return res.status(400).json({ error: error.message });
  log.error('hook route failed', { error: error.message });
  return res.status(500).json({ error: 'the hook could not be changed' });
};

router.get('/', requireAuth, async (req, res) => {
  try { res.json({ hooks: await listHooks(req.walletAddress), on: isConnectionOn('webhooks') }); } catch (e) { refuse(res, e); }
});

router.post('/', requireAuth, express.json({ limit: '16kb' }), async (req, res) => {
  try {
    const { seat, source, name } = req.body || {};
    const lanes = await ownedLanes(req.walletAddress);
    if (!lanes.some((l) => l.laneId === seat)) return res.status(403).json({ error: `${seat} is not a being of this house` });
    const made = await createHook({ wallet: req.walletAddress, seat, source, name });
    log.info('hook given out', { hook: made.hook.id, seat, source, wallet: req.walletAddress });
    res.status(201).json({ ...made, on: isConnectionOn('webhooks'), note: 'the secret is shown once — put it in the service now' });
  } catch (e) { refuse(res, e); }
});

router.post('/:id/rotate', requireAuth, async (req, res) => {
  try { res.json(await rotateHookSecret(req.walletAddress, req.params.id)); } catch (e) { refuse(res, e); }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const removed = await removeHook(req.walletAddress, req.params.id);
    if (!removed) return res.status(404).json({ error: `no hook ${req.params.id} in this house` });
    log.info('hook taken back', { hook: req.params.id, wallet: req.walletAddress });
    res.json({ ok: true });
  } catch (e) { refuse(res, e); }
});

router.get('/:id/events', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    res.json({ events: await readHookEvents(req.walletAddress, req.params.id, limit) });
  } catch (e) { refuse(res, e); }
});

export default router;
