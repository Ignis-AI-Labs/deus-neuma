// THE RECORD OF EVERY LEAD RUN — kept whole, for good (Design note, 2026-11-21: […]).
//
// A run on the desk is cleared once it is done; its record is not. In the house's revenue office:
//   lead-runs.jsonl        { type: 'started', id, segmentId, segment, want, credits, by, at }
//                          { type: 'run', id, …, counts, spent, ended, startedAt, at }      (the end; written before this file existed too)
//   lead-run-lines.jsonl   { run, at, line }   EVERY line the run said, in order — not the last sixty the desk shows
// What each company was judged, with the words it was judged on, is on the company's own record (prospects.jsonl:
// every score with its reasoning and the quote; candidates.jsonl: every site read and every lookup with what it spent;
// research.jsonl: what each company is). Nothing here is ever rewritten or trimmed.
// impure — disk.
import { officeFile } from '../house-office.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { createWriteChain } from '../write-chain.js';

const serialize = createWriteChain();
const runsFile = (wallet) => officeFile(wallet, 'revenue', 'lead-runs.jsonl');
const linesFile = (wallet) => officeFile(wallet, 'revenue', 'lead-run-lines.jsonl');
const quiet = (work) => serialize(work).catch(() => {}); // a record that will not write never stops a run

export const noteRunStarted = (wallet, run, by) => quiet(() => appendJsonLine(runsFile(wallet), { type: 'started', id: run.id, segmentId: run.segmentId, segment: run.segment, want: run.want, credits: run.credits ?? null, screenOnly: run.screenOnly === true, by, at: run.startedAt }));
export const noteRunLine = (wallet, runId, line, at) => quiet(() => appendJsonLine(linesFile(wallet), { run: runId, at, line }));
export const noteRunEnded = (wallet, run, by) => quiet(() => appendJsonLine(runsFile(wallet), { type: 'run', id: run.id, segmentId: run.segmentId, segment: run.segment, want: run.want, credits: run.credits ?? null, counts: run.counts, spent: run.spent ?? 0, ended: run.ended, by, startedAt: run.startedAt, at: run.endedAt }));

/**
 * Every run on record, newest first: its start, and its end when it reached one (a run cut off by a restart has none).
 * pure.
 * @param {object[]} events
 */
export const foldRuns = (events) => {
  const byId = new Map();
  for (const e of events) {
    if (!e?.id) continue;
    const prior = byId.get(e.id) ?? { id: e.id };
    if (e.type === 'started') byId.set(e.id, { ...prior, segmentId: e.segmentId, segment: e.segment ?? null, want: e.want, credits: e.credits ?? null, by: e.by ?? null, startedAt: e.at });
    else if (e.type === 'run') byId.set(e.id, { ...prior, segmentId: e.segmentId, segment: e.segment ?? prior.segment ?? null, want: e.want, credits: e.credits ?? prior.credits ?? null, by: e.by ?? prior.by ?? null, startedAt: e.startedAt ?? prior.startedAt, endedAt: e.at, ended: e.ended, counts: e.counts ?? null, spent: e.spent ?? null });
  }
  return [...byId.values()].filter((r) => r.startedAt).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
};

/** impure — every run on record, newest first. */
export const readRunHistory = async (wallet) => foldRuns((await readJsonLines(runsFile(wallet))).records);

/** impure — every line one run said, in order. */
export const readRunLines = async (wallet, runId) => (await readJsonLines(linesFile(wallet))).records.filter((l) => l?.run === runId).map((l) => ({ at: l.at, line: l.line }));
