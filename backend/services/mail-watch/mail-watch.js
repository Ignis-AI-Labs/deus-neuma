// THE HOUSE MAILBOX WATCH — a reply wakes the right seat (the house economy's
// Stage 4: […]). Every five
// minutes, for each house this backend serves whose mailbox is connected,
// the watch lists the newest messages, read-only (nothing is marked read,
// nothing is sent), and wakes a seat for each one that is new:
//   - from an investor on any of the house's raises, or a lead it works:
//     the Mercator, who holds those conversations;
//   - anything else: the being that holds the mailbox.
// The wake is the house clock's (wake-signal.js): only a seat the charter
// names wakes, inside its caps and quiet hours. The wake carries the sender's
// bare address and the message's number, never its words — the seat reads
// it with read_email, where it arrives as untrusted text.
//
// OFF until the operator turns on the "House mailbox watch" connection
// (electron/connections.json; Design note, 2026-10-25. The first look at a mailbox
// wakes nobody: it marks where the watch begins.
// Before any wake, each new message settles for the lead engine
// (sales/mail-upkeep.js): a lead's reply marks the lead; a bounce or a
// request to be left alone closes the address, by fixed rules, no model.
// impure (timers, IMAP, the house's files).

import path from 'path';
import { isConnectionOn } from '../connections/connection-switches.js';
import { servedHouses } from '../house-served.js';
import { walletDir } from '../user-realm.js';
import { readJson, writePrivate, ABSENT } from '../house-office-legacy.js';
import { resolveEmailCredential } from '../email/email-credentials.js';
import { emailBinding } from '../email/email-binding.js';
import { EMAIL_ACCOUNT } from '../email/email-registry.js';
import { listInbox, INBOX_MAX_MESSAGES } from '../email/imap-reader.js';
import { croDesignation } from '../revenue/cro-designation.js';
import { listCompanies } from '../company-line/company-store.js';
import { readRaise } from '../raise/raise-store.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { settleMail } from '../sales/mail-upkeep.js';
import { signalWake } from '../house-clock/wake-signal.js';
import { createLogger } from '../logger.js';

const log = createLogger('MailWatch');

/** How often the watch looks. */
export const MAIL_WATCH_TICK_MS = 5 * 60 * 1000;

const stateFile = (wallet) => path.join(walletDir(wallet), 'mail-watch.json');

/** The sender's bare address, lower-cased, or null. pure. */
export const bareAddress = (from) => {
  const text = String(from ?? '');
  const m = text.match(/<([^<>\s]+@[^<>\s]+)>/) || text.match(/([^\s<>"',;]+@[^\s<>"',;]+\.[^\s<>"',;]+)/);
  return m ? m[1].toLowerCase() : null;
};

/**
 * Which seat a new message wakes, and the conversation it belongs to. pure.
 * @param {{from: string, investors: Array<{id: string, name: string, email: string, company: string}>,
 *   leads: Array<{id: string, contact?: string}>, mercator: ?string, holder: ?string}} args
 * @returns {?{seat: string, thread: ?string}}
 */
export const routeMail = ({ from, investors, leads, mercator, holder }) => {
  const sender = bareAddress(from);
  const seller = mercator ?? holder;
  const investor = sender && investors.find((i) => String(i.email).toLowerCase() === sender);
  if (investor && seller) return { seat: seller, thread: `investor ${investor.name} [${investor.id}] on ${investor.company}'s raise` };
  const lead = sender && leads.find((l) => String(l.contact ?? '').toLowerCase() === sender);
  if (lead && seller) return { seat: seller, thread: `lead [${lead.id}]` };
  return holder ? { seat: holder, thread: null } : null;
};

// impure — who the house's conversations are with: every raise's investors, and the leads.
const conversations = async (house) => {
  const { companies } = await listCompanies(house).catch(() => ({ companies: [] }));
  const raises = await Promise.all(companies.map(async (c) => ({ c, r: await readRaise(house, c.id).catch(() => null) })));
  const investors = raises.flatMap(({ c, r }) => (r?.investors ?? []).map((i) => ({ id: i.id, name: i.name, email: i.email, company: c.name })));
  const leads = await leadLedgerFor(house).then((l) => l.load()).catch(() => []);
  return { investors, leads };
};

/**
 * One look at one house's mailbox. Never throws. impure.
 * @returns {Promise<{house: string, mailbox: boolean, first?: boolean, woke?: number, error?: string}>}
 */
export const watchHouse = async (house) => {
  const credentials = await resolveEmailCredential(house).catch(() => null);
  if (!credentials) return { house, mailbox: false };
  const listed = await listInbox(credentials, { limit: INBOX_MAX_MESSAGES });
  if (!listed.ok) return { house, mailbox: true, error: listed.detail };
  const top = Math.max(0, ...listed.messages.map((m) => m.uid));
  const state = await readJson(stateFile(house));
  if (state === ABSENT || !Number.isInteger(state?.lastUid)) {
    await writePrivate(stateFile(house), { lastUid: top, since: new Date().toISOString() });
    return { house, mailbox: true, first: true, woke: 0 };
  }
  const fresh = listed.messages.filter((m) => m.uid > state.lastUid).sort((a, b) => a.uid - b.uid);
  if (!fresh.length) return { house, mailbox: true, woke: 0 };
  const [bindings, officer, { investors, leads }] = await Promise.all([
    emailBinding.load(house).catch(() => ({})), croDesignation.getOfficer(house).catch(() => null), conversations(house),
  ]);
  const holder = bindings?.[EMAIL_ACCOUNT.id]?.neumaId ?? null;
  let woke = 0;
  for (const m of fresh) {
    const route = routeMail({ from: m.from, investors, leads, mercator: officer?.laneId ?? null, holder });
    await settleMail(house, { credentials, message: m, sender: bareAddress(m.from), isLead: Boolean(route?.thread?.startsWith('lead ')), leads });
    if (!route) continue;
    signalWake({ seat: route.seat, reason: 'mail', ref: `mail:${m.uid}`, detail: { uid: m.uid, from: bareAddress(m.from), thread: route.thread } });
    woke += 1;
  }
  await writePrivate(stateFile(house), { lastUid: Math.max(state.lastUid, top), since: state.since });
  return { house, mailbox: true, woke };
};

let running = false;

/** One pass over every served house. Never throws. impure. */
export const mailWatchTick = async () => {
  if (running) return { skipped: 'previous look still running' };
  if (!isConnectionOn('mail-watch')) return { off: true };
  running = true;
  try {
    const looks = [];
    for (const house of await servedHouses()) looks.push(await watchHouse(house).catch((err) => ({ house, error: err.message })));
    for (const l of looks.filter((x) => x.error)) log.warn('a house mailbox could not be read', { house: l.house, error: l.error });
    return { looks };
  } finally {
    running = false;
  }
};

/** Start the watch. The interval is unref'd so it never holds the process open. impure. */
export const startMailWatch = ({ intervalMs = MAIL_WATCH_TICK_MS } = {}) => {
  const timer = setInterval(() => {
    mailWatchTick().catch((err) => log.error('mail watch tick failed', { error: err.message }));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
};
