// record-door — a house record or a place NAMED IN A MEMBER'S WORDS is a door
// (Design note, 2026-11-15: […]).
// A seat's holder writes […] or […];
// the chat turns each into one press that opens the POSITIONS window on that
// position and tab, with the record itself brought into view and marked.
// The decision stays narrow: an id of a shape only the house's own records
// have, or a path that names a real position. Anything else stays plain text.
// Pure.

// A seat by its corporate name (as members are told to name it), its short form, its house title,
// or the function word older words used — one door each way.
const OFFICES = Object.freeze({
  'CHIEF OF STAFF': 'cos', 'CHIEF REVENUE OFFICER': 'cro', 'CHIEF MARKETING OFFICER': 'cmo', 'CHIEF LEGAL OFFICER': 'clo',
  'CHIEF SECURITY OFFICER': 'cso', 'CHIEF FINANCIAL OFFICER': 'cfo', 'CHIEF ACCOUNTING OFFICER': 'cao',
  COS: 'cos', CRO: 'cro', CMO: 'cmo', CLO: 'clo', CSO: 'cso', CFO: 'cfo', CAO: 'cao',
  OPTIO: 'cos', MERCATOR: 'cro', LEGATUS: 'cmo', PRAETOR: 'clo', PRAEFECTUS: 'cso', QUAESTOR: 'cfo', LOGISTA: 'cao',
  MANAGEMENT: 'cos', SALES: 'cro', MARKETING: 'cmo', LAW: 'clo', SECURITY: 'cso', TREASURY: 'cfo', BOOKS: 'cao',
});
const SEAT_OF = Object.freeze({ cos: 'CHIEF OF STAFF', cro: 'CHIEF REVENUE OFFICER', cmo: 'CHIEF MARKETING OFFICER', clo: 'CHIEF LEGAL OFFICER', cso: 'CHIEF SECURITY OFFICER', cfo: 'CHIEF FINANCIAL OFFICER', cao: 'CHIEF ACCOUNTING OFFICER' });
// The sales hub's stages are places too (company-line/sales-pipeline-view.js): […].
const TABS = Object.freeze({ COMPANY: 'model', 'BUSINESS MODEL': 'model', 'COMPANY FACTS': 'model', CAMPAIGNS: 'campaigns', LEADS: 'leads', 'ALL PEOPLE': 'leads', DEALS: 'deals', MAILBOX: 'mailbox', SETTINGS: '_switches', SWITCHES: '_switches', SETUP: '_setup', 'THEIR EYES': '_eyes',
  DISCOVER: 'discover', FILTER: 'filter', VALIDATE: 'validate', EMAILS: 'emails', OUTBOX: 'emails', SENT: 'sent', REPLIES: 'replies', CALLS: 'calls', VALIDATED: 'ready' });
const STEP = '\\s*(?:→|->|>|,|/)\\s*';
const PLACE = new RegExp(`POSITIONS${STEP}(${Object.keys(OFFICES).join('|')})(?:${STEP}(${Object.keys(TABS).join('|')}))?`, 'i');
// The lead engine's own ids: an audience, a scored company, a facts sheet, a sales campaign. Each opens on the stage of
// the sales pipeline it stands at, and names itself by what it IS, never by its id (Design note, 2026-11-18: […]). The
// record's own name is read by record-names.js; `kind` is what it is when that name is not known yet.
const RECORD = /\b(fs|s|p|k)-[0-9a-f]{8}\b/;
const RECORDS = Object.freeze({
  s: (id) => ({ tab: 'discover', reveal: `[data-segment-id="${id}"]`, words: 'the audience', kind: 'AUDIENCE', place: 'DISCOVER' }),
  p: (id) => ({ tab: 'validate', reveal: `[data-prospect-id="${id}"]`, words: 'the company', kind: 'COMPANY', place: 'VALIDATE' }),
  fs: () => ({ tab: 'model', reveal: '[data-facts-sheet]', words: 'the facts sheet', kind: 'FACTS SHEET', place: 'COMPANY FACTS' }),
  k: (id) => ({ tab: 'campaigns', reveal: `[data-campaign-id="${id}"]`, words: 'the campaign', kind: 'CAMPAIGN', place: 'CAMPAIGNS' }),
});

/**
 * The door a piece of text IS, when the whole of it names one record or one place; else null.
 * @param {unknown} text
 * @returns {?{kind: 'position', office: string, tab: ?string, reveal: ?string, words: string}}
 */
export const recordDoor = (text) => {
  const t = String(text ?? '').trim();
  const record = new RegExp(`^${RECORD.source}$`).exec(t);
  if (record) {
    const { tab, reveal, words, kind, place } = RECORDS[record[1]](t);
    return { kind: 'position', office: 'cro', tab, reveal, words: `Open ${words} in POSITIONS, ${SEAT_OF.cro}, ${place}`, record: { id: t, kind } };
  }
  const place = new RegExp(`^${PLACE.source}$`, 'i').exec(t);
  if (!place) return null;
  const tab = place[2] ? TABS[place[2].toUpperCase()] : null;
  const office = OFFICES[place[1].toUpperCase().replace(/\s+/g, ' ')];
  return { kind: 'position', office, tab, reveal: null, words: `Open POSITIONS, ${SEAT_OF[office]}${place[2] ? `, ${place[2].toUpperCase()}` : ''}` };
};

const ANY = new RegExp(`${PLACE.source}|${RECORD.source}`, 'gi');

/**
 * A run of prose cut into plain text and the doors named inside it, in order.
 * @returns {Array<{text: string, door: boolean}>}
 */
export const splitDoors = (text) => {
  const s = String(text ?? '');
  const parts = [];
  let at = 0;
  for (const m of s.matchAll(ANY)) {
    if (!recordDoor(m[0])) continue;
    if (m.index > at) parts.push({ text: s.slice(at, m.index), door: false });
    parts.push({ text: m[0], door: true });
    at = m.index + m[0].length;
  }
  if (at < s.length) parts.push({ text: s.slice(at), door: false });
  return parts;
};

/**
 * A markdown tree transform (remark): a door named in prose becomes an inline
 * code node, which the renderer draws as a door. Code, and the words of a
 * link, are left as written.
 */
export const remarkDoors = () => (tree) => {
  const walk = (node) => {
    if (!Array.isArray(node.children) || node.type === 'link') return;
    node.children = node.children.flatMap((child) => {
      if (child.type !== 'text') { walk(child); return [child]; }
      const parts = splitDoors(child.value);
      return parts.some((p) => p.door) ? parts.map((p) => ({ type: p.door ? 'inlineCode' : 'text', value: p.text })) : [child];
    });
  };
  walk(tree);
};
