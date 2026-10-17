/**
 * bench-diagnose-classify — THE RUN DIAGNOSIS, pure half (#557). The operator
 * (2026-09-26): […]
 *
 * A score says how many items an arm missed; this says WHY, item by item,
 * from evidence already on disk — lm-eval's per-sample rows and the proxy's
 * per-request telemetry — and pairs every arm against BARE by doc_hash so a
 * lost item is named, classed and quoted. Nothing here guesses: an item
 * without the evidence for a cause is classed by what the evidence DOES show.
 *
 * All functions are pure; bench-diagnose.js does the reading.
 */

import { createHash } from 'node:crypto';

/** The causes, in the order they are judged. The words are the operator's. */
export const CAUSES = Object.freeze({
  'budget-in-reasoning': 'blank answer — the hidden reasoning spent the whole token budget',
  blank: 'blank answer — no reasoning-budget cut recorded',
  'cut-off': 'answer cut off by the token budget',
  format: 'right answer, wrong format — a lenient metric passes, the headline metric fails',
  unrunnable: 'meant to run as code but does not parse (SyntaxError) — prose or a stray tag rode inside the code',
  'grader-rejected-equal': 'the answer’s final number equals the gold, but the grader’s string match rejected it (e.g. 26.00 vs 26) — a grader miss, not a model miss',
  'broke-instruction': 'answered, but broke one or more of the prompt’s instructions',
  wrong: 'wrong answer',
});

const TAIL_CHARS = 240;

/** pure — "task/metric,filter" → { metric, filter }. */
export const parseMetricId = (id) => {
  const [head, filter = 'none'] = String(id ?? '').split(',');
  return { metric: head.split('/').pop(), filter };
};

/** pure — a metric value as pass/fail: numbers > 0, true, or an all-true list. */
const passes = (value) => {
  if (Array.isArray(value)) return value.length > 0 && value.every(Boolean);
  if (typeof value === 'boolean') return value;
  return Number(value) > 0;
};

/** pure — the gold answer as a person reads it (GSM8K keeps only the #### tail). */
const goldOf = (row) => {
  const target = String(row?.target ?? '');
  if (target.includes('####')) return target.split('####').pop().trim();
  return target.length > 120 ? `${target.slice(0, 117)}…` : target;
};

/** pure — the last TAIL_CHARS of an answer on one line, the part graders read. */
export const tailOf = (text) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > TAIL_CHARS ? `…${flat.slice(-TAIL_CHARS)}` : flat;
};

/**
 * pure — link lm-eval docs to per-request telemetry by answer length (the
 * proxy records contentChars of exactly the text lm-eval received). Equal
 * lengths are consumed in order; a link among equal-length requests whose
 * finish reasons differ is flagged ambiguous rather than trusted.
 * @param {Array<{docId: *, response: string}>} docs
 * @param {?Array<{finishReason: string, contentChars: number, reasoningChars: number, completionTokens: number}>} perRequest
 * @returns {Map<*, ?object>} docId → telemetry entry (with .ambiguous) or null
 */
export const linkTelemetry = (docs, perRequest) => {
  const links = new Map();
  if (!Array.isArray(perRequest)) {
    for (const d of docs) links.set(d.docId, null);
    return links;
  }
  // Exact link when the proxy recorded contentSha256 (harness f9d8c93e+);
  // older receipts fall back to answer length.
  const byHash = perRequest.some((e) => typeof e.contentSha256 === 'string');
  const keyOfDoc = (d) => (byHash ? createHash('sha256').update(d.response, 'utf8').digest('hex') : d.response.length);
  const buckets = new Map();
  for (const entry of perRequest) {
    const key = byHash ? entry.contentSha256 : entry.contentChars;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(entry);
  }
  for (const d of docs) {
    const bucket = buckets.get(keyOfDoc(d)) ?? [];
    const reasons = new Set(bucket.map((e) => e.finishReason));
    const entry = bucket.shift() ?? null;
    links.set(d.docId, entry ? { ...entry, ambiguous: reasons.size > 1, linkedBy: byHash ? 'hash' : 'length' } : null);
  }
  return links;
};

/**
 * pure — one arm's lm-eval sample rows folded to one record per doc.
 * @param {Array<object>} rows the samples_*.jsonl rows (one per doc per filter)
 * @param {string} headlineId the receipt's first primary metric id
 */
export const foldDocs = (rows, headlineId) => {
  const headline = parseMetricId(headlineId);
  const byDoc = new Map();
  for (const row of rows) {
    if (!byDoc.has(row.doc_id)) byDoc.set(row.doc_id, []);
    byDoc.get(row.doc_id).push(row);
  }
  return [...byDoc.entries()].map(([docId, docRows]) => {
    const head = docRows.find((r) => r.filter === headline.filter) ?? docRows[0];
    const lenient = docRows.some((r) => (r.metrics ?? []).some((m) =>
      !(r === head && m === headline.metric) && passes(r[m])));
    const ids = head?.doc?.instruction_id_list;
    const inst = head?.[headline.metric.replace('prompt_level', 'inst_level')];
    const brokenInstructions = Array.isArray(ids) && Array.isArray(inst)
      ? ids.filter((_, i) => !inst[i]) : [];
    return {
      docId,
      docHash: head?.doc_hash ?? null,
      response: String(head?.resps?.[0]?.[0] ?? ''),
      pass: passes(head?.[headline.metric]),
      lenient,
      gold: goldOf(head),
      // Only an exact-match grader compares a number to a number; IFEval's
      // target is a placeholder '0', never an answer.
      numericGraded: headline.metric === 'exact_match' && !Array.isArray(ids),
      brokenInstructions,
    };
  });
};

/** pure — the last number written in a text, currency/commas stripped; null when none. */
export const lastNumber = (text) => {
  const found = String(text ?? '').replace(/(\d),(?=\d{3}\b)/g, '$1').match(/-?\d+(?:\.\d+)?/g);
  return found ? Number(found[found.length - 1]) : null;
};

/** pure — the cause of one missed item, judged in CAUSES order. */
export const causeOf = (doc, telemetry) => {
  if (doc.pass) return null;
  const blank = doc.response.trim() === '';
  if (blank) return telemetry?.finishReason === 'length' ? 'budget-in-reasoning' : 'blank';
  if (telemetry?.finishReason === 'length') return 'cut-off';
  if (doc.lenient) return 'format';
  const gold = Number(doc.gold);
  if (doc.numericGraded && doc.gold !== '' && Number.isFinite(gold) && lastNumber(doc.response) === gold) return 'grader-rejected-equal';
  if (doc.brokenInstructions.length > 0) return 'broke-instruction';
  return 'wrong';
};

/**
 * pure — diagnose one arm: every doc with its cause and evidence.
 * @param {{arm: string, runId: string, headlineId: string, rows: Array, perRequest: ?Array}} input
 */
export const diagnoseArm = ({ arm, runId, headlineId, rows, perRequest }) => {
  const docs = foldDocs(rows, headlineId);
  const links = linkTelemetry(docs, perRequest);
  const items = docs.map((d) => {
    const t = links.get(d.docId);
    return {
      docId: d.docId,
      docHash: d.docHash,
      cause: causeOf(d, t),
      gold: d.gold,
      answerTail: tailOf(d.response),
      brokenInstructions: d.brokenInstructions,
      telemetry: t ? {
        finishReason: t.finishReason, contentChars: t.contentChars, reasoningChars: t.reasoningChars,
        completionTokens: t.completionTokens, ambiguous: t.ambiguous,
      } : null,
    };
  });
  const causes = {};
  for (const it of items) if (it.cause) causes[it.cause] = (causes[it.cause] ?? 0) + 1;
  return {
    arm, runId, headlineId,
    total: items.length,
    passed: items.filter((i) => !i.cause).length,
    causes,
    telemetry: !Array.isArray(perRequest) ? 'none'
      : (perRequest.some((e) => typeof e.contentSha256 === 'string') ? 'per-request (hash-linked)' : 'per-request (length-linked)'),
    items,
  };
};

/**
 * pure — pair each arm against BARE by doc_hash: what it LOST (BARE passed,
 * it missed — by cause) and what it GAINED (BARE missed, it passed).
 * @param {Array<object>} arms diagnoseArm results
 */
export const pairAgainstBare = (arms) => {
  const bare = arms.find((a) => a.arm === 'bare');
  if (!bare) return [];
  const bareByHash = new Map(bare.items.map((i) => [i.docHash, i]));
  return arms.filter((a) => a.arm !== 'bare').map((a) => {
    const lost = a.items.filter((i) => i.cause && bareByHash.get(i.docHash) && !bareByHash.get(i.docHash).cause);
    const gained = a.items.filter((i) => !i.cause && bareByHash.get(i.docHash)?.cause);
    const lostBy = {};
    for (const i of lost) lostBy[i.cause] = (lostBy[i.cause] ?? 0) + 1;
    // How many of this arm's items BARE also answered — the only ones lost/gained can speak for.
    const shared = a.items.filter((i) => bareByHash.has(i.docHash)).length;
    return { arm: a.arm, lost: lost.length, lostBy, gained: gained.length, gainedFrom: gained.map((i) => bareByHash.get(i.docHash).cause), shared, total: a.items.length };
  });
};

/**
 * pure — WHOSE MISS. Design note, 2026-10-03: […]
 * Every agent-arm miss gets one verdict:
 *   model    — BARE missed it too: the base model's reasoning or knowledge (training)
 *   harness  — BARE answered it: the agent layer lost it (its cause says how)
 *   identity — the full being missed what the HARNESS answered: identity cost it
 * Items BARE never answered stay unjudged.
 * @param {Array<object>} arms diagnosed arms (items keyed by docHash)
 */
export const verdictsOf = (arms) => {
  const byArm = new Map(arms.map((a) => [a.arm, new Map(a.items.map((i) => [i.docHash, i]))]));
  const bare = byArm.get('bare');
  if (!bare) return [];
  const harness = byArm.get('harness');
  return arms.filter((a) => a.arm !== 'bare').map((a) => {
    const v = { model: 0, harness: 0, identity: 0, unjudged: 0 };
    const harnessBy = {};
    for (const i of a.items) {
      if (!i.cause) continue;
      const b = bare.get(i.docHash);
      if (!b) { v.unjudged += 1; continue; }
      const h = harness?.get(i.docHash);
      if (a.arm === 'neuma' && h && !h.cause) { v.identity += 1; continue; }
      if (b.cause) { v.model += 1; continue; }
      v.harness += 1;
      harnessBy[i.cause] = (harnessBy[i.cause] ?? 0) + 1;
    }
    return { arm: a.arm, ...v, harnessBy };
  });
};

/** pure — one plain sentence per agent arm: whose its misses were. */
export const verdictFindingsOf = (verdicts) => verdicts
  .filter((v) => v.model + v.harness + v.identity > 0)
  .map((v) => {
    const how = Object.entries(v.harnessBy).map(([c, n]) => `${n} ${c}`).join(', ');
    return `${v.arm.toUpperCase()} misses by owner: model ${v.model} (BARE missed them too — reasoning or knowledge), `
      + `harness ${v.harness}${how ? ` (${how})` : ''} (BARE answered them — the agent layer lost them)`
      + `${v.arm === 'neuma' ? `, identity ${v.identity} (the HARNESS answered them)` : ''}.`;
  });

/** pure — plain-language findings: the dominant cause per arm, stated with its count. */
export const findingsOf = (arms, paired) => arms.flatMap((a) => {
  const missed = a.total - a.passed;
  if (missed === 0) return [`${a.arm.toUpperCase()}: no misses (${a.passed}/${a.total}).`];
  const [top, count] = Object.entries(a.causes).sort((x, y) => y[1] - x[1])[0];
  const pair = paired.find((p) => p.arm === a.arm);
  const vsBare = pair ? ` Against BARE it lost ${pair.lost} item(s)${pair.lost ? ` (${Object.entries(pair.lostBy).map(([c, n]) => `${n} ${c}`).join(', ')})` : ''} and gained ${pair.gained}.` : '';
  const blind = a.telemetry === 'none'
    ? ' This arm records no per-request telemetry, so budget cuts (blank or cut-off answers) are invisible and read as blank or wrong.' : '';
  return [`${a.arm.toUpperCase()}: ${missed} miss(es) of ${a.total}; most are ${top} (${count}) — ${CAUSES[top]}.${vsBare}${blind}`];
});

const TRAIL_LIST_MAX = 20;
const WEB_TOOL = /(^|\/)web[_/]|fetch|search|browse/i;
const WRITE_TOOL = /write|edit|create|delete|move|rename|mkdir/i;

/**
 * pure — WHAT THE BEING TOUCHED (#564): one arm's agent receipts folded to an
 * audit summary — calls by tool, every web target, every write target. The
 * trail records, never judges: whether a target was an answer key is read by
 * a person. Receipts older than the trail carry only a count, and say so.
 * @param {Array<{toolCalls?: number, toolTrail?: Array<{tool: string, target: ?string, status: ?string}>}>} receipts
 */
export const summarizeToolTrail = (receipts) => {
  const list = Array.isArray(receipts) ? receipts : [];
  const recorded = list.length > 0 && list.every((r) => Array.isArray(r.toolTrail));
  const entries = list.flatMap((r) => (Array.isArray(r.toolTrail) ? r.toolTrail : []));
  const byTool = {};
  for (const e of entries) byTool[e.tool] = (byTool[e.tool] ?? 0) + 1;
  const targetsOf = (re) => [...new Set(entries.filter((e) => re.test(e.tool) && e.target).map((e) => e.target))];
  const web = targetsOf(WEB_TOOL);
  const writes = targetsOf(WRITE_TOOL);
  return {
    recorded,
    answers: list.length,
    calls: recorded ? entries.length : list.reduce((n, r) => n + (Number(r.toolCalls) || 0), 0),
    answersWithTools: list.filter((r) => (Array.isArray(r.toolTrail) ? r.toolTrail.length : Number(r.toolCalls) || 0) > 0).length,
    byTool,
    webTargets: web.slice(0, TRAIL_LIST_MAX),
    webTargetsMore: Math.max(0, web.length - TRAIL_LIST_MAX),
    writeTargets: writes.slice(0, TRAIL_LIST_MAX),
    writeTargetsMore: Math.max(0, writes.length - TRAIL_LIST_MAX),
    failed: entries.filter((e) => e.status && e.status !== 'ok' && e.status !== 'held').length,
  };
};
