// Pure vault search — a being finding its own pages by word. Case-insensitive
// substring matching over title + body; strings in, matches out, no IO
// anywhere in this module (the gather lives in NeumaWorkspace.searchVaultNotes).

const SNIPPET_MAX = 160;

// A window of `text` at most SNIPPET_MAX chars (ellipsis marks included),
// centered on the hit at `index` when the text runs longer than the window.
const snippetAround = (text, index, hitLength) => {
  if (text.length <= SNIPPET_MAX) return text.replace(/\s+/g, ' ').trim();
  const lead = Math.max(0, Math.floor((SNIPPET_MAX - hitLength) / 2));
  const start = Math.max(0, Math.min(index - lead, text.length - SNIPPET_MAX));
  const prefix = start > 0 ? '…' : '';
  const suffix = start + SNIPPET_MAX < text.length ? '…' : '';
  const width = SNIPPET_MAX - prefix.length - suffix.length;
  const window = text.slice(start, start + width).replace(/\s+/g, ' ').trim();
  return `${prefix}${window}${suffix}`;
};

/**
 * Match vault notes against a query. Case-insensitive substring over each
 * note's title and body; a note hits when either contains the query. The
 * snippet (≤160 chars) is centered on the first hit — title first, then body.
 * @param {Array<{slug: string, title: string, body: string}>} notes
 * @param {string} query - blank/empty queries refuse loudly, never match-all
 * @returns {Array<{slug: string, title: string, snippet: string}>} in input order
 */
export function matchVaultNotes(notes, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) throw new Error('matchVaultNotes: a query is required');
  const hits = [];
  for (const note of notes || []) {
    const title = String(note?.title || '');
    const body = String(note?.body || '');
    const titleIdx = title.toLowerCase().indexOf(needle);
    const bodyIdx = body.toLowerCase().indexOf(needle);
    if (titleIdx === -1 && bodyIdx === -1) continue;
    hits.push({
      slug: note.slug,
      title,
      snippet: titleIdx !== -1
        ? snippetAround(title, titleIdx, needle.length)
        : snippetAround(body, bodyIdx, needle.length),
    });
  }
  return hits;
}
