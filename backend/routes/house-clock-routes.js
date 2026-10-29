/**
 * House clock routes — the operator's control over the house waking itself
 * (Design note, 2026-10-16: […]). Mounted at
 * /api/v1/house-clock.
 *
 * Every route requires the operator's Bearer token, and every one reads and
 * writes ONLY the calling wallet's own house: the house is its operator's
 * wallet, so no route takes a house id a caller could forge. Every mutation
 * is logged with the wallet that made it.
 *
 *   GET  /charter          the charter, where it stands, its superseded versions
 *   PUT  /charter          write a new version — pending the operator's approval
 *   POST /charter/approve  approve the version on screen ({version})
 *   POST /charter/pause    the master switch: nothing wakes
 *   POST /charter/resume   release it
 *   GET  /queue            what waits, what runs, and why a held seat is held
 *   GET  /ledger           the wakes, newest first (?offset, ?limit, ?seat, ?outcome)
 *   GET  /asks             what house work filed for the operator, newest first, and the
 *                          Optio's current review packet
 *   POST /asks/:id/answer  the operator answers it ({decision, text?, option?}): an act
 *                          allow | deny (allow = ONE use of exactly that act), a plan
 *                          approve | revise, a decision reply — and the seat is woken
 *   POST /asks/:id/close   dismiss without answering ({note?}) — nothing runs
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import {
  readCharter, writeCharter, approveCharter, setCharterPaused, readCharterHistory, CharterError,
} from '../services/house-clock/charter-store.js';
import { charterStanding } from '../services/house-clock/charter-shape.js';
import { setWakeRunner, readWakeQueue } from '../services/house-clock/wake-queue.js';
import { readWakeLedger, readAsks, closeAsk, ASK_NOTE_MAX } from '../services/house-clock/wake-ledger.js';
import { runWakeTurn } from '../services/house-clock/wake-turn.js';
import { readPacket } from '../services/house-clock/review-packet.js';
import { answerAsk, AnswerError } from '../services/house-clock/ask-answer.js';
import { createLogger } from '../services/logger.js';
import { loadHouseWorkspace } from '../services/ground-roots.js';
import { cosDesignation } from '../services/staff/cos-designation.js';
import { substrateLine } from '../services/substrate-lease.js';

const log = createLogger('HouseClock');

// THE WAKE TURN — wired here, at load, the way team-live-routes.js wires the
// member turn: the turn pipeline reaches back into the intents, so the queue
// (which the low producers reach through the clock) never imports it.
setWakeRunner(runWakeTurn);

const router = express.Router();
router.use(requireAuth);

// impure — the house's own lanes: the only seats a charter may name.
const ownedLanes = async (wallet) =>
  (await neumaWorkspace.listNeumaByOwner(wallet).catch(() => [])).map((o) => o.neumaId);

// pure — the charter as the desk reads it: the record and where it stands.
const view = (charter) => ({ charter, standing: charterStanding(charter) });

// impure — one refusal shape for every route: the operator's reason, or a 500.
const fail = (res, error, what) => {
  if (error instanceof CharterError) return res.status(error.status).json({ error: error.message });
  log.error(`${what} failed`, { error: error.message });
  return res.status(500).json({ error: `Failed to ${what}` });
};

router.get('/charter', async (req, res) => {
  try {
    const charter = await readCharter(req.walletAddress);
    // What the house needs to do its work beside the charter: its shared ground and a seated Optio
    // (2026-10-18: a house with no ground silently lost its board, its post and its charges) — and
    // how many slots the model line runs: at one, every wake takes turns with the operator's chat.
    const [{ root }, officer] = await Promise.all([
      loadHouseWorkspace(req.walletAddress),
      cosDesignation.getOfficer(req.walletAddress).catch(() => null),
    ]);
    res.json({
      ...view(charter),
      history: await readCharterHistory(req.walletAddress),
      readiness: { ground: root, optio: officer?.laneId ?? null, lineSlots: substrateLine.snapshot().capacity },
    });
  } catch (error) {
    fail(res, error, 'read the charter');
  }
});

router.put('/charter', async (req, res) => {
  try {
    const charter = await writeCharter(req.walletAddress, req.body, {
      by: req.walletAddress, ownedLanes: await ownedLanes(req.walletAddress),
    });
    log.info('house charter written — pending approval', { wallet: req.walletAddress, version: charter.version });
    res.json(view(charter));
  } catch (error) {
    fail(res, error, 'write the charter');
  }
});

router.post('/charter/approve', async (req, res) => {
  const version = req.body?.version;
  if (!Number.isInteger(version)) return res.status(400).json({ error: 'approve names the charter version you read ({version})' });
  try {
    const charter = await approveCharter(req.walletAddress, { version, by: req.walletAddress });
    log.info('house charter approved', { wallet: req.walletAddress, version });
    res.json(view(charter));
  } catch (error) {
    fail(res, error, 'approve the charter');
  }
});

router.post('/charter/pause', async (req, res) => {
  try {
    const charter = await setCharterPaused(req.walletAddress, true);
    log.info('house clock PAUSED', { wallet: req.walletAddress });
    res.json(view(charter));
  } catch (error) {
    fail(res, error, 'pause the house clock');
  }
});

router.post('/charter/resume', async (req, res) => {
  try {
    const charter = await setCharterPaused(req.walletAddress, false);
    log.info('house clock resumed', { wallet: req.walletAddress });
    res.json(view(charter));
  } catch (error) {
    fail(res, error, 'resume the house clock');
  }
});

// ── Vision: the queue, the ledger, the asks ──────────────────────────────────
router.get('/queue', async (req, res) => {
  try {
    res.json(await readWakeQueue(req.walletAddress));
  } catch (error) {
    fail(res, error, 'read the wake queue');
  }
});

// pure — a query number, or the default
const pageNumber = (raw, fallback) => {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

// pure — a filter value from the query, or null (a lane id or an outcome word only)
const filterWord = (raw) => (typeof raw === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(raw) ? raw : null);

router.get('/ledger', async (req, res) => {
  try {
    res.json(await readWakeLedger(req.walletAddress, {
      offset: pageNumber(req.query.offset, 0), limit: pageNumber(req.query.limit, 50),
      seat: filterWord(req.query.seat), outcome: filterWord(req.query.outcome),
    }));
  } catch (error) {
    fail(res, error, 'read the wake ledger');
  }
});

router.get('/asks', async (req, res) => {
  try {
    const [asks, packet] = await Promise.all([readAsks(req.walletAddress), readPacket(req.walletAddress)]);
    res.json({ asks, packet });
  } catch (error) {
    fail(res, error, 'read the house asks');
  }
});

const ASK_ID = /^[0-9a-f-]{36}$/;

// The operator's answer: the only door to a one-shot grant, a plan made the
// plan of record by them, or a reply to a seat's decision. Their wallet is the
// house, so an answer never reaches another house's ask.
router.post('/asks/:id/answer', async (req, res) => {
  const { id } = req.params;
  if (!ASK_ID.test(id)) return res.status(400).json({ error: 'not an ask id' });
  const { decision, text, option } = req.body ?? {};
  try {
    const answered = await answerAsk(req.walletAddress, id, { decision, text, option }, { by: req.walletAddress });
    log.info('house ask answered', { wallet: req.walletAddress, id, decision, woken: answered.woken.queued });
    res.json(answered);
  } catch (error) {
    if (error instanceof AnswerError) return res.status(error.status).json({ error: error.message });
    fail(res, error, 'answer the house ask');
  }
});

// Closing is the operator saying "seen, dealt with" — dismiss without
// answering, never an approval: the refused act is not run, and no wake is
// raised.
router.post('/asks/:id/close', async (req, res) => {
  const { id } = req.params;
  if (!ASK_ID.test(id)) return res.status(400).json({ error: 'not an ask id' });
  const note = req.body?.note;
  if (note != null && (typeof note !== 'string' || note.length > ASK_NOTE_MAX)) {
    return res.status(400).json({ error: `a note is text of at most ${ASK_NOTE_MAX} characters` });
  }
  try {
    const ask = await closeAsk(req.walletAddress, { id, by: req.walletAddress, note });
    if (!ask) return res.status(404).json({ error: 'this house filed no such ask' });
    log.info('house ask closed', { wallet: req.walletAddress, id });
    res.json({ ask });
  } catch (error) {
    fail(res, error, 'close the house ask');
  }
});

export default router;
