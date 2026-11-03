// CITATION RECORD — the shape every citation the legal office relies on must
// take, and the draft discipline around it. Pure.
//
// Why this exists (2026-10-31): an answer from this office came back right in
// its conclusions and wrong in its sourcing — one sentence in quotation marks
// that its source never printed, a statute's words paraphrased inside
// quotation marks, fifteen provisions cited by the wrong number or document,
// and "[verify]" tags shipped to the operator unresolved. The office had been
// told to re-read every passage; telling did not hold. A citation is now a
// record the platform can check (cite-check.js), and a draft cannot carry a
// quotation no checked record holds, or a [verify] nobody resolved.

/** The record, as the office is asked for it. */
export const CITATION_SHAPE = '{claim, authority, pinCite, heading, sourceUrl, standing, quote?, pages?}';

const REQUIRED = Object.freeze({
  claim: 'the point this citation supports, in your words',
  authority: 'what is cited: "15 U.S.C. § 78c", "SEC Rel. No. 34-90112", "Case v. Case, No. … (court)"',
  pinCite: 'where in it: the subsection, article, paragraph or page',
  heading: 'the provision\'s heading or the document\'s title AS THE SOURCE PRINTS IT — read it, never recall it',
  sourceUrl: 'the address you read it at (http/https)',
  standing: 'its status and date: in force / adopted / proposed, never adopted / withdrawn / vacated / pending / dismissed',
});
const FIELD_MAX = 600;
const QUOTE_MAX = 1500;
const RECORDS_MAX = 60;
const QUOTE_MIN_SQUEEZED = 6;
const SPAN_MIN_WORDS = 3;

const ENTITIES = Object.freeze({
  amp: '&', nbsp: ' ', sect: '§', para: '¶', quot: '"', apos: '\'', lt: '<', gt: '>', times: '×',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
});

/** HTML entities a page reader (or a feed) may leave in its text, decoded. Pure. */
export const decodeEntities = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
  if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole;
  const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
  return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
});

/**
 * Letters and digits only, lower case, accents dropped — any script. Words
 * must match; typography (quote marks, dashes, spacing, line-break hyphens,
 * markup gaps) may not decide whether a source says something. Pure.
 */
export const squeeze = (text) => decodeEntities(String(text ?? ''))
  .normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Where a squeezed needle sits in a text: its span in the entity-decoded
 * text, so a reader can be shown the source's own words around it. Pure.
 * @returns {{decoded: string, start: number, end: number}|null}
 */
export const locate = (text, needle) => {
  if (!needle) return null;
  const decoded = decodeEntities(String(text ?? ''));
  let squeezed = '';
  const at = [];
  for (let i = 0; i < decoded.length;) {
    const ch = String.fromCodePoint(decoded.codePointAt(i));
    for (const kept of ch.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')) {
      squeezed += kept;
      at.push(i);
    }
    i += ch.length;
  }
  const k = squeezed.indexOf(needle);
  return k < 0 ? null : { decoded, start: at[k], end: at[k + needle.length - 1] + 1 };
};

/** A quotation's runs between ellipses and bracketed changes ("w[as]"), squeezed. Pure. */
export const quoteSegments = (quote) => String(quote ?? '')
  .split(/\.\s?\.\s?\.|…|\[[^\]]*\]/).map(squeeze).filter(Boolean);

/** Does the squeezed text hold every segment, in order? Pure. */
export const holdsInOrder = (squeezedText, segments) => {
  if (!segments.length) return false;
  let from = 0;
  for (const segment of segments) {
    const at = squeezedText.indexOf(segment, from);
    if (at < 0) return false;
    from = at + segment.length;
  }
  return true;
};

// pure — one record's shape problem, or null.
const recordProblem = (record, n) => {
  if (typeof record === 'string') {
    return `citation ${n} is a string. Every citation is a record the platform can check: ${CITATION_SHAPE}`;
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return `citation ${n} is not a record: ${CITATION_SHAPE}`;
  for (const [field, meaning] of Object.entries(REQUIRED)) {
    const value = record[field];
    if (typeof value !== 'string' || !value.trim()) return `citation ${n} has no ${field} — ${meaning}`;
    if (value.length > FIELD_MAX) return `citation ${n}: ${field} is over ${FIELD_MAX} characters`;
  }
  if (!/^https?:\/\/\S+$/i.test(record.sourceUrl.trim())) return `citation ${n}: sourceUrl must be the http(s) address you read`;
  if (record.quote !== undefined && record.quote !== null) {
    if (typeof record.quote !== 'string' || record.quote.length > QUOTE_MAX) return `citation ${n}: quote is the exact words, at most ${QUOTE_MAX} characters`;
    if (squeeze(record.quote).length < QUOTE_MIN_SQUEEZED) return `citation ${n}: a quote of a word or two proves nothing — quote the sentence, or leave quote out and paraphrase`;
  }
  if (record.pages !== undefined && record.pages !== null && !/^\d+(\s*-\s*\d+)?$/.test(String(record.pages).trim())) {
    return `citation ${n}: pages is a PDF page or range, "24" or "20-30"`;
  }
  return null;
};

/**
 * The records' problem, or null. `required` — at least one record.
 * @param {unknown} list
 * @param {{required?: boolean}} [opts]
 */
export const citationRecordsProblem = (list, { required = false } = {}) => {
  const records = list ?? [];
  if (!Array.isArray(records)) return `citations is a list of records: ${CITATION_SHAPE}`;
  if (required && records.length === 0) {
    return `cite what the reading rests on — citations: [${CITATION_SHAPE}]; the platform re-reads each source before anything lands`;
  }
  if (records.length > RECORDS_MAX) return `at most ${RECORDS_MAX} citations in one filing — split it`;
  return records.map((r, i) => recordProblem(r, i + 1)).find(Boolean) ?? null;
};

// A mark that says the work is not done. It never reaches the operator.
const UNRESOLVED = /\[\s*(?:to\s+)?(?:verify|verified\?|unverified|citation needed|cite|source\?|tbd|todo|check)\b[^\]]*\]/gi;

/** Every unresolved mark in a draft ("[verify]", "[citation needed]", "[TBD]"). Pure. */
export const unresolvedMarks = (text) => [...new Set(String(text ?? '').match(UNRESOLVED) ?? [])];

/**
 * Every span a draft puts in double quotation marks that runs three words or
 * more — a quotation, not a term. Drafted language the office proposes lives
 * in a ``` block, outside this rule. Pure.
 */
export const quotedSpans = (text) => {
  const prose = String(text ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const spans = [...prose.matchAll(/"([^"\n]+)"|“([^”\n]+)”/g)].map((m) => (m[1] ?? m[2]).trim());
  return spans.filter((s) => s.split(/\s+/).filter(Boolean).length >= SPAN_MIN_WORDS);
};

/** The draft's quotations that no record's quote holds. Pure. */
export const unboundQuotes = (text, records) => {
  const quotes = (records ?? []).map((r) => squeeze(r?.quote)).filter(Boolean);
  return quotedSpans(text).filter((span) => !quotes.some((q) => holdsInOrder(q, quoteSegments(span))));
};

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * A draft that may not reach the operator, and why — or null. Pure.
 * @param {string} text the answer, assessment or summary
 * @param {Array<Object>} records its citation records
 */
export const draftProblem = (text, records) => {
  const marks = unresolvedMarks(text);
  if (marks.length) return `the draft still carries ${marks.join(', ')}. An unresolved mark never ships: resolve it from the source, or remove the claim.`;
  const unbound = unboundQuotes(text, records);
  if (unbound.length) {
    return `quotation marks around words no citation record quotes: ${unbound.slice(0, 5).map((s) => `"${clip(s, 90)}"`).join('; ')}. `
      + 'Copy the exact words into that citation\'s quote (the platform will find them in the source), or drop the quotation marks and paraphrase. Language you propose belongs in a ``` block.';
  }
  return null;
};

/** One checked record as a ledger citation line. Pure. */
export const citationLine = (record, checkedAt = null) => [
  `${record.authority.trim()}, ${record.pinCite.trim()} — ${record.heading.trim()} — ${record.sourceUrl.trim()}`,
  ` · ${record.standing.trim()}`,
  checkedAt ? ` · re-read by the platform ${String(checkedAt).slice(0, 10)}` : '',
].join('');
