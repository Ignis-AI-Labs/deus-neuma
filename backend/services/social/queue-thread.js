/**
 * THE THREAD AS ONE DECISION — a thread is its root post and every self-reply
 * that hangs from it; the operator approves it once, not post by post. The
 * scheduler's own law still orders the sending (a follow-up speaks only after
 * its parent published — post-scheduler.js), so approving the whole thread
 * arms it, it never fires it out of order.
 *
 * pure — entries in, entries changed in place (the caller holds the store's
 * lock and saves), or a refusal that changes nothing.
 */
import { queuedSecretRefusal } from './queue-rules.js';

const DEAD = Object.freeze(['rejected', 'withdrawn', 'failed']);

/** pure — the root of the thread `id` belongs to (itself when it is no follow-up). */
export const threadRootOf = (entries, id) => {
  const byId = new Map(entries.map((e) => [e.id, e]));
  let at = byId.get(id) ?? null;
  for (let hops = 0; at?.kind === 'self-reply' && hops < 500; hops += 1) {
    const parent = byId.get(at.thread?.parentId);
    if (!parent) break;
    at = parent;
  }
  return at;
};

/** pure — the root and every follow-up beneath it, root first, each before its own follow-ups. */
export const threadMembers = (entries, rootId) => {
  const root = entries.find((e) => e.id === rootId);
  if (!root) return [];
  const out = [root];
  for (let i = 0; i < out.length; i += 1) {
    const children = entries.filter((e) => e.kind === 'self-reply' && e.thread?.parentId === out[i].id)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    out.push(...children);
  }
  return out;
};

/**
 * pure — approve every draft of the thread `id` belongs to, all or nothing.
 * Every draft must have been SEEN as it stands (textsSeen[id] === its text) —
 * the same guard a reply's approval carries — and pass the outbound-secret
 * check; a thread whose root can never publish is refused.
 * @param {Array<object>} entries - the whole store (mutated on success)
 * @param {string} id - any post of the thread
 * @param {{decidedBy: string, textsSeen: Record<string, string>, now: Date}} decision
 * @returns {{approved: Array<object>} | {error: string}}
 */
export const approveThreadIn = (entries, id, { decidedBy, textsSeen = {}, now }) => {
  const root = threadRootOf(entries, id);
  if (!root) return { error: 'no such queued post' };
  if (root.kind === 'reply') return { error: 'a reply is no thread — it is decided through its own approval' };
  if (DEAD.includes(root.status)) return { error: `the thread's first post is ${root.status} — the thread can never publish` };
  const members = threadMembers(entries, root.id);
  const drafts = members.filter((e) => e.status === 'draft');
  if (drafts.length === 0) return { error: 'nothing in this thread awaits approval' };
  for (const [n, e] of members.entries()) {
    if (e.status !== 'draft') continue;
    if (textsSeen[e.id] !== e.text) return { error: `post ${n + 1} of the thread changed since you read it — nothing was approved; read it again` };
    const secret = queuedSecretRefusal(e, 'nothing in the thread was approved');
    if (secret) return { error: `post ${n + 1}: ${secret}` };
  }
  for (const e of drafts) {
    e.status = 'approved';
    e.decidedBy = String(decidedBy || '');
    e.decidedAt = now.toISOString();
  }
  return { approved: drafts };
};
