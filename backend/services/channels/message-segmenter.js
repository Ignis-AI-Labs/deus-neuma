// Message segmenter — platform-aware splitting of a neuma's reply (C-01).
//
// Platforms cap message length in UTF-16 code units (Telegram: 4096 — and
// it counts UTF-16, the classic pitfall), so all measuring here uses
// String.prototype.length, which IS UTF-16 units in JS. Split preference:
// paragraph break > line break > sentence end > hard split (never inside a
// surrogate pair). Code fences are kept intact across chunks: a fence left
// open at a split is closed, and reopened at the head of the next chunk,
// so every delivered message renders as the author formatted it. Pure.

const FENCE = /^```(\S*)\s*$/;

/** Where an open code fence stands after scanning `text`. Pure. */
const fenceStateAfter = (text, initial = null) => {
  let open = initial;
  for (const line of text.split('\n')) {
    const m = FENCE.exec(line.trim());
    if (m) open = open === null ? (m[1] || '') : null;
  }
  return open;
};

// Best split index <= max, by preference. Returns max (hard split) when no
// boundary exists — backing off one unit if max lands inside a surrogate pair.
const splitIndex = (text, max) => {
  const window = text.slice(0, max + 1);
  for (const re of [/\n\n(?!.*\n\n)/s, /\n(?!.*\n)/s, /[.!?][^\S\n](?!.*[.!?][^\S\n])/s]) {
    const m = re.exec(window);
    if (m && m.index > 0) return m.index + m[0].length;
  }
  const code = text.charCodeAt(max - 1);
  return code >= 0xd800 && code <= 0xdbff ? max - 1 : max; // never split a pair
};

/**
 * Split `text` into chunks of at most `maxUnits` UTF-16 units each.
 * @param {string} text
 * @param {number} maxUnits - platform cap (adapter.limits.maxMessageUnits)
 * @returns {string[]} at least one chunk for non-empty input; [] for empty
 */
export const segmentText = (text, maxUnits) => {
  if (typeof text !== 'string' || text.length === 0) return [];
  // Floor raised from 8 (echo finding): a cap that cannot hold a fence
  // reopen + close + payload would spin the loop forever. Real platform
  // caps are in the hundreds-to-thousands; 24 already only exists for tests.
  if (!Number.isInteger(maxUnits) || maxUnits < 24) throw new Error('segmentText: maxUnits must be an integer >= 24');
  if (text.length <= maxUnits) return [text];

  const chunks = [];
  let rest = text;
  let openFence = null; // language of the fence left open by the previous chunk
  while (rest.length > 0) {
    const prefix = openFence !== null ? `\`\`\`${openFence}\n` : '';
    const budget = maxUnits - prefix.length - 4; // room to close a fence ("\n```")
    // A pathological language tag can still starve the budget — refuse
    // loudly rather than emit an empty piece and never advance.
    if (budget < 2) throw new Error('segmentText: fence language tag too long for maxUnits');
    if (rest.length + prefix.length <= maxUnits && fenceStateAfter(rest, openFence) === null) {
      chunks.push(prefix + rest);
      break;
    }
    // budget >= 2 makes splitIndex >= 1 even after surrogate backoff —
    // the loop ALWAYS advances (Math.max is belt-and-braces on that proof).
    let piece = rest.slice(0, Math.max(1, splitIndex(rest, budget)));
    const stateAfter = fenceStateAfter(piece, openFence);
    let body = prefix + piece;
    if (stateAfter !== null) body += '\n```'; // close the fence this chunk left open
    chunks.push(body.trimEnd());
    rest = rest.slice(piece.length).replace(/^\n+/, '');
    openFence = stateAfter;
  }
  return chunks.filter((c) => c.length > 0);
};
