// all-chats-view — every neuma's one-on-ones in one list (deus-neuma #30): each row tagged with
// whose chat it is, newest first by when the chat began (a session id carries its start). Pure.
import { chatRows, filterRows } from './stream-chats-view.js';

const startedAt = (id) => Number(String(id).replace('session-', '')) || 0;

/**
 * @param {Array<{member: {neumaId: string, name?: string}, sessions: ?string[]}>} lists
 * @param {Object<string, string>} labels - "<neumaId>:<sessionId>" → title
 * @returns {Array<object>} chatRows rows plus neumaId and name
 */
export const mergeAllChats = (lists, labels) => (lists || [])
  .flatMap(({ member, sessions }) => chatRows(sessions, labels, member.neumaId, null)
    .map((row) => ({ ...row, neumaId: member.neumaId, name: member.name || member.neumaId })))
  .sort((a, b) => startedAt(b.id) - startedAt(a.id));

/**
 * The rows a search keeps: a title or its neuma's name matching, or a content match from that
 * neuma's own search (matches keyed "<neumaId>:<sessionId>"). Pure.
 * @param {Array<object>} rows
 * @param {string} term
 * @param {Map<string, {excerpt?: string}>} matches
 */
export const searchAllRows = (rows, term, matches) => {
  const q = String(term || '').trim();
  if (!q) return rows;
  const titled = new Set(filterRows(rows, q).map((r) => `${r.neumaId}:${r.id}`));
  const byName = (r) => String(r.name).toLowerCase().includes(q.toLowerCase());
  return rows
    .filter((r) => titled.has(`${r.neumaId}:${r.id}`) || byName(r) || matches.has(`${r.neumaId}:${r.id}`))
    .map((r) => ({ ...r, excerpt: matches.get(`${r.neumaId}:${r.id}`)?.excerpt }));
};
