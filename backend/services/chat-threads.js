// chat-threads — which chat a sub-chat was spawned from.
//
// Design note, 2026-11-16, looking at a chat list full of unnamed rows: […]
//
// A being that splits into shadow clones (shadow-clone.js) gives each clone a sitting of its own,
// and a sitting is a chat: it landed in the chat list as one more top-level row, named only by its
// time, with nothing saying where it came from. Here each such sitting is written down with the
// chat that spawned it, the moment it is known:
//   <lane>/chat-threads.jsonl    { child, parent, kind, title, at }   one line a sub-chat
// The chat list reads it and files each sub-chat under its parent (stream-chats-view.js). The
// record is the being's own lane, beside its sessions; a chat with no line is an ordinary chat.
// The fold is PURE; the read and write are impure.

import path from 'node:path';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { appendJsonLine, readJsonLines } from './jsonl-append.js';

const FILE = 'chat-threads.jsonl';
const SESSION = /^session-\d{6,}$/;
const fileOf = (neumaId) => path.join(neumaWorkspace.pathFor(neumaId), FILE);

/** pure — the links as { child: { parent, kind, title, at } }; a chat is never its own parent, and the first line for a child stands. */
export const foldThreads = (records) => {
  const threads = {};
  for (const r of records) {
    if (!SESSION.test(String(r?.child)) || !SESSION.test(String(r?.parent)) || r.child === r.parent || threads[r.child]) continue;
    threads[r.child] = { parent: r.parent, kind: String(r.kind ?? 'sub'), title: String(r.title ?? '').slice(0, 120), at: r.at ?? null };
  }
  return threads;
};

/** impure — every sub-chat of one being, by child. Missing file: none. */
export const readThreads = async (neumaId) => foldThreads((await readJsonLines(fileOf(neumaId)).catch(() => ({ records: [] }))).records);

/**
 * impure — write down that `child` was spawned from `parent`. Never throws: a sub-chat that could not be
 * filed is still a chat, only an unthreaded one.
 * @param {string} neumaId
 * @param {{child: string, parent: ?string, kind: string, title?: string}} link
 */
export const noteSubChat = async (neumaId, { child, parent, kind, title = '' }) => {
  try {
    if (!SESSION.test(String(child)) || !SESSION.test(String(parent)) || child === parent) return false;
    await appendJsonLine(fileOf(neumaId), { child, parent, kind, title: String(title).slice(0, 120), at: new Date().toISOString() });
    return true;
  } catch {
    return false;
  }
};
