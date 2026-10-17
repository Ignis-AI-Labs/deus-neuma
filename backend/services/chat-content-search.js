/** Search stored speech locally; no inference or second plaintext index. */
import workspace from '../../core/workspace/neuma-workspace.js';
import { foldBranchView } from '../../core/workspace/branch-view.js';
import { stripToolBlocks } from '../../core/runtime/tool-stream-suppressor.js';

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

/** Pure — first matching visible message, with a bounded literal excerpt. */
export const findChatExcerpt = (records, query) => {
  const needle = normalize(query).toLowerCase();
  if (!needle) return null;
  for (const row of foldBranchView(records).toReversed()) {
    if (!['user', 'assistant'].includes(row.role) || typeof row.content !== 'string') continue;
    const text = normalize(row.role === 'assistant' ? stripToolBlocks(row.content) : row.content);
    const index = text.toLowerCase().indexOf(needle);
    if (index < 0) continue;
    const start = Math.max(0, index - 65);
    const end = Math.min(text.length, index + needle.length + 105);
    return { role: row.role, excerpt: `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}` };
  }
  return null;
};

/** impure — one session at a time, including compacted speech in its archive. */
export const searchChatContents = async (neumaId, query, signal) => {
  if (!query.trim()) return [];
  const matches = [];
  for (const id of await workspace.listSessions(neumaId)) {
    signal?.throwIfAborted();
    if (id.startsWith('council-')) continue;
    const records = await workspace.readSessionStrict(neumaId, id);
    let match = findChatExcerpt(records, query);
    if (!match) {
      const ordinals = await workspace.listArchiveSegments(neumaId, id, { strict: true });
      for (const ordinal of ordinals.toReversed()) {
        signal?.throwIfAborted();
        const segment = await workspace.readArchiveSegment(neumaId, id, ordinal);
        match = findChatExcerpt([...segment.messages, ...records.filter((row) => row.branchView)], query);
        if (match) break;
      }
    }
    if (match) matches.push({ id, ...match });
  }
  return matches;
};
