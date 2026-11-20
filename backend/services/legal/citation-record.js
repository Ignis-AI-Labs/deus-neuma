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

import { legalSourceProblem } from './source-url.js';

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

// A bracketed change is short. Unbounded, `\[[^\]]*\]` reran from every `[` of a draft that closes none
// (PR600 audit P6-125); a longer bracket is now words the source must print, which is the stricter reading.
const BETWEEN_SEGMENTS = /\.\s?\.\s?\.|…|\[[^\]]{0,200}\]/;

/** A quotation's runs between ellipses and bracketed changes ("w[as]"), squeezed. Pure. */
export const quoteSegments = (quote) => String(quote ?? '')
  .split(BETWEEN_SEGMENTS).map(squeeze).filter(Boolean);

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
  const sourceProblem = legalSourceProblem(record.sourceUrl);
  if (sourceProblem) return `citation ${n}: ${sourceProblem}`;
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

// ONE PASS OVER A DRAFT (PR600 audit P6-125). A filing has no length cap and is read on the backend's
// one thread: `\[verify[^\]]*\]` and `“([^”\n]+)”` reran from every opener of a draft that closes
// none — 128 KB held every lane and wallet route for 13 seconds, and the filing waited to do it again
// at the next sweep. Marks and quotations are now found by their opener and ONE search for their closer.

// A mark that says the work is not done. It never reaches the operator.
const UNRESOLVED_OPEN = /\[\s*(?:to\s+)?(?:verify|verified\?|unverified|citation needed|cite|source\?|tbd|todo|check)\b/gi;

/** Every unresolved mark in a draft ("[verify]", "[citation needed]", "[TBD]"). Pure. */
export const unresolvedMarks = (text) => {
  const draft = String(text ?? '');
  const lastClose = draft.lastIndexOf(']');
  const marks = new Set();
  const open = new RegExp(UNRESOLVED_OPEN.source, UNRESOLVED_OPEN.flags);
  for (let m = open.exec(draft); m && m.index < lastClose; m = open.exec(draft)) {
    const close = draft.indexOf(']', open.lastIndex);
    marks.add(draft.slice(m.index, close + 1));
    open.lastIndex = close + 1;
  }
  return [...marks];
};

// pure — the draft with its code blanked IN PLACE, so every line keeps its number: drafted language
// the office proposes lives in a ``` block or a `span`, outside the quotation rule.
const proseOf = (text) => String(text ?? '')
  .replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '))
  .replace(/`[^`\n]*`/g, (code) => ' '.repeat(code.length));

// pure — what one line puts between double quotation marks, straight or curly, left to right.
const CLOSER = Object.freeze({ '"': '"', '“': '”' });
const quotedIn = (line) => {
  const lastCurly = line.lastIndexOf('”');
  const runs = [];
  for (let i = 0; i < line.length; i += 1) {
    const closer = CLOSER[line[i]];
    if (!closer || (closer === '”' && i >= lastCurly)) continue;
    const close = line.indexOf(closer, i + 1);
    if (close <= i + 1) continue;
    runs.push(line.slice(i + 1, close));
    i = close;
  }
  return runs;
};

/**
 * Every span a draft puts in double quotation marks that runs three words or
 * more — a quotation, not a term — with the draft's own line it sits on. Pure.
 * @returns {Array<{span: string, line: string}>}
 */
export const quotedLines = (text) => {
  const source = String(text ?? '').split('\n');
  return proseOf(text).split('\n')
    .flatMap((line, i) => quotedIn(line).map((run) => ({ span: run.trim(), line: source[i] })))
    .filter(({ span }) => span.split(/\s+/).filter(Boolean).length >= SPAN_MIN_WORDS);
};

/** The quoted spans alone. Pure. */
export const quotedSpans = (text) => quotedLines(text).map(({ span }) => span);

/** The draft's quotations that no record's quote holds, each with its line. Pure. */
export const unboundQuoteLines = (text, records) => {
  const quotes = (records ?? []).map((r) => squeeze(r?.quote)).filter(Boolean);
  return quotedLines(text).filter(({ span }) => {
    const segments = quoteSegments(span);
    return !quotes.some((q) => holdsInOrder(q, segments));
  });
};

/** The draft's quotations that no record's quote holds. Pure. */
export const unboundQuotes = (text, records) => unboundQuoteLines(text, records).map(({ span }) => span);

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
