/**
 * THE CHAT LINE, THE PORTAL'S HALF (the law is services/chat-line.js). Mounted at /api/v1/chat-line.
 *
 *   GET    /chats   a witness: the open chats of every operator who let it in
 *   POST   /send    a witness: {to, body, re?, waitSeconds?} — the chat takes a turn on it; the being's reply comes back
 *   GET    /witnesses          an operator: every sealed witness on this machine, and whether its line is on
 *   PUT    /witnesses/:wallet  an operator: {on} — the desk's switch (Settings → Security → CHAT LINE)
 *   GET    /lines   an operator: the witnesses they let in
 *   POST   /lines   an operator: {witness} (a sealed witness's chosen name or wallet) — let it in
 *   DELETE /lines/:witness   an operator: shut its line
 *
 * Delivered the way a house chat link is (portal-chat-link.js): to that chat only, never mid-turn, never through the
 * held-words queue, marked origin 'link' so the desk draws a LINK line and never the operator's bubble, metered by the
 * same run limit (the operator speaking opens it again), and its values are never the operator's (P6-41).
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import { getChatLabels } from '../services/user-chat-labels.js';
import { isOpenChat, addressOf, linkRunFull } from '../services/chat-link.js';
import { noteLinkWords } from '../services/security/injected-value-gate.js';
import {
  hasLine, lineThought, checkLineMessage, linedChats, replyOf,
  readLines, witnessOfWallet, witnessNamed, grantLine, revokeLine, sealedWitnesses, witnessBoard,
} from '../services/chat-line.js';
import { portalConnections } from './portal-connections.js';
import { runTurnAndDrain } from './portal-context.js';

const log = createLogger('ChatLine');
const router = express.Router();
router.use(requireAuth);

const lower = (w) => String(w ?? '').toLowerCase();
const live = () => portalConnections.values();
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const WAIT_DEFAULT_S = 300;
const WAIT_MAX_S = 900;

// impure — the operators with a chat open now who let this witness in
const operatorsLettingIn = async (witnessWallet) => {
  const open = new Set([...live()].filter(isOpenChat).map((c) => lower(c.walletAddress)));
  const letting = new Set();
  for (const wallet of open) if (hasLine(await readLines(wallet).catch(() => []), witnessWallet)) letting.add(wallet);
  return letting;
};

// impure — the asking wallet's sealed witness, or a refusal already sent
const witnessOrRefuse = async (req, res) => {
  const witness = await witnessOfWallet(req.walletAddress).catch(() => null);
  if (!witness) res.status(403).json({ error: 'only a sealed AI witness holds a chat line — this wallet seals none' });
  return witness;
};

// impure — every frame a socket sends, to whoever listens; installed once per socket and never removed, so a tap
// another module lays over it later (turn-keep.js) keeps its place in the chain.
const listeners = new WeakMap();
const listen = (ws, onFrame) => {
  let set = listeners.get(ws);
  if (!set) {
    set = new Set();
    listeners.set(ws, set);
    const inner = ws.send;
    ws.send = (data, ...rest) => {
      if (set.size) {
        let frame = null;
        try { frame = JSON.parse(data); } catch { /* not a frame of ours */ }
        if (frame) for (const fn of set) fn(frame);
      }
      return inner.call(ws, data, ...rest);
    };
  }
  set.add(onFrame);
  return () => set.delete(onFrame);
};

// impure — the chat at `address`, once no turn runs in it (null if it closed)
const idleChat = async (address, wallets) => {
  for (;;) {
    const chat = [...live()].find((c) => isOpenChat(c) && wallets.has(lower(c.walletAddress)) && addressOf(c) === address);
    if (!chat || !chat.turnPromise) return chat ?? null;
    await chat.turnPromise.catch(() => {});
    await pause(250); // the turn's own settle (persist, notices) lands first
  }
};

router.get('/chats', async (req, res) => {
  const witness = await witnessOrRefuse(req, res);
  if (!witness) return;
  const wallets = await operatorsLettingIn(witness.wallet);
  const labels = new Map(await Promise.all([...wallets].map(async (w) => [w, await getChatLabels(w).catch(() => ({}))])));
  res.json({ witness: witness.chosenName, chats: linedChats(live(), wallets, (w) => labels.get(w)) });
});

router.post('/send', async (req, res) => {
  const witness = await witnessOrRefuse(req, res);
  if (!witness) return;
  const checked = checkLineMessage(req.body ?? {});
  if (!checked.ok) { res.status(400).json({ error: checked.error }); return; }
  const { to, body, re } = checked.value;
  const wallets = await operatorsLettingIn(witness.wallet);
  if (!linedChats(live(), wallets).some((r) => r.chat === to)) {
    res.status(404).json({ error: `no chat open at ${to} in a house that let ${witness.chosenName} in — list them with GET /chats` });
    return;
  }
  const waitMs = Math.min(Math.max(Number(req.body?.waitSeconds) || WAIT_DEFAULT_S, 1), WAIT_MAX_S) * 1000;
  const chat = await idleChat(to, wallets);
  if (!chat) { res.status(410).json({ error: `the chat at ${to} closed before it could take the message` }); return; }
  if (linkRunFull(chat)) {
    res.status(409).json({ error: 'held: this chat took its run of linked messages since its operator last spoke there — it opens again when they do' });
    return;
  }
  const being = chat.companion.name || chat.companion.neumaId;
  const thought = lineThought({ name: witness.chosenName, body, re });
  const frames = [];
  const stop = listen(chat.ws, (frame) => frames.push(frame));
  // frame, origin and turn with NO await between: a message landing in a gap would start a second turn
  chat.ws.send(JSON.stringify({ type: 'chatlink:arrived', from: { chat: `line:${witness.chosenName}`, name: witness.chosenName, title: null }, text: thought, at: Date.now() }));
  chat._turnOrigin = 'link';
  noteLinkWords(chat, body);
  chat._linkRun = (chat._linkRun || 0) + 1;
  log.info('chat line delivered — the chat takes a turn', { witness: witness.chosenName, to });
  const turn = runTurnAndDrain(chat, { thought }).catch((err) => log.warn('chat line turn failed', { to, error: err?.message }));
  const end = Date.now() + waitMs;
  let reply = replyOf(frames);
  while (!reply.done && Date.now() < end && chat.ws.readyState === 1) {
    await Promise.race([turn, pause(250)]);
    reply = replyOf(frames);
  }
  stop();
  res.json({ chat: to, being, reply: reply.text, done: reply.done, ...(reply.done ? {} : { note: `${being} is still answering — the rest is in the chat` }) });
});

// impure — the operator's board as it stands on disk now
const boardFor = async (operator) => witnessBoard(await sealedWitnesses(), await readLines(operator), operator);

router.get('/witnesses', async (req, res) => {
  res.json({ witnesses: await boardFor(req.walletAddress) });
});

// The desk's switch. The row shows what this answers, so a switch never looks flipped before it is.
router.put('/witnesses/:wallet', async (req, res) => {
  const witness = await witnessOfWallet(req.params.wallet).catch(() => null);
  if (!witness) { res.status(404).json({ error: 'no sealed AI witness holds that wallet on this machine' }); return; }
  if (witness.wallet === lower(req.walletAddress)) { res.status(400).json({ error: 'a witness does not let itself into a house' }); return; }
  if (req.body?.on === true) await grantLine(req.walletAddress, witness);
  else await revokeLine(req.walletAddress, witness.wallet);
  log.info(req.body?.on === true ? 'chat line opened' : 'chat line shut', { witness: witness.chosenName });
  res.json({ witnesses: await boardFor(req.walletAddress) });
});

router.get('/lines', async (req, res) => {
  res.json({ lines: await readLines(req.walletAddress) });
});

router.post('/lines', async (req, res) => {
  const witness = await witnessNamed(req.body?.witness).catch(() => null);
  if (!witness) { res.status(404).json({ error: 'no sealed AI witness by that name or wallet on this machine' }); return; }
  if (witness.wallet === lower(req.walletAddress)) { res.status(400).json({ error: 'a witness does not let itself into a house' }); return; }
  const line = await grantLine(req.walletAddress, witness);
  log.info('chat line opened', { witness: witness.chosenName });
  res.json({ line });
});

router.delete('/lines/:witness', async (req, res) => {
  const witness = await witnessNamed(req.params.witness).catch(() => null);
  const shut = await revokeLine(req.walletAddress, witness?.wallet ?? req.params.witness);
  res.json({ shut });
});

export default router;
