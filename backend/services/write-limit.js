// write-limit — how many files a being may write in one message, where nobody opened the ground to it (Founder,
// 2026-11-19, after Rugevil stopped halfway through swapping two signed PDFs: […] — then:
// […]).
//
// The limit counts a being's writes in its OWN folder, and any copy or move out of it (tool-sandbox.js): writes wholly
// inside a folder the operator granted, or has open in the Explorer, are theirs by consent and never counted. It was
// ten a connection, for good: it never reset while the window stayed open, said only […], and stopped work halfway. Now:
//   - ON BY DEFAULT, ten a message: the count starts again with every message (each turn's own activeTurn).
//   - The operator's rule, machine-wide (install owner): on or off, and the number (SETTINGS → SECURITY → WRITE LIMIT).
//   - Reached, it ASKS (tool-approval.js): ALLOW is as many again this message, ALWAYS is no limit for the rest of
//     this message, NO stops it. Where nobody can be asked (a wake, a clone, a closed window) it stops, saying the
//     numbers, when it starts again, and where the switch is.
// impure (the rule's file; the connection's count; the operator's card).

import fs from 'fs/promises';
import process from 'node:process';
import { dirname, join } from 'path';
import { getSettingsDir } from './data-root.js';

export const WRITE_LIMIT_DEFAULT = 10;
export const WRITE_LIMIT_MAX = 1000;
const WRITE_LIMIT_WHERE = 'SETTINGS → SECURITY → WRITE LIMIT';
const fileOf = (env) => env.NEUMA_WRITE_LIMIT_PATH || join(getSettingsDir(), 'write-limit.json');

/** pure — the rule as kept: on unless turned off; the number a whole one from 1 to WRITE_LIMIT_MAX, else the default. */
const writeLimitOf = (raw) => {
  const cap = Number(raw?.cap);
  return { on: raw?.on !== false, cap: Number.isInteger(cap) && cap >= 1 && cap <= WRITE_LIMIT_MAX ? cap : WRITE_LIMIT_DEFAULT };
};

/** pure — a change refused, in words, or null. */
const writeLimitRefusal = (change) => {
  if (change?.on !== undefined && typeof change.on !== 'boolean') return 'on is true or false';
  if (change?.cap !== undefined && !(Number.isInteger(change.cap) && change.cap >= 1 && change.cap <= WRITE_LIMIT_MAX)) return `the number is a whole number of writes, 1 to ${WRITE_LIMIT_MAX}`;
  return change?.on === undefined && change?.cap === undefined ? 'say on (true or false), cap (a number), or both' : null;
};

const createWriteLimitSettings = ({ path, env = process.env } = {}) => {
  const target = () => path || fileOf(env);
  const read = async () => {
    try { return writeLimitOf(JSON.parse(await fs.readFile(target(), 'utf8'))); } catch { return writeLimitOf(null); }
  };
  return {
    read,
    /** @returns {Promise<{ok: true, rule: {on: boolean, cap: number}} | {ok: false, reason: string}>} */
    async set(change) {
      const refused = writeLimitRefusal(change);
      if (refused) return { ok: false, reason: refused };
      const rule = { ...(await read()), ...(change.on !== undefined ? { on: change.on } : {}), ...(change.cap !== undefined ? { cap: change.cap } : {}) };
      await fs.mkdir(dirname(target()), { recursive: true });
      const tmp = `${target()}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(rule, null, 2)}\n`);
      await fs.rename(tmp, target());
      return { ok: true, rule };
    },
  };
};

export const writeLimitSettings = createWriteLimitSettings();

// impure (the connection) — this message's count: it starts again with each message, each turn being its own. A
// connection that carries no turns (a single tool call, a ceremony step) keeps one count for its life.
const thisMessage = (connection) => {
  const turn = connection.activeTurn ?? null;
  if (turn && connection._writeOpsTurn !== turn) {
    connection._writeOpsTurn = turn;
    connection._writeOps = 0;
    connection._writeOpsMore = 0;
    connection._writeOpsFree = false;
  }
};

/** pure — what the being reads when the limit stopped it. */
const limitReason = ({ cap, used }) => `The write limit stopped this write: ${used} writes this message in your own folder (the limit is ${cap} `
  + 'a message; a copy or move out of it counts too), and more was not allowed — your operator said no, or nobody was there to ask. '
  + 'Writes inside a folder your operator granted you or has open in their Explorer never count. The count starts again '
  + `with your operator's next message: say what is left to write, and they can tell you to go on. They can change the number or turn the limit off in ${WRITE_LIMIT_WHERE}.`;

// impure — the operator's card. Lazy: tool-approval.js reaches back into tool-sandbox.js, which gates through here.
const askToKeepWriting = async (connection, { cap, used, tool, where }) => {
  const { requestToolApproval } = await import('./tool-approval.js');
  return requestToolApproval(connection, {
    tool: 'files/keep_writing',
    label: `KEEP WRITING — ${connection.companion?.name ?? 'the being'} reached the write limit (${cap} this message)`,
    args: {
      reached: `${used} writes this message in its own folder (the limit is ${cap} a message)`,
      next: `${tool}${where ? ` ${where}` : ''}`,
      allow: `${cap} more this message`,
      always: 'no limit for the rest of this message',
      setting: `${WRITE_LIMIT_WHERE} turns the limit off or changes the number`,
    },
    signal: connection.activeTurn?.signal,
  });
};

/**
 * impure — one counted write, let through or stopped.
 * @param {object} connection the portal connection (its activeTurn marks the message)
 * @param {{tool: string, where?: string}} write what is about to be written
 * @param {{read: () => Promise<{on: boolean, cap: number}>}} [settings]
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
export const passWriteLimit = async (connection, { tool, where }, settings = writeLimitSettings) => {
  const rule = await settings.read();
  if (!rule.on) return { ok: true };
  thisMessage(connection);
  const used = connection._writeOps || 0;
  if (!connection._writeOpsFree && used >= rule.cap + (connection._writeOpsMore || 0)) {
    const decision = await askToKeepWriting(connection, { cap: rule.cap, used, tool, where });
    if (decision === 'allow') connection._writeOpsMore = (connection._writeOpsMore || 0) + rule.cap;
    else if (decision === 'always') connection._writeOpsFree = true;
    else return { ok: false, reason: limitReason({ cap: rule.cap, used }) };
  }
  connection._writeOps = used + 1;
  return { ok: true };
};
