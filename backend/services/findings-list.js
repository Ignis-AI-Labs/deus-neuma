// findings-list — a being hands its operator a LIST it gathered, formatted so
// a person can actually review it.
//
// Design note, 2026-08-30: […]
//
// WHY THIS IS NOT `sources`. A tool chip already carries the research record —
// every url the being pulled — collapsed behind a `+`. That is EVIDENCE: what
// it looked at, gathered automatically, there to be audited. A findings list is
// the opposite act: what the being CHOSE to hand over, curated, in an order it
// meant, open on arrival because it is the answer rather than the receipt.
// Collapsing one into the other would lose the distinction between […] and […].
//
// REFUSE, NEVER DEFORM — the same law the brand cards keep. A label that would
// overrun its row is refused BY NAME AND NUMBER ("47 of 64") rather than
// silently clipped, because a clipped font name is a font the operator cannot
// look up. The being can shorten it; the renderer must not decide for it.
//
// Pure throughout. The tool wiring and the socket live in the caller.

/**
 * The bounds a row is drawn inside. These are layout facts, not taste: `label`
 * shares a row with `meta`, and `detail` is one wrapped line beneath. Past
 * these the card stops being scannable, which is the only thing it is for.
 */
export const FINDINGS_LIMITS = Object.freeze({
  title: 48,
  note: 120,
  items: 24,
  label: 64,
  detail: 160,
  meta: 32,
  swatches: 8,
  url: 512,
});

/** A colour a swatch may actually paint. Same shape the brand tokens trust. */
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Only http(s) reaches an href. A findings row is a link the operator will
 * click, so `javascript:` and `file:` are refused here, at the door, rather
 * than left for the renderer to notice — the frontend guards too, but a
 * refusal that reaches the BEING is one it can fix; a silently unlinked row
 * just looks broken.
 */
const httpUrlRefusal = (url) => {
  if (url === undefined || url === null || url === '') return null;
  if (typeof url !== 'string') return 'url must be text';
  if (url.length > FINDINGS_LIMITS.url) return `url is ${url.length} characters and the cap is ${FINDINGS_LIMITS.url}`;
  let parsed;
  try { parsed = new URL(url); } catch { return `"${url.slice(0, 60)}" is not a url`; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `"${parsed.protocol}" is not a link the operator can open — http or https only`;
  }
  return null;
};

const tooLong = (what, value, max) => {
  const len = String(value).length;
  // The NUMBER, always. A being told "too long" guesses and tries again; a
  // being told "71 of 64" rewrites the line correctly the first time.
  return len > max ? `${what} is ${len} characters and the cap is ${max}` : null;
};

/**
 * Everything wrong with a findings list, named. Pure.
 * An empty array means it is renderable.
 *
 * @param {Object} list - {title, note?, items[]}
 * @returns {Array<string>}
 */
export const findingsRefusals = (list) => {
  const out = [];
  if (!list || typeof list !== 'object') return ['the findings list is not an object'];

  const title = typeof list.title === 'string' ? list.title.trim() : '';
  if (!title) out.push('a findings list needs a title — what the list IS, e.g. DISPLAY FACES');
  else { const bad = tooLong('title', title, FINDINGS_LIMITS.title); if (bad) out.push(bad); }

  if (list.note) { const bad = tooLong('note', list.note, FINDINGS_LIMITS.note); if (bad) out.push(bad); }

  const items = Array.isArray(list.items) ? list.items : null;
  if (!items) return [...out, 'a findings list needs items — an array of what you found'];
  if (!items.length) out.push('a findings list with no items is not a finding — say so in words instead');
  if (items.length > FINDINGS_LIMITS.items) {
    out.push(`this list has ${items.length} items and the card holds ${FINDINGS_LIMITS.items} — send the best ones, or split the list`);
  }

  items.slice(0, FINDINGS_LIMITS.items).forEach((item, i) => {
    // 1-based: the being wrote a list, and it counts from one.
    const at = `item ${i + 1}`;
    if (!item || typeof item !== 'object') { out.push(`${at} is not an object`); return; }
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!label) out.push(`${at} needs a label — the name of the thing you found`);
    else { const bad = tooLong(`${at} label`, label, FINDINGS_LIMITS.label); if (bad) out.push(bad); }

    for (const [field, max] of [['detail', FINDINGS_LIMITS.detail], ['meta', FINDINGS_LIMITS.meta]]) {
      if (item[field]) { const bad = tooLong(`${at} ${field}`, item[field], max); if (bad) out.push(bad); }
    }

    const urlBad = httpUrlRefusal(item.url);
    if (urlBad) out.push(`${at} ${urlBad}`);

    if (item.swatches !== undefined) {
      if (!Array.isArray(item.swatches)) out.push(`${at} swatches must be a list of hex colours`);
      else {
        if (item.swatches.length > FINDINGS_LIMITS.swatches) {
          out.push(`${at} has ${item.swatches.length} swatches and the row holds ${FINDINGS_LIMITS.swatches}`);
        }
        for (const c of item.swatches) {
          // A bad hex paints nothing and reads as a missing colour, which in a
          // PALETTE is the whole content of the row.
          if (!HEX.test(String(c))) out.push(`${at} swatch "${c}" is not a hex colour like #4f8bff`);
        }
      }
    }
  });
  return out;
};

/**
 * The list as the card will draw it. Pure; assumes `findingsRefusals` passed,
 * and drops nothing it was given — normalising here is trimming and shaping,
 * never truncating, because truncation is what the refusals exist to prevent.
 *
 * @param {Object} list
 * @returns {Object} frozen {title, note, items[], count}
 */
export const normalizeFindings = (list) => {
  const items = (Array.isArray(list?.items) ? list.items : []).map((item) => Object.freeze({
    label: String(item.label).trim(),
    detail: item.detail ? String(item.detail).trim() : null,
    url: item.url ? String(item.url).trim() : null,
    meta: item.meta ? String(item.meta).trim() : null,
    swatches: Array.isArray(item.swatches) && item.swatches.length
      ? Object.freeze(item.swatches.map((c) => String(c)))
      : null,
  }));
  return Object.freeze({
    title: String(list.title).trim(),
    note: list?.note ? String(list.note).trim() : null,
    items: Object.freeze(items),
    count: items.length,
  });
};

/**
 * The one line the chip shows before it is opened, and the line that survives
 * in the being's own transcript. Pure.
 *
 * It names the COUNT, because "shared a list" tells the operator nothing about
 * whether to look now.
 */
export const findingsSummary = (findings) =>
  `${findings.title} — ${findings.count} ${findings.count === 1 ? 'finding' : 'findings'}`;
