// machine-health.js — the machine's state in one read: each part (GPU, CPU,
// memory, storage, board, power) as one level — OK, WARM, HOT or FAULT — with
// the one number that decides it, so the operator learns the state before
// reading anything else (JŌHŌ SEKKEI: overview first).
//
// Every level stands on the part's OWN marks (SHINKEI): a temperature against
// its chip's high and critical marks, the GPU against the driver's stated max
// operating and slowdown temperatures, a rail against the published ATX
// tolerance. The only number written here is where WARM begins: within 10% of
// a reading's own high mark.
//
// pure — readings in, levels out.

import { ATX_TOLERANCE, boardRows, cpuView, dimmRows, driveRows, railView } from './machine-view.js';

/** WARM begins at this share of a reading's own high mark. */
export const WARM_SHARE = 0.9;
const RANK = Object.freeze({ unknown: -1, ok: 0, warm: 1, hot: 2, fault: 3 });

/** pure — one value against its own marks: past crit FAULT, past high HOT, within 10% of high WARM. */
export const heatLevel = (value, high, crit) => {
  if (!Number.isFinite(value)) return 'unknown';
  if (crit > 0 && value >= crit) return 'fault';
  if (high > 0 && value >= high) return 'hot';
  if (high > 0 && value >= high * WARM_SHARE) return 'warm';
  return 'ok';
};

/** pure — the worse of two levels. */
export const worse = (a, b) => (RANK[b] > RANK[a] ? b : a);

const nearness = (r) => (r.high > 0 ? r.value / r.high : 0);
const t0 = (v) => (Number.isFinite(v) ? Math.round(v) : null);

/**
 * pure — the row that decides a group: the worst level, then a named sensor
 * before an input the chip leaves unlabelled, then the nearest its own high
 * mark, then the hottest. Rows carry {name, value, high, crit, unlabelled?}.
 */
export const decidingRow = (rows) => rows
  .map((r) => ({ ...r, level: heatLevel(r.value, r.high, r.crit) }))
  .sort((a, b) => RANK[b.level] - RANK[a.level] || Number(Boolean(a.unlabelled)) - Number(Boolean(b.unlabelled))
    || nearness(b) - nearness(a) || b.value - a.value)[0] ?? null;

// `panel`: the console panel the part is read in (the rails live in the board's).
const cell = (part, label, level, value, unit, what) => Object.freeze({ part, panel: part === 'power' ? 'board' : part, label, level, value, unit, what });

/** pure — a group of temperatures as one cell; `count` names how many sit at the deciding level or worse. */
const heatCell = (part, label, rows) => {
  const top = decidingRow(rows);
  if (!top) return cell(part, label, 'unknown', null, '°', 'no reading');
  const alike = rows.filter((r) => RANK[heatLevel(r.value, r.high, r.crit)] >= RANK[top.level]).length;
  const mark = top.level === 'fault' ? top.crit : top.high;
  const more = top.level !== 'ok' && alike > 1 ? ` +${alike - 1} more` : '';
  return cell(part, label, top.level, t0(top.value), '°', `${top.name}${more}${mark ? ` · ${top.level === 'fault' ? 'crit' : 'high'} ${t0(mark)}°` : ''}`);
};

/** pure — a level as the instruments' tone: settled reads live, warm alert-dim, hot and fault alert. */
export const levelTone = (level) => ({ warm: 'warm', hot: 'hot', fault: 'crit' }[level] ?? 'live');

/** Clock-limit reasons that mean the GPU is being held back by heat or the board, not by its own normal caps. */
const GPU_FAULT_REASONS = /thermal|hw slowdown|power brake/i;
// Reliability is the GPU's normal voltage-reliability cap at high boost — information, not a limit.
const GPU_QUIET_REASONS = /^(Idle|Reliability|Applications Clocks Setting|Display Clock Setting)$/;

/** pure — the clock-limit reasons the driver reports that really hold the GPU back. */
export const gpuLimits = (g) => (g?.clockReasons ?? []).filter((r) => !GPU_QUIET_REASONS.test(r));

/** pure — the GPU: its temperature against the driver's own marks, and any real clock limit. */
export const gpuHealth = (g, telGpu) => {
  const temp = telGpu?.tempC ?? g?.tempC;
  const high = g?.tempLimits?.maxOperatingC;
  const crit = g?.tempLimits?.slowdownC;
  const limits = gpuLimits(g);
  const limited = limits.length ? (limits.some((r) => GPU_FAULT_REASONS.test(r)) ? 'fault' : 'warm') : 'ok';
  const level = worse(heatLevel(temp, high, crit), Number.isFinite(temp) || limits.length ? limited : 'unknown');
  const what = limits.length ? `limited: ${limits.join(', ').toLowerCase()}` : Number.isFinite(high) ? `max ${t0(high)}°` : 'no stated mark';
  return cell('gpu', 'GPU', level, t0(temp), '°', what);
};

/** pure — the power rails: the worst drift from nominal against the ATX tolerance. */
export const powerHealth = (readings) => {
  const { named } = railView(readings);
  if (!named.length) return cell('power', 'POWER', 'unknown', null, '%', 'no rail reading');
  const top = [...named].sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))[0];
  const off = Math.abs(top.drift);
  const level = off > ATX_TOLERANCE ? 'fault' : off > ATX_TOLERANCE * WARM_SHARE ? 'warm' : 'ok';
  const pct = `${top.drift >= 0 ? '+' : ''}${(top.drift * 100).toFixed(1)}`;
  return cell('power', 'POWER', level, pct, '%', `${top.name} rail · ±${ATX_TOLERANCE * 100}% spec`);
};

/**
 * pure — the whole machine as six cells, in the order the console lays its
 * panels out. `believed(r)` is false for a reading not to be believed
 * (machine-sense.js); those never decide a level.
 */
export const machineHealth = (machine, telGpu, believed = () => true) => {
  const r = (machine?.readings ?? []).filter((x) => x.type !== 'temp' || believed(x));
  const { pkg, cores } = cpuView(r);
  return Object.freeze([
    gpuHealth(machine?.gpu, telGpu),
    heatCell('cpu', 'CPU', [pkg, ...cores].filter(Boolean)),
    heatCell('memory', 'MEMORY', dimmRows(r)),
    heatCell('storage', 'STORAGE', driveRows(r, machine?.drives)),
    // The board's own sensors: a CPU temperature the board relays (PECI) is the CPU's, judged there.
    heatCell('board', 'BOARD', boardRows(r).filter((b) => !b.relayed)),
    powerHealth(r),
  ]);
};
