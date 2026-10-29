// queue-thread-view.js — the thread a queued post belongs to, as the desk reads
// it: its root, every follow-up beneath it, and the drafts still awaiting the
// operator. The same law as backend/services/social/queue-thread.js (which the
// browser cannot import); test/unit/queue-thread.test.js holds the two to it.
//
// pure — entries in, the thread out.

/**
 * @param {Map<string, object>} byId - the board's entries by id
 * @param {string} id - any post of the thread
 * @returns {{root: ?object, members: Array<object>, drafts: Array<object>}}
 */
export const threadOf = (byId, id) => {
  let root = byId?.get(id) ?? null;
  for (let hops = 0; root?.kind === 'self-reply' && hops < 500; hops += 1) {
    const parent = byId.get(root.thread?.parentId);
    if (!parent) break;
    root = parent;
  }
  if (!root) return { root: null, members: [], drafts: [] };
  const all = [...byId.values()];
  const members = [root];
  for (let i = 0; i < members.length; i += 1) {
    members.push(...all.filter((e) => e.kind === 'self-reply' && e.thread?.parentId === members[i].id)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
  }
  return { root, members, drafts: members.filter((e) => e.status === 'draft') };
};
