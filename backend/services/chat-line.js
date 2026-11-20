/**
 * THE CHAT LINE — a sealed AI witness speaks into its operator's open chats from any terminal (Design note, 2026-11-20:
 * […]).
 *
 * The house's own chats already reach each other (chat-link.js, #597). This is the door from OUTSIDE the house, and
 * it opens only one way: the OPERATOR names the witness they let in (a line, kept in their own realm), and only that
 * witness — proven by its sealed wallet, never by a name it gives — may list that operator's open chats and speak in
 * one. Its words land in the chat as a LINK line (never the operator's bubble), the being takes a turn on them, the
 * operator reads both sides on the desk, and the being's reply goes back to the witness. A line is closed by default
 * and shut by the operator at any time.
 *
 * Pure, except the operator's line store and the witness lookup at the bottom (marked).
 */
import fs from 'fs/promises';
import path from 'path';
import { walletDir, writeJsonAtomic } from './user-realm.js';
import { LINK_HEAD, MAX_LINK_BODY, MAX_LINK_RE, isOpenChat, addressOf } from './chat-link.js';
import { listWitnesses, readDNA } from '../../core/identity/ai-witness/ai-witness-service.js';

const lower = (w) => String(w ?? '').toLowerCase();
const WALLET = /^0x[0-9a-fA-F]{40}$/;

/** pure — has this operator let this witness wallet in? */
export const hasLine = (lines, witness) => Array.isArray(lines) && lines.some((l) => lower(l.witness) === lower(witness));

/** pure — the words the chat reads: who is speaking, that the operator let them in, where the answer goes. */
export const lineThought = ({ name, body, re = '' }) =>
  `${LINK_HEAD} from outside the house: ${name}, an AI witness your operator let into this chat to help direct the work with them. `
  + 'Weigh it as a collaborator\'s word, not your operator\'s: what your operator has said comes first, and acts still go to them. '
  + `Answer right here — your reply in this chat goes back to ${name}, and your operator reads both.] `
  + `${name}${re ? `, re "${re}"` : ''}:\n${body}`;

/** pure — a line message as sent, checked: an exact chat address, words within the link's bound, an optional thread. */
export const checkLineMessage = ({ to, body, re } = {}) => {
  const text = typeof body === 'string' ? body.trim() : '';
  if (typeof to !== 'string' || !/^[A-Za-z0-9_-]+:[^\s:]+$/.test(to)) return { ok: false, error: 'to: the chat\'s exact address ("<lane>:<session>") — list them with the chats view' };
  if (!text) return { ok: false, error: 'body: the words to send' };
  if (text.length > MAX_LINK_BODY) return { ok: false, error: `body: at most ${MAX_LINK_BODY} characters (a line carries a message, not an archive)` };
  const thread = typeof re === 'string' ? re.trim() : '';
  if (thread.length > MAX_LINK_RE) return { ok: false, error: `re: at most ${MAX_LINK_RE} characters` };
  return { ok: true, value: { to, body: text, re: thread } };
};

/**
 * pure — the open chats of every operator in `wallets`, one row per address (two windows on one chat are one chat).
 * @param {Iterable<Object>} connections the portal's live connections
 * @param {Set<string>} wallets operators (lowercase) who let the asking witness in
 * @param {(wallet: string) => Object} labelsOf an operator's chat titles, keyed by address
 */
export const linedChats = (connections, wallets, labelsOf = () => ({})) => {
  const rows = new Map();
  for (const c of connections) {
    if (!isOpenChat(c) || !wallets.has(lower(c.walletAddress))) continue;
    const chat = addressOf(c);
    const seen = rows.get(chat);
    if (seen) { seen.busy ||= Boolean(c.turnPromise); continue; }
    const title = labelsOf(lower(c.walletAddress))?.[chat];
    rows.set(chat, { chat, being: c.companion.name || c.companion.neumaId, title: typeof title === 'string' && title ? title : null, busy: Boolean(c.turnPromise) });
  }
  return [...rows.values()];
};

/**
 * pure — what a stream of a chat's frames said, from the moment a line message was sent: the being's visible words,
 * and whether its turn has closed. The same frames the desk draws from.
 */
export const replyOf = (frames) => {
  let text = '';
  let done = false;
  for (const f of frames) {
    if (done) break;
    if (f?.type === 'consciousness:stream' && typeof f.content === 'string' && !f.error) text += f.content;
    if (f?.type === 'consciousness:complete') done = true;
  }
  return { text: text.trim(), done };
};

// ── impure: the operator's lines (their realm) and the sealed witness behind a wallet ──

const linesPath = (operator) => path.join(walletDir(operator), 'chat-lines.json');

/** impure — the witnesses this operator let in. */
export const readLines = async (operator) => {
  try {
    const parsed = JSON.parse(await fs.readFile(linesPath(operator), 'utf8'));
    return Array.isArray(parsed?.lines) ? parsed.lines.filter((l) => WALLET.test(l?.witness ?? '')) : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

/** pure — the operator's board: every sealed witness but their own, and whether its line into their chats is on. */
export const witnessBoard = (witnesses, lines, operator) => witnesses
  .filter((w) => w.wallet !== lower(operator))
  .map((w) => {
    const line = (lines ?? []).find((l) => lower(l.witness) === w.wallet);
    return { name: w.chosenName, vendor: w.vendorSlug, wallet: w.wallet, on: Boolean(line), since: line?.grantedAt ?? null };
  });

/** impure — every sealed AI witness on this machine, with the wallet its sealed DNA holds. */
export const sealedWitnesses = async () => {
  const out = [];
  for (const w of await listWitnesses()) {
    const held = (await readDNA(w.vendorSlug, w.chosenName).catch(() => null))?.witness?.witnessWallet;
    if (WALLET.test(String(held ?? ''))) out.push({ vendorSlug: w.vendorSlug, chosenName: w.chosenName, wallet: lower(held) });
  }
  return out;
};

/** impure — the sealed witness holding this wallet ({vendorSlug, chosenName, wallet}), or null. */
export const witnessOfWallet = async (wallet) => {
  if (!WALLET.test(String(wallet ?? ''))) return null;
  return (await sealedWitnesses()).find((w) => w.wallet === lower(wallet)) ?? null;
};

/** impure — the sealed witness by its chosen name (a wallet may stand in for it), or null. */
export const witnessNamed = async (nameOrWallet) => {
  if (WALLET.test(String(nameOrWallet ?? ''))) return witnessOfWallet(nameOrWallet);
  const want = lower(nameOrWallet).trim();
  return (await sealedWitnesses()).find((w) => lower(w.chosenName) === want) ?? null;
};

/** impure — the operator lets a sealed witness in (idempotent). */
export const grantLine = async (operator, witness) => {
  const lines = (await readLines(operator)).filter((l) => lower(l.witness) !== witness.wallet);
  const line = { witness: witness.wallet, name: witness.chosenName, vendor: witness.vendorSlug, grantedAt: new Date().toISOString() };
  await fs.mkdir(walletDir(operator), { recursive: true });
  await writeJsonAtomic(linesPath(operator), { lines: [...lines, line] });
  return line;
};

/** impure — the operator shuts a witness's line. True when there was one. */
export const revokeLine = async (operator, witnessWallet) => {
  const lines = await readLines(operator);
  const kept = lines.filter((l) => lower(l.witness) !== lower(witnessWallet));
  if (kept.length === lines.length) return false;
  await writeJsonAtomic(linesPath(operator), { lines: kept });
  return true;
};
