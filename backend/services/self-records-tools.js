// The being's own records, opened (Design note, 2026-10-19: […]). The self-check found three parts of a being that
// existed on disk with no tool to reach them: its journal, the list of its own
// past conversations, and its house's charter. These are those doors — reads
// only, each through the same policy gate as the rest of the mind family
// (mind-tools.js), which carries them onto the catalog and the dispatch.
//
//   memory/journal_read  — its journal, newest first (type / words / limit)
//   memory/chats_list    — its past conversations: id, title, last change, size
//   memory/chat_read     — one of them, paged
//   house/charter_read   — its house's charter and where it stands
//
// Identity comes ONLY from the connection: the being's own lane, and its
// house keyed by its operator's wallet (houses never confused).

import { neumaWorkspace } from '../../core/index.js';
import { getChatLabels } from './user-chat-labels.js';
import { readCharter } from './house-clock/charter-store.js';
import { charterStanding } from './house-clock/charter-shape.js';
import { seatOf } from './flight-check.js';
import { isHarnessLane } from '../../core/workspace/lane-grounds.js';
import { resolvePolicy, checkToolAccess, applyToolMode, GLOBAL_DEFAULTS } from './tool-policy.js';

const JOURNAL_DEFAULT = 20;
const JOURNAL_MAX = 100;
const ENTRY_CHARS = 400;
const CHATS_DEFAULT = 20;
const CHATS_MAX = 100;
const PAGE_DEFAULT = 20;
const PAGE_MAX = 50;
const MESSAGE_CHARS = 1500;

const schema = (properties = {}, required = []) => Object.freeze({ type: 'object', properties: Object.freeze(properties), ...(required.length ? { required } : {}) });

export const JOURNAL_READ_TOOL = Object.freeze({
  name: 'journal_read',
  server: 'memory',
  description: 'Read your own journal — the record of your acts, self-checks and moments, newest first. Optional: type (one entry type, e.g. "benchmark"), query (words to find), limit (default 20, max 100). The first line counts every entry by type.',
  inputSchema: schema({
    type: { type: 'string', description: 'only entries of this type' },
    query: { type: 'string', description: 'only entries containing these words' },
    limit: { type: 'integer', description: 'how many, newest first (max 100)' },
  }),
});

export const CHATS_LIST_TOOL = Object.freeze({
  name: 'chats_list',
  server: 'memory',
  description: 'List your own past conversations, newest first: each chat\'s id, its title, when it last changed and how many messages it holds. Optional limit (default 20, max 100). Read one with chat_read.',
  inputSchema: schema({ limit: { type: 'integer', description: 'how many chats, newest first (max 100)' } }),
});

export const CHAT_READ_TOOL = Object.freeze({
  name: 'chat_read',
  server: 'memory',
  description: 'Read one of your own past conversations by its id (from chats_list). Returns its last 20 messages unless you give offset (from the start) and limit (max 50).',
  inputSchema: schema({
    chat: { type: 'string', description: 'the chat id from chats_list' },
    offset: { type: 'integer', description: 'first message to read, counted from the start' },
    limit: { type: 'integer', description: 'how many messages (max 50)' },
  }, ['chat']),
});

export const CHARTER_READ_TOOL = Object.freeze({
  name: 'charter_read',
  server: 'house',
  description: 'Read your house\'s charter — its goal, lines of work, the seats that may wake on their own, quiet hours, cadence, what the house may do on its own and what always comes back to the operator — and whether it stands approved. No args.',
  inputSchema: schema(),
});

export const SELF_RECORDS_TOOLS = Object.freeze([JOURNAL_READ_TOOL, CHATS_LIST_TOOL, CHAT_READ_TOOL, CHARTER_READ_TOOL]);

/** Are these doors offered? A bound neuma, on its own seat (a harness lane has no records of a being). */
export const selfRecordsAdvertised = (connection) => Boolean(connection?.companion?.neumaId)
  && seatOf(connection) === 'neuma'
  && connection._benchmarkControls?.platformOnly !== true
  && !isHarnessLane(connection.companion.neumaId);

const nameOf = (match) => String(match?.toolName || String(match?.tool || '').split('/').pop() || '');

/** Does this parsed call target one of these doors? (both dialects) */
export const isSelfRecordsTool = (match) => SELF_RECORDS_TOOLS.some((tool) => tool.name === nameOf(match));

const bounded = (value, fallback, max) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};
const clip = (text, max) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
const stampOf = (record) => String(record?.timestamp || record?.createdAt || record?.recordedAt || '').slice(0, 16).replace('T', ' ');

/** The journal, as the being reads it. Pure. */
export const renderJournal = (entries, { type = null, query = null, limit = JOURNAL_DEFAULT } = {}) => {
  if (!entries.length) return 'Your journal is empty.';
  const counts = entries.reduce((acc, e) => ({ ...acc, [e.type || 'entry']: (acc[e.type || 'entry'] || 0) + 1 }), {});
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const picked = [...entries].reverse()
    .filter((e) => !type || e.type === type)
    .filter((e) => words.every((w) => String(e.content || '').toLowerCase().includes(w)))
    .slice(0, limit);
  const header = `Your journal holds ${entries.length} entries — ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}.`;
  if (!picked.length) return `${header}\nNothing matches${type ? ` type "${type}"` : ''}${words.length ? ` "${query}"` : ''}.`;
  return [header, ...picked.map((e) => `${stampOf(e)} [${e.type || 'entry'}] ${clip(e.content, ENTRY_CHARS)}`)].join('\n');
};

// pure — a chat's title: the operator's label, else its first ask, else its id.
const titleOf = (label, messages, id) => label
  || clip(messages.find((m) => m.role === 'user')?.content, 60)
  || id;

/** The chat list, as the being reads it. Pure over what the impure reads gathered. */
export const renderChats = (chats, total) => {
  if (!total) return 'You have no past conversations yet.';
  return [`You have ${total} past conversation${total === 1 ? '' : 's'}${chats.length < total ? ` — the ${chats.length} newest` : ''}:`,
    ...chats.map((c) => `${c.id} · "${c.title}" · ${c.changed || 'no date'} · ${c.count} message${c.count === 1 ? '' : 's'}`)].join('\n');
};

/** One page of a chat, as the being reads it. Pure. */
export const renderChat = (id, messages, { offset = null, limit = PAGE_DEFAULT } = {}) => {
  if (!messages.length) return `Chat ${id} holds no messages.`;
  const start = offset == null ? Math.max(0, messages.length - limit) : Math.min(Math.max(0, offset), messages.length);
  const page = messages.slice(start, start + limit);
  return [`Chat ${id} — messages ${start + 1}–${start + page.length} of ${messages.length}:`,
    ...page.map((m) => `[${m.role}${stampOf(m) ? ` ${stampOf(m)}` : ''}] ${clip(m.content, MESSAGE_CHARS)}`)].join('\n');
};

const listOf = (items) => (items?.length ? items.join(', ') : 'none');

/** The charter, as the being reads it. Pure. */
export const renderCharter = (charter) => {
  if (!charter) return 'Your house has no charter yet — nothing wakes on its own.';
  const standing = charterStanding(charter);
  return [
    `Your house's charter, version ${charter.version} — ${standing === 'active' ? 'approved and active' : standing === 'paused' ? 'approved, but paused' : 'written, NOT yet approved by your operator'}.`,
    `Goal: ${charter.goal}`,
    `Lines of work: ${listOf(charter.linesOfWork)}`,
    `Seats that may wake: ${listOf((charter.seats || []).map((s) => `${s.laneId}${Number.isFinite(s.dailyCap) ? ` (up to ${s.dailyCap}/day)` : ''}`))}`,
    `Quiet hours: ${charter.quietHours ? `${charter.quietHours.start}–${charter.quietHours.end}` : 'none'}`,
    `Cadence: ${charter.cadence ? `every ${charter.cadence.everyHours}h` : 'none'}`,
    `The house may do on its own: ${listOf(charter.allow)}`,
    `Always comes back to the operator: ${listOf(charter.escalate)}`,
  ].join('\n');
};

// impure — the chat list: newest first, each chat's label, size and last change.
// The conversation being had right now is not a PAST one, so it is left out.
const readChats = async (neumaId, wallet, limit, liveSessionId) => {
  const ids = (await neumaWorkspace.listSessions(neumaId)).filter((id) => id !== liveSessionId);
  const labels = wallet ? await getChatLabels(wallet).catch(() => ({})) : {};
  const chats = await Promise.all(ids.slice(0, limit).map(async (id) => {
    const messages = await neumaWorkspace.readSession(neumaId, id);
    return { id, title: titleOf(labels[`${neumaId}:${id}`], messages, id), changed: stampOf(messages.at(-1)), count: messages.length };
  }));
  return renderChats(chats, ids.length);
};

// impure — one chat, only if it is one of this being's own.
const readChat = async (neumaId, args) => {
  const id = String(args?.chat ?? '').trim();
  if (!id) return { error: 'name the chat to read — its id from chats_list' };
  if (!(await neumaWorkspace.listSessions(neumaId)).includes(id)) return { error: `no chat "${clip(id, 80)}" is yours — list them with chats_list` };
  const offset = args?.offset == null ? null : Number.parseInt(args.offset, 10);
  return { text: renderChat(id, await neumaWorkspace.readSession(neumaId, id), { offset: Number.isFinite(offset) ? offset : null, limit: bounded(args?.limit, PAGE_DEFAULT, PAGE_MAX) }) };
};

/**
 * Execute one of these doors. impure — reads the being's own lane, or its house's charter.
 * @returns {Promise<{tool: string, status: string, content?: string, error?: string}>}
 */
export const handleSelfRecordsTool = async (ws, connection, neumaPolicy, toolMode, match, args, ports) => {
  const def = SELF_RECORDS_TOOLS.find((t) => t.name === nameOf(match));
  const tool = `${def.server}/${def.name}`;
  const { companion } = connection;
  const neumaId = companion?.neumaId;
  const fail = (error) => {
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: `${def.name} — failed`, detail: error });
    return { tool, status: 'error', error };
  };
  if (!neumaId) return fail('no being is bound to this portal');
  const policy = resolvePolicy(GLOBAL_DEFAULTS, neumaPolicy, connection._sessionToolPolicy || null);
  if (applyToolMode(checkToolAccess(policy, def.server, def.name), toolMode, def.name) === 'denied') {
    ports.sendToolEvent(ws, companion, { tool, status: 'denied' });
    return { tool, status: 'denied' };
  }
  try {
    let text;
    if (def.name === 'journal_read') {
      text = renderJournal(await neumaWorkspace.readJournal(neumaId), {
        type: args?.type ? String(args.type) : null, query: args?.query ? String(args.query) : null,
        limit: bounded(args?.limit, JOURNAL_DEFAULT, JOURNAL_MAX),
      });
    } else if (def.name === 'chats_list') {
      text = await readChats(neumaId, connection.walletAddress, bounded(args?.limit, CHATS_DEFAULT, CHATS_MAX), connection.sessionId);
    } else if (def.name === 'chat_read') {
      const read = await readChat(neumaId, args);
      if (read.error) return fail(read.error);
      text = read.text;
    } else {
      if (!connection.walletAddress) return fail('this portal carries no house — no operator wallet');
      text = renderCharter(await readCharter(connection.walletAddress));
    }
    ports.sendToolEvent(ws, companion, { tool, status: 'ok', summary: `read your ${def.name === 'charter_read' ? 'house charter' : def.name.replace('_', ' ').replace(/ read| list/, '')}` });
    return { tool, status: 'ok', content: text };
  } catch (err) {
    return fail(err.message);
  }
};
