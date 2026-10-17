// bench-launch-layout-view.js — the two-column LAUNCH tab's view-models,
// PURE. The operator (2026-09-25, on the live tab): […] The redesign picks
// on the left (tier tabs → a short list of benchmarks → the arm tiles) and
// keeps THIS RUN on the right: the subject, the cost as one numeral, the two
// acts, and — once fired — a stage list with the clock. Every string the new
// layout needs beyond bench-launch-view.js lives here.

import { armEstimateMs, armName, tierLegend } from './bench-launch-view.js';

/**
 * The tier tabs: every tier PRESENT in the catalog, in T0→T3 order, with
 * its benchmark count (families — a variant is not another benchmark) and
 * its authored meaning. An unauthored tier still
 * names itself. Pure.
 * @param {object[]} cells the catalog rows
 * @returns {Array<{tier: string, name: string, count: number, line: string, duration: string}>}
 */
export const tierTabs = (cells) => {
  const counts = new Map();
  // A tier counts BENCHMARKS (families), not every variant of one.
  for (const c of cells ?? []) if (!c.variant) counts.set(c.tier, (counts.get(c.tier) ?? 0) + 1);
  const authored = tierLegend().filter((t) => counts.has(t.tier));
  const extra = [...counts.keys()].filter((t) => !tierLegend().some((l) => l.tier === t)).sort()
    .map((tier) => ({ tier, name: String(tier).toUpperCase(), line: '', duration: '' }));
  return [...authored, ...extra].map((t) => ({
    ...t,
    line: t.line ? `${t.line[0].toUpperCase()}${t.line.slice(1)}` : '',
    count: counts.get(t.tier),
  }));
};

/**
 * Which tier tab stands open: the picked benchmark's own tier, else the
 * operator's last tab, else the first tier present. Pure.
 */
export const openTier = (cells, pickedCellId, chosenTier) => {
  const picked = (cells ?? []).find((c) => c.id === pickedCellId);
  if (chosenTier && (cells ?? []).some((c) => c.tier === chosenTier && !c.variant)) return chosenTier;
  // A version opens its FAMILY's tab — a variant may earn a tier above its
  // family (benchmarks e47de3bd), but it is picked under its family's row.
  const family = picked?.variant ? (cells ?? []).find((c) => c.id === picked.family) : picked;
  return family?.tier ?? picked?.tier ?? tierTabs(cells)[0]?.tier ?? null;
};

/**
 * One benchmark as a list row: the name up to its first em dash or comma
 * (the family, e.g. "GSM8K"), the rest as its plain description, then the
 * dimensions and the duration as metadata. Pure.
 * @param {object} cell the catalog projection {id, label, tier, dimensions, cost, arms}
 */
export const benchmarkRow = (cell) => {
  const label = String(cell.label || cell.id);
  const cut = label.search(/ — |, /);
  const name = cut > 0 ? label.slice(0, cut) : label;
  const about = cut > 0 ? label.slice(cut).replace(/^( — |, )/, '') : '';
  const duration = durationOf(cell);
  return {
    id: cell.id,
    name,
    about,
    meta: (cell.dimensions ?? []).join(' · '),
    duration,
    beingOnly: Array.isArray(cell.arms) && cell.arms.length === 1 && cell.arms[0] === 'neuma',
  };
};

/** pure — the duration a cell's declared wallclock reads as: ~45 min · ~1.5 h. */
const durationOf = (cell) => {
  const sec = cell?.cost?.wallclockSec;
  if (!Number.isFinite(sec) || sec <= 0) return '';
  return sec < 3600 ? `~${Math.max(1, Math.round(sec / 60))} min` : `~${Number((sec / 3600).toFixed(1))} h`;
};

/**
 * What sets a variant apart from its family's standard cell, in the
 * harness's own words: the variant label with the base label (or the
 * family's name) stripped off the front; else what follows its first em
 * dash. […] reads
 * […]. Pure.
 */
export const variantLine = (base, variant) => {
  const label = String(variant?.label || variant?.id || '');
  const baseLabel = String(base?.label || '');
  const strip = (prefix) => label.slice(prefix.length).replace(/^\s*(—|,)?\s*/, '');
  if (baseLabel && label.startsWith(baseLabel) && label.length > baseLabel.length) return strip(baseLabel);
  const name = benchmarkRow(base ?? { id: '' }).name;
  if (name && label.startsWith(`${name} `) && !label.startsWith(`${name} — `)) return strip(name);
  const cut = label.indexOf(' — ');
  return cut > 0 ? label.slice(cut + 3) : label;
};

/**
 * THE BENCHMARK LIST — one row per family in the tier (Design note, 2026-09-26: […]). Each row is its standard cell's
 * row plus its versions: the standard first, then every variant in id order,
 * each with what sets it apart — and its own tier when it earned one above
 * the family's (a longer budget can cost a tier; benchmarks e47de3bd). `picked` is the version standing (the family
 * holds the picked cell). Pure.
 * @param {object[]} cells the catalog rows ({family, variant} from the plane)
 * @param {string} tier
 * @param {string} pickedId the form's cell id
 */
export const familyRows = (cells, tier, pickedId) => {
  const inTier = (cells ?? []).filter((c) => c.tier === tier);
  const picked = (cells ?? []).find((c) => c.id === pickedId) ?? null;
  const pickedFamily = picked ? (picked.family ?? picked.id) : null;
  return inTier.filter((c) => !c.variant).map((base) => {
    // Every version of the family, whatever tier it earned: a variant may
    // climb above its family's tier (never below) and then says so.
    const variants = (cells ?? []).filter((c) => c.variant && c.family === base.id).sort((a, b) => a.id.localeCompare(b.id));
    const versions = variants.length ? [base, ...variants].map((c) => ({
      id: c.id,
      line: c === base ? 'Standard — the benchmark as declared' : variantLine(base, c),
      standard: c === base,
      tier: c.tier && c.tier !== base.tier ? String(c.tier).toUpperCase() : null,
      duration: durationOf(c),
      beingOnly: Array.isArray(c.arms) && c.arms.length === 1 && c.arms[0] === 'neuma',
    })) : [];
    const on = pickedFamily === base.id;
    return {
      ...benchmarkRow(base),
      family: base.id,
      on,
      versions,
      pickedVersion: on ? pickedId : null,
    };
  });
};

/**
 * The arms a newly picked benchmark can honestly carry: the current
 * selection kept where the cell offers it, else the cell's first arm. A
 * cell that offers only FULL BEING (Terminal-Bench) must never inherit
 * the default BARE — that selection is invisible and every RUN is refused
 * (found 2026-09-25). Pure.
 * @param {string[]} arms the current selection
 * @param {?object} cell the newly picked cell
 */
export const armsForCell = (arms, cell) => {
  const offered = Array.isArray(cell?.arms) ? cell.arms : null;
  if (!offered || offered.length === 0) return Array.isArray(arms) ? arms : [];
  const kept = (arms ?? []).filter((a) => offered.includes(a));
  return kept.length > 0 ? kept : [offered[0]];
};

const minutesText = (ms) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m >= 60 ? `${Number((m / 60).toFixed(1))} h` : `${m} min`;
};
const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * THIS RUN's cost before the click: the total as one numeral, the finish
 * time if fired now, and each arm's share. Null with nothing to estimate.
 * Pure — the clock arrives as `now`.
 */
export const estimateView = (arms, cell, runRows = [], now = Date.now()) => {
  if (!cell || !Array.isArray(arms) || arms.length === 0) return null;
  const parts = arms.map((arm) => ({ arm, name: armName(arm), ms: armEstimateMs(arm, cell, runRows) }));
  const totalMs = parts.reduce((t, p) => t + p.ms, 0);
  if (totalMs <= 0) return null;
  return {
    total: `~${minutesText(totalMs)}`,
    finish: hhmm(now + totalMs),
    parts: parts.map((p) => ({ ...p, text: `~${minutesText(p.ms)}` })),
  };
};

/**
 * The stage list for a live or settled matched set: one row per arm with
 * its state and a fill. Landed arms fill whole; the running arm fills by
 * its items done over its total when the machine reports them (`live`, from
 * /status), else by its elapsed time over its estimate, held under 95% until
 * it truly lands (an estimate never claims a finish); pending arms stay empty. Pure.
 * @returns {Array<{arm: string, name: string, state: 'done'|'failed'|'live'|'pending'|'skipped', fill: number}>}
 */
export const chainStages = (chain, cell, runRows = [], now = Date.now(), live = []) => {
  if (!chain) return [];
  return chain.arms.map((arm, i) => {
    const outcome = (chain.outcomes ?? []).find((o) => o.arm === arm);
    const name = armName(arm);
    if (outcome?.skipped) return { arm, name, state: 'skipped', fill: 0 };
    if (outcome) return { arm, name, state: outcome.ok ? 'done' : 'failed', fill: 1 };
    if (chain.state === 'running' && i === chain.currentIndex) {
      const run = (live ?? []).find((r) => r.arm === arm && r.cell === chain.cell && Number.isInteger(r.done) && r.total > 0);
      if (run) return { arm, name, state: 'live', fill: Math.min(0.95, run.done / run.total), items: `${run.done}/${run.total}` };
      const est = armEstimateMs(arm, cell, runRows);
      const since = Date.parse(chain.armStartedAt ?? chain.startedAt ?? '');
      const fill = est > 0 && Number.isFinite(since) ? Math.min(0.95, Math.max(0, (now - since) / est)) : 0;
      return { arm, name, state: 'live', fill };
    }
    return { arm, name, state: 'pending', fill: 0 };
  });
};
