/**
 * THE SITTING'S DISCLOSED TOOLS — what a being found with tool_search stays
 * found for the rest of that chat.
 *
 * The disclosed set used to reset at every turn. On a local model whose chat
 * template renders the TOOL LIST FIRST — before the system prompt and the
 * whole conversation — that reset meant each new turn opened with a shorter
 * tool list than the rounds that ended the last one, so no slot's cache
 * matched and the server re-read the entire chat: ~95k tokens, ~41 s before
 * the first word, every turn (live 2026-09-25, […]).
 *
 * Remembered per (being, chat): a new chat or a different being starts
 * clean. A remembered tool re-enters only if this turn's catalog still
 * carries it and it is not denied — the gate still judges every call.
 */

import fs from 'fs/promises';
import path from 'path';
import { getSettingsDir } from './data-root.js';
import { writeJsonAtomic } from './user-realm.js';

const keyOf = (connection) => `${connection?.companion?.neumaId || ''}:${connection?.sessionId || ''}`;

/**
 * Pure — the ids this chat has already disclosed that this turn's catalog
 * still offers (never a denied tool).
 * @param {Object} connection
 * @param {Array<Object>} catalog this turn's stamped catalog
 * @param {(tool: Object) => string} idOf
 * @returns {string[]}
 */
export const rememberedDisclosure = (connection, catalog, idOf) => {
  const held = connection?._sittingDisclosure;
  if (!held || held.key !== keyOf(connection)) return [];
  return catalog.filter((tool) => tool.access !== 'denied' && held.ids.has(idOf(tool))).map(idOf);
};

/**
 * Impure — remember ids disclosed this turn for the rest of the chat.
 * @param {Object} connection
 * @param {Iterable<string>} ids
 */
export const rememberDisclosure = (connection, ids) => {
  if (!connection) return;
  const key = keyOf(connection);
  const prior = connection._sittingDisclosure?.key === key ? connection._sittingDisclosure.ids : new Set();
  connection._sittingDisclosure = { key, ids: new Set([...prior, ...ids]) };
};

/**
 * THE BEING'S WORKING SET — the lazy tools a being actually CALLED lately ride
 * from the first round of every chat. A tool that joins the list mid-chat
 * re-reads the whole conversation on a tools-first template (prefix-drift
 * 2026-09-28→10-04: ~35 near-full re-reads, mostly the same post-queue, image
 * and retrieve tools found again in each new chat). The full schema is the
 * price — llama.cpp's call grammar admits only declared parameters, so a thin
 * listing cannot be called (CPU probe 2026-10-04). Most recent first, capped;
 * the gate still judges every call.
 *
 * KEPT ON DISK (2026-10-06): held only for the backend's life, every desk
 * relaunch (every app start, for a user) emptied it, and the first chats after
 * it found the same tools again — one live morning paid four whole-chat
 * re-reads (~110–132k chars each) in 2.5 minutes. Tool ids only, per being,
 * under the settings dir; read once per being per backend life.
 */
export const WORKING_SET_MAX = 8;
const workingSets = new Map(); // neumaId -> ids, most recent first
const hydrations = new Map(); // neumaId -> Promise, the one disk read
let writes = Promise.resolve();

// impure (reads process.env) — the store; NEUMA_WORKING_SET_PATH pins it (test/setup.js).
const storePath = () => process.env.NEUMA_WORKING_SET_PATH || path.join(getSettingsDir(), 'working-sets.json');

// impure — the whole store; missing or unreadable is empty, never a failed turn.
const readStore = async () => {
  try {
    const parsed = JSON.parse(await fs.readFile(storePath(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

// impure — fold this being's kept set in BEHIND what this backend life already
// holds (the live calls are the more recent), once.
const hydrate = (neumaId) => {
  if (!hydrations.has(neumaId)) {
    hydrations.set(neumaId, readStore().then((store) => {
      const kept = Object.hasOwn(store, neumaId) && Array.isArray(store[neumaId]) ? store[neumaId] : [];
      const live = workingSets.get(neumaId) || [];
      workingSets.set(neumaId, [...new Set([...live, ...kept.filter((id) => typeof id === 'string')])].slice(0, WORKING_SET_MAX));
    }));
  }
  return hydrations.get(neumaId);
};

// impure — write this being's set; other beings' entries (other backends) stay
// as they are. Serialized, and a failed write only costs the next restart.
const persist = (neumaId) => {
  writes = writes
    .then(() => hydrate(neumaId))
    .then(async () => writeJsonAtomic(storePath(), { ...await readStore(), [neumaId]: workingSets.get(neumaId) || [] }))
    .catch((err) => console.warn(`[working-set] not kept: ${err.message}`));
  return writes;
};

/**
 * Pure — a call's catalog id in either spelling (`server/tool`, native `server__tool`).
 * @param {{tool?: string}} match
 * @returns {string}
 */
export const callCatalogId = (match) => String(match?.tool || '').replace('__', '/');

/**
 * Impure — note that this being called a tool it had to disclose.
 * @param {Object} connection
 * @param {string} id
 */
export const rememberUse = (connection, id) => {
  const neumaId = connection?.companion?.neumaId;
  if (!neumaId || !id) return;
  const prior = (workingSets.get(neumaId) || []).filter((held) => held !== id);
  workingSets.set(neumaId, [id, ...prior].slice(0, WORKING_SET_MAX));
  persist(neumaId);
};

// The doors and a sender's own task tools are never experience — the doors
// ride every turn, and the sender's tools belong to the sender (tool-hud.js).
const NOT_EXPERIENCE = new Set(['system/tool_search', 'system/call']);

/**
 * Impure — remember the call when it reached a real tool of this turn's
 * catalog: THE BEING'S EXPERIENCE (tool-hud.js). Every tool it actually uses
 * is named in its next chats' HUD by signature, so a being that knows its
 * work calls its tools directly. A benchmark sitting never writes the
 * experience of the lane it sits on. Hands the match back.
 * @param {Object} connection
 * @param {Object} match a parsed tool call
 * @returns {Object} match
 */
export const noteWorkingSetCall = (connection, match) => {
  const id = callCatalogId(match);
  const offered = (connection?._turnCatalog || []).some((tool) => `${tool.server}/${tool.name}` === id);
  if (offered && !NOT_EXPERIENCE.has(id) && !id.startsWith('caller/') && !connection?._benchmarkControls) rememberUse(connection, id);
  return match;
};

/**
 * Impure (the being's first ask reads the kept set) — the working-set ids
 * this turn's catalog still offers (never a denied tool).
 * @param {Object} connection
 * @param {Array<Object>} catalog
 * @param {(tool: Object) => string} idOf
 * @returns {Promise<string[]>}
 */
export const workingSetDisclosure = async (connection, catalog, idOf) => {
  const neumaId = connection?.companion?.neumaId;
  if (neumaId) await hydrate(neumaId);
  const held = new Set(workingSets.get(neumaId) || []);
  return catalog.filter((tool) => tool.access !== 'denied' && held.has(idOf(tool))).map(idOf);
};

/**
 * THE CHAT'S TOOL LIST — kept on disk, in the order it rode the wire
 * (2026-10-13). Held only in memory, a chat's found tools were lost at every
 * desk restart and reconnect; the cross-chat working set then ADDED tools to
 * an EXISTING chat; and the list was ordered by each turn's catalog, so a tool
 * found mid-chat was INSERTED, not appended. Each was a new tool list at the
 * top of the prompt — the whole chat re-read (Founder's 128k-token chat,
 * 2026-10-12: nearly every turn opened with ~125k tokens read again).
 *
 * Per (being, chat): the ids in wire order. A turn of an EXISTING chat opens
 * with exactly that list (what the catalog still offers, never a denied tool);
 * a tool found mid-chat joins at the END; only a NEW chat starts from the
 * being's working set. The gate still judges every call.
 */
export const CHAT_LISTS_MAX = 200;
/** A chat's kept list never grows past this many ids. */
export const CHAT_LIST_IDS_MAX = 96;
const chatLists = new Map(); // `${neumaId}:${sessionId}` -> { ids, at }
let chatHydration = null;
let chatWrites = Promise.resolve();

// impure (reads process.env) — NEUMA_CHAT_TOOLS_PATH pins it (test/setup.js).
const chatStorePath = () => process.env.NEUMA_CHAT_TOOLS_PATH || path.join(getSettingsDir(), 'chat-tools.json');

// pure — the chat a connection sits in, or null before it has one.
const chatKey = (connection) => {
  const neumaId = connection?.companion?.neumaId;
  const sessionId = connection?.sessionId;
  return neumaId && sessionId ? `${neumaId}:${sessionId}` : null;
};

// impure — the kept lists, read once per backend life, behind what this life already holds.
const hydrateChats = () => {
  chatHydration ??= fs.readFile(chatStorePath(), 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => ({}))
    .then((stored) => {
      for (const [key, row] of Object.entries(stored && typeof stored === 'object' ? stored : {})) {
        if (!chatLists.has(key) && Array.isArray(row?.ids)) chatLists.set(key, { ids: row.ids.filter((id) => typeof id === 'string'), at: row.at || null });
      }
    });
  return chatHydration;
};

// impure — write the newest CHAT_LISTS_MAX lists; a failed write only costs the next restart.
const persistChats = () => {
  chatWrites = chatWrites
    .then(() => hydrateChats())
    .then(() => {
      const newest = [...chatLists.entries()].sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, CHAT_LISTS_MAX);
      return writeJsonAtomic(chatStorePath(), Object.fromEntries(newest));
    })
    .catch((err) => console.warn(`[chat-tools] not kept: ${err.message}`));
  return chatWrites;
};

/**
 * Impure (the chat's first ask reads the store) — the disclosed ids this turn
 * opens with: an existing chat's own list, or for a new chat the being's
 * working set and anything this connection already found in it.
 * @param {Object} connection
 * @param {Array<Object>} catalog this turn's stamped catalog
 * @param {(tool: Object) => string} idOf
 * @returns {Promise<string[]>}
 */
export const sittingToolIds = async (connection, catalog, idOf) => {
  await hydrateChats();
  const key = chatKey(connection);
  const kept = key ? chatLists.get(key) : null;
  if (kept) {
    const offered = new Map(catalog.filter((tool) => tool.access !== 'denied').map((tool) => [idOf(tool), tool]));
    return kept.ids.filter((id) => offered.has(id));
  }
  return [...rememberedDisclosure(connection, catalog, idOf), ...await workingSetDisclosure(connection, catalog, idOf)];
};

/**
 * Impure — this round's native tools in the chat's own order: the kept ids
 * first, as they rode before; anything new joins at the end, and is kept.
 * @param {Object} connection
 * @param {Array<Object>} tools this round's native tools
 * @param {(tool: Object) => string} idOf
 * @returns {Array<Object>}
 */
export const keepWireOrder = (connection, tools, idOf) => {
  const key = chatKey(connection);
  if (!key) return tools;
  const kept = chatLists.get(key)?.ids || [];
  const byId = new Map(tools.map((tool) => [idOf(tool), tool]));
  const ordered = [...kept.filter((id) => byId.has(id)), ...tools.map(idOf).filter((id) => !kept.includes(id))];
  const grown = ordered.filter((id) => !kept.includes(id));
  if (grown.length > 0 || !chatLists.has(key)) {
    chatLists.set(key, { ids: [...kept, ...grown].slice(-CHAT_LIST_IDS_MAX), at: new Date().toISOString() });
    persistChats();
  }
  return ordered.map((id) => byId.get(id));
};

/**
 * Impure (the kept lists) — the ids this turn discloses natively before any
 * search: the lane's standing tools (a designated CMO opens with its pipeline)
 * plus this chat's own kept list — or, for a new chat, the tools this being
 * reaches for chat after chat. A changed list re-reads the whole chat.
 *
 * A BORROWED lane's habits never ride: a benchmark's platform-only arm sits on
 * a being's lane for its ground, never its self (Design note, 2026-10-14 — so it opens
 * with nothing disclosed but what its own search finds.
 * @param {Object} connection
 * @param {Array<Object>} stamped this turn's catalog
 * @param {(tool: Object) => string} idOf
 * @param {Set<string>|null} standing the lane's standing tool ids
 * @returns {Promise<Set<string>>}
 */
export const turnDisclosure = async (connection, stamped, idOf, standing) => {
  if (connection?._benchmarkControls?.platformOnly === true) return new Set();
  return new Set([
    ...(standing ? stamped.filter((tool) => standing.has(idOf(tool)) && tool.access !== 'denied').map(idOf) : []),
    ...await sittingToolIds(connection, stamped, idOf),
  ]);
};
