// session-display.js — a session record slimmed for the desk to DRAW, not to
// keep. Opening a long chat shipped every thought trace, every tool result,
// every pasted image and a context snapshot per answer; the words were a
// twentieth of it. Here the heavy parts leave and their size stays, so the
// desk can say what is there and fetch it when it is opened
// (GET …/sessions/:id/turns/:turnId).
//
// pure — rows in, rows out; the record on disk is never touched. A row with no
// turnId (from before THE TAKES) passes whole: it has no address to fetch by.

const slimThought = (t) => {
  const { text, ...rest } = t ?? {};
  return typeof text === 'string' && text.length ? { ...rest, chars: text.length, lazy: true } : t;
};

const slimTool = (t) => {
  const { detail, ...rest } = t ?? {};
  return typeof detail === 'string' && detail.length ? { ...rest, detailChars: detail.length, lazy: true } : t;
};

const slimImage = (src) => (typeof src === 'string' && src.startsWith('data:')
  ? { lazy: true, bytes: Math.round((src.length - src.indexOf(',') - 1) * 0.75) }
  : src);

/**
 * pure — one record row as the desk needs it to draw.
 * @param {object} row
 * @returns {object}
 */
export const slimRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  const { composition, ...kept } = row;
  if (typeof row.turnId !== 'string' || !row.turnId) return kept;
  return {
    ...kept,
    ...(Array.isArray(row.thoughts) ? { thoughts: row.thoughts.map(slimThought) } : {}),
    ...(Array.isArray(row.tools) ? { tools: row.tools.map(slimTool) } : {}),
    ...(Array.isArray(row.images) ? { images: row.images.map(slimImage) } : {}),
  };
};

/** pure — a whole session record slimmed for display. */
export const slimForDisplay = (rows) => (Array.isArray(rows) ? rows.map(slimRow) : []);
