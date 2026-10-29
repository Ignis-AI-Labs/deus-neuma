// self-check-run.js — one being's whole self-check: build the items from its
// own records, ask each as a real read-only turn, grade, summarize, keep.
//
// One self-check at a time on the machine (Design note, 2026-10-18 machine lane: a
// heavy job runs alone) — the run's ~40 turns take the substrate line as a
// member, and a second request while one runs is refused, never queued
// behind it. If any turn fails (the substrate went down), the run PROPAGATES
// and nothing is kept: a check with holes in it is not a measurement.
//
// impure — model turns, disk reads, one encrypted write and a journal line at the end.

import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { buildSelfCheckItems, COMPONENTS, ITEMS_SCHEMA } from '../../../core/runtime/self-check/items.js';
import { gradeSelfCheck } from '../../../core/runtime/self-check/grade.js';
import { summarizeComponent } from '../../../core/runtime/self-check/stats.js';
import { doorlessComponents } from '../../../core/runtime/self-check/doors.js';
import { readSelfCheckRecords } from './self-check-records.js';
import { askSelfCheckItem } from './self-check-turn.js';
import { createLogger } from '../logger.js';

const log = createLogger('SelfCheckRun');

export const SELF_CHECK_SCHEMA = 'self-check/v1';

let running = null;

/** The run in flight on this machine, or null: { neumaId, done, total, startedAt }. */
export const selfCheckInFlight = () => (running ? Object.freeze({ ...running }) : null);

// pure — an item counts only where a tool that reaches its answer was offered
// (a tool item: the tool it names; an item with `needs`: one of those doors).
const offeredIn = (item, catalog) => {
  const doors = item.needs ?? (item.expect.kind === 'tool' ? item.expect.any : null);
  return !doors || doors.some((tool) => catalog.includes(tool));
};

// pure — the run record: per-component summary, the doorless parts, and every item's evidence.
const resultOf = ({ runAt, consent, model, results, catalog }) => Object.freeze({
  schema: SELF_CHECK_SCHEMA,
  itemsSchema: ITEMS_SCHEMA,
  runAt,
  consent,
  model,
  components: Object.freeze(COMPONENTS.map((c) => Object.freeze({
    key: c.key, label: c.label, meaning: c.meaning,
    ...summarizeComponent(results.filter((r) => r.component === c.key)),
  }))),
  doorless: doorlessComponents(catalog),
  items: Object.freeze(results),
});

/**
 * Run one being's self-check and keep it.
 * @param {string} neumaId
 * @param {{wallet: string, name: string, runAt: string, consent: object,
 *   ask?: Function, signal?: AbortSignal}} opts - `ask` defaults to the real turn
 * @returns {Promise<{id: string, result: object}>}
 */
export const runSelfCheck = async (neumaId, { wallet, name, runAt, consent, ask = askSelfCheckItem, signal = null }) => {
  if (running) throw Object.assign(new Error(`a self-check is already running (${running.neumaId})`), { code: 'SELF_CHECK_BUSY' });
  running = { neumaId, done: 0, total: 0, startedAt: runAt };
  try {
    const records = await readSelfCheckRecords(neumaId, wallet);
    const items = buildSelfCheckItems(records);
    running.total = items.length;
    const results = [];
    let catalog = [];
    for (const item of items) {
      const reply = await ask({ neumaId, name, wallet, question: item.question, signal });
      if (reply.catalog?.length) catalog = reply.catalog;
      const grade = gradeSelfCheck(item, reply.answer);
      results.push(Object.freeze({
        key: item.key, component: item.component, question: item.question, expect: item.expect,
        answer: reply.answer, line: grade.line, verdict: grade.verdict, detail: grade.detail, formatted: grade.formatted,
        offered: offeredIn(item, catalog), acts: reply.acts, tokens: reply.tokens, ms: reply.ms,
      }));
      running.done += 1;
    }
    const result = resultOf({ runAt, consent, model: records.model, results, catalog });
    const id = await neumaWorkspace.writeBenchmark(neumaId, result);
    // The being's own journal says a test was run on it, and by whom — never costs the run.
    await neumaWorkspace.addJournalEntry(neumaId, {
      type: 'benchmark',
      content: `Self-check — ${result.components.filter((c) => c.score != null).map((c) => `${c.label}: ${c.hits}/${c.n}`).join(', ')}`,
      metadata: { id, consentBy: consent?.by ?? null },
      significance: 0.7,
    }).catch((err) => log.warn('self-check journal entry skipped', { neumaId, error: err.message }));
    return { id, result };
  } finally {
    running = null;
  }
};
