// ACT REVIEW — everything a legal filing the house ACTS on must pass before
// it lands (legal/assess, legal/file, legal/opinion; Design note, 2026-10-31, in the
// order of what each costs, stopping at the first failure:
//
//   1. the citation check — the app re-reads every cited source (cite-check.js)
//   2. the recency sweep — the app searches the official feeds for the last
//      120 days, and the filing must answer for every action found
//      (recency-sweep.js)
//   3. the second reader — a separate reader judges whether each passage
//      supports its claim and is the provision cited (second-reader.js)
//
// A hand-off (needs_counsel / needs_operator) is not a reading: it skips the
// sweep and the reader, and its citations, if it gives any, are still checked.

import { runCiteCheck } from './cite-check.js';
import { citationLine } from './citation-record.js';
import { runRecencySweep, sweepVerdict } from './recency-sweep.js';
import { secondRead, readingText } from './second-reader.js';
import { noteVerifiedRecords } from './answer-hold.js';

/**
 * impure — review one filing.
 * @param {{records: Array<Object>, sweep?: Object, account?: string, handOff?: boolean, what: string}} filing
 *   account: the filing's own words that may answer for what the sweep finds (its recency lines and text)
 * @param {{connection: Object}} ctx
 * @returns {Promise<{ok: true, lines: string[], check: Object|null, sweep: Object|null, reading: Object|null, note: string} | {ok: false, reason: string}>}
 */
export const reviewFiling = async ({ records, sweep = null, account = '', handOff = false, what }, { connection }) => {
  const check = records.length ? await runCiteCheck(records, { connection }) : null;
  if (check && !check.ok) return { ok: false, reason: `${what} — the platform's citation check did not pass.\n${check.text}` };
  let swept = null;
  if (!handOff) {
    const result = await runRecencySweep(sweep, { connection });
    if (result.refused) return { ok: false, reason: `${what} — ${result.text}` };
    swept = { ...result, verdict: sweepVerdict(result, account) };
    if (!swept.verdict.ok) return { ok: false, reason: `${what} — the app's recency sweep found actions this filing does not answer for.\n${swept.verdict.text}` };
  }
  let reading = null;
  const verified = check ? check.rows.filter((r) => r.verdict === 'verified') : [];
  if (!handOff && verified.length) {
    reading = await secondRead({ rows: verified, connection });
    if (!reading.ok) return { ok: false, reason: `${what} — the second reader did not pass it.\n${readingText(reading, verified)}` };
  }
  // What landed was checked: the turn's hold counts these records as confirmed (answer-hold.js).
  noteVerifiedRecords(connection, verified.map((r) => r.record));
  const notes = [
    check ? `${check.summary} (${check.checkedAt})` : null,
    swept ? `recency sweep: ${swept.items.length} action(s) found since ${swept.since}, every owed one answered` : null,
    reading ? `second reader (${reading.reader}): ${verified.length} passage(s) read against their claims, none failed` : null,
  ].filter(Boolean);
  return {
    ok: true, check, sweep: swept, reading,
    lines: records.map((r) => citationLine(r, check?.checkedAt ?? null)),
    note: notes.length ? `\n${notes.join('; ')}.` : '',
  };
};
