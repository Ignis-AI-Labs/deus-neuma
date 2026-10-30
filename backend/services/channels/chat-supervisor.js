// THE CHAT BRIDGE'S SUPERVISOR (channel connections C-03/C-04/C-06) — keeps
// each house's Telegram and Discord bots hearing, and hands what they hear to
// the door (chat-access.js) and the bridge (channel-bridge.js):
//   - a bot is heard only when the operator turned on the […] connection (OFF by default), the account has a holder among
//     this backend's lanes (house-served.js), and its token is set;
//   - an approved person (or group, when it names the bot) gets a real turn
//     with the holder — the same streamConsciousness a desk chat runs, in the
//     observe tool mode (no approval chip can be tapped from a chat);
//   - a stranger gets one pairing code from the platform, never a word from a
//     being, and waits on the operator (WAITING ON YOU, the platform's CHATS);
//   - a line that drops reconnects with backoff; a refused token stops until
//     the account changes.
// The reconcile runs every minute and on demand, so a flip of the switch, a
// new holder or new keys take hold without a restart.
// impure (timers, the network through the adapters, the house's files).

import path from 'path';
import { isConnectionOn } from '../connections/connection-switches.js';
import { readServed, laneHouse } from '../house-served.js';
import { walletDir } from '../user-realm.js';
import { readJson, writePrivate, ABSENT } from '../house-office-legacy.js';
import { createWriteChain } from '../write-chain.js';
import { channelBindings } from '../social/channel-bindings.js';
import { channelOfAccountId } from '../social/account-shape.js';
import { resolveAccountCredential } from '../social/account-store.js';
import { seatName } from '../house-clock/wake-plan.js';
import { createChannelBridge } from './channel-bridge.js';
import { createTelegramAdapter } from './adapters/telegram.js';
import { createDiscordAdapter } from './adapters/discord.js';
import { atTheDoor, answerCode, revoke, pairingWords, emptyAccess } from './chat-access.js';
import { createLogger } from '../logger.js';

const log = createLogger('ChatBridge');
export const CHAT_CHANNELS = Object.freeze({ telegram: createTelegramAdapter, discord: createDiscordAdapter });
const RECONCILE_MS = 60_000;
const BACKOFF_MS = Object.freeze([2_000, 5_000, 15_000, 60_000, 300_000]);

const serialize = createWriteChain();
const accessFile = (wallet) => path.join(walletDir(wallet), 'chat-access.json');

/** The house's door records, by account. impure. */
export const readChatAccess = async (wallet) => {
  const doc = await readJson(accessFile(wallet));
  return doc === ABSENT || !doc ? {} : doc;
};
const writeAccount = (wallet, accountId, change) => serialize(async () => {
  const all = await readChatAccess(wallet);
  const next = change(all[accountId] ?? emptyAccess());
  await writePrivate(accessFile(wallet), { ...all, [accountId]: next });
  return next;
});

/** The operator answers a pairing code. impure. */
export const answerChatCode = async (wallet, accountId, { code, approve, by }) => {
  let outcome = null;
  await writeAccount(wallet, accountId, (access) => {
    outcome = answerCode(access, { code, approve, by, nowMs: Date.now() });
    return outcome.ok ? outcome.access : access;
  });
  return outcome;
};

/** The operator takes someone off the list. impure. */
export const revokeChatAccess = (wallet, accountId, who) => writeAccount(wallet, accountId, (access) => revoke(access, who));

// connectionId → { house, accountId, channel, holder, controller, status }
const running = new Map();

// impure — one bot heard until its controller aborts; reconnects with backoff.
const run = async (conn, credentials) => {
  const { house, accountId, holder } = conn;
  const adapter = CHAT_CHANNELS[conn.channel]({ connectionId: conn.connectionId });
  const companionName = await seatName(holder);
  const bridge = createChannelBridge({ adapter, record: { connectionId: conn.connectionId, neumaId: holder, companionName, walletAddress: house } });
  const onEvent = async (event, { mentioned = false } = {}) => {
    let door = null;
    await writeAccount(house, accountId, (access) => {
      door = atTheDoor(access, event, { nowMs: Date.now(), mentioned });
      return door.access ?? access;
    });
    if (door.door === 'hear') {
      conn.status.heard += 1;
      // never awaited: a turn may take minutes, and the line keeps hearing the other chats meanwhile
      bridge.handleEvent(event).catch((err) => log.warn('a chat turn failed', { connection: conn.connectionId, error: err.message }));
      return null;
    }
    if (door.door === 'pair') {
      log.info('a stranger asked to talk — a code waits on the operator', { house, accountId, kind: event.chat.type });
      return adapter.send(event.chat, pairingWords(companionName, door.code), { replyTo: event.messageId });
    }
    if (/dropped/.test(door.why)) log.warn('a sender past its pairing attempts was dropped', { house, accountId, user: event.user.id, chat: `${event.chat.type}:${event.chat.id}` });
    return null;
  };
  let attempt = 0;
  while (!conn.controller.signal.aborted) {
    conn.status.running = true;
    conn.status.since = new Date().toISOString();
    try {
      await adapter.connect({ credentials, onEvent, signal: conn.controller.signal });
      if (conn.controller.signal.aborted) break;
      attempt = 0;
    } catch (err) {
      conn.status.running = false;
      conn.status.lastError = err.message;
      if (err.fatal || /refused the bot/.test(err.message)) {
        log.warn('a chat bot was refused — it stays off until its account changes', { house, accountId, error: err.message });
        conn.status.stopped = true;
        break;
      }
      const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt += 1;
      conn.status.restarts += 1;
      await new Promise((r) => { const t = setTimeout(r, wait); t.unref?.(); conn.controller.signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });
    }
  }
  conn.status.running = false;
  bridge.dispose();
  adapter.disconnect();
};

// impure — the accounts that should be heard now, each with its holder and keys.
const wanted = async () => {
  if (!isConnectionOn('chat-bridge')) return [];
  const served = await readServed();
  const out = [];
  for (const house of served.houses) {
    const bindings = await channelBindings.load(house).catch(() => ({}));
    for (const [accountId, holding] of Object.entries(bindings)) {
      const channel = channelOfAccountId(accountId);
      if (!CHAT_CHANNELS[channel] || !holding?.neumaId || !laneHouse(served, holding.neumaId, house)) continue;
      const credentials = await resolveAccountCredential(house, accountId).catch(() => null);
      if (!credentials?.botToken) continue;
      const adapter = CHAT_CHANNELS[channel]({ connectionId: 'check' });
      if (!adapter.checkRequirements(credentials).ok) continue;
      out.push({ connectionId: `${house}:${accountId}`, house, accountId, channel, holder: holding.neumaId, credentials, key: `${holding.neumaId}|${credentials.botToken}` });
    }
  }
  return out;
};

/** Bring the running bots in line with what should run. Never throws. impure. */
export const reconcileChats = async () => {
  try {
    const want = await wanted();
    const ids = new Set(want.map((w) => w.connectionId));
    for (const [id, conn] of running) {
      const w = want.find((x) => x.connectionId === id);
      if (!ids.has(id) || w.key !== conn.key) {
        conn.controller.abort();
        running.delete(id);
      }
    }
    for (const w of want) {
      if (running.has(w.connectionId)) continue;
      const conn = { ...w, controller: new AbortController(), status: { running: false, since: null, lastError: null, restarts: 0, heard: 0, stopped: false } };
      delete conn.credentials;
      running.set(w.connectionId, conn);
      run(conn, w.credentials).catch((err) => log.error('a chat bot stopped unexpectedly', { connection: w.connectionId, error: err.message }));
    }
    return { running: running.size };
  } catch (err) {
    log.warn('the chat bridge could not reconcile', { error: err.message });
    return { running: running.size, error: err.message };
  }
};

/** Each of a house's chat accounts: what runs, and its door. impure. */
export const chatBridgeStatus = async (wallet) => {
  const house = String(wallet).toLowerCase();
  const access = await readChatAccess(house);
  const accounts = new Set([...Object.keys(access), ...[...running.values()].filter((c) => c.house === house).map((c) => c.accountId)]);
  const on = isConnectionOn('chat-bridge');
  return {
    on,
    accounts: [...accounts].sort().map((accountId) => {
      const conn = running.get(`${house}:${accountId}`);
      return {
        accountId, channel: channelOfAccountId(accountId), holder: conn?.holder ?? null,
        running: Boolean(conn?.status.running), lastError: conn?.status.lastError ?? null, stopped: Boolean(conn?.status.stopped),
        heard: conn?.status.heard ?? 0, allowed: access[accountId]?.allowed ?? [],
        pending: (access[accountId]?.pending ?? []).filter((p) => Date.now() - Date.parse(p.at) < 3_600_000),
      };
    }),
  };
};

/** Start the supervisor; returns its stop. impure. */
export const startChatBridge = ({ intervalMs = RECONCILE_MS } = {}) => {
  reconcileChats();
  const timer = setInterval(() => { reconcileChats(); }, intervalMs);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    for (const conn of running.values()) conn.controller.abort();
    running.clear();
  };
};
