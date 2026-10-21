// machine-view.js — the machine's flat readings (backend/services/machine-thermals.js)
// shaped into what each SUBSTRATE HUD panel draws: the CPU's cores, the DIMMs,
// the drives, the board, the fans and the rails.
//
// pure — every limit shown is the chip's OWN high/critical mark; the only
// limits written here are published specs (the ATX rail tolerance).

const n0 = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—');
const c1 = (v) => (Number.isFinite(v) ? `${v.toFixed(1)}°C` : '—');
const has = (v) => Number.isFinite(v) && v > 0;

/** pure — one temperature against its own marks: […]. */
export const tempLine = (r) => `${c1(r.value)}${has(r.high) ? ` (high ${n0(r.high)}${has(r.crit) ? ` · crit ${n0(r.crit)}` : ''})` : ''}`;

/** pure — a chip's own short name: DIMMs by slot (SPD hub 0x50 = DIMM 1), drives by PCI address. */
export const chipName = (chip) => {
  const dimm = /^spd5118-i2c-\d+-5([0-7])$/.exec(chip);
  if (dimm) return `DIMM ${Number(dimm[1]) + 1}`;
  const nvme = /^nvme-pci-([0-9a-f]+)$/.exec(chip);
  if (nvme) return `nvme ${nvme[1]}`;
  return chip.replace(/-(i2c|pci|isa|acpi|virtual|mdio|hid).*$/, '');
};

/** pure — a reading as a gauge row: its name, value, own marks and state. */
const rowOf = (r, name) => Object.freeze({
  key: `${r.chip}:${r.label}`,
  chip: r.chip,
  name,
  value: r.value,
  high: has(r.high) ? r.high : null,
  crit: has(r.crit) ? r.crit : null,
  state: r.state,
  title: `${r.chip} ${r.label} — ${tempLine(r)}`,
});

const temps = (readings, kind) => readings.filter((r) => r.kind === kind && r.type === 'temp');
const byName = (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true });

/**
 * pure — a shared °C axis for a group of rows: up to the highest mark any of
 * them carries, rounded up to the next 10. Rows on one axis compare honestly.
 */
export const thermalAxis = (rows) => {
  const top = Math.max(0, ...rows.flatMap((r) => [r.crit, r.high, r.value]).filter(Number.isFinite));
  return top > 0 ? Math.ceil(top / 10) * 10 : 100;
};

/** pure — the CPU's package, and every core by number (the heatmap). */
export const cpuView = (readings) => {
  const cpu = temps(readings, 'cpu');
  const pkg = cpu.find((r) => /package/i.test(r.label));
  const cores = cpu.filter((r) => /^core\s*\d+/i.test(r.label))
    .map((r) => ({ ...rowOf(r, r.label.replace(/^core\s*/i, 'C')), n: Number(/\d+/.exec(r.label)[0]) }))
    .sort((a, b) => a.n - b.n);
  return Object.freeze({ pkg: pkg ? rowOf(pkg, 'PACKAGE') : null, cores });
};

/** pure — the memory DIMMs, by slot. */
export const dimmRows = (readings) => temps(readings, 'memory').map((r) => rowOf(r, chipName(r.chip))).sort(byName);

/** pure — each drive's Composite (its own headline reading), by PCI address. */
export const driveRows = (readings) => temps(readings, 'storage')
  .filter((r) => r.label === 'Composite').map((r) => rowOf(r, chipName(r.chip))).sort(byName);

/** pure — the board's and the network chips' temperatures; a chip's lone temp1 is named for its chip. */
export const boardRows = (readings) => [...temps(readings, 'board'), ...temps(readings, 'network')]
  .map((r) => rowOf(r, r.label === 'temp1' ? chipName(r.chip) : r.label));

const SOURCE = [[/^corsair/, 'CORSAIR'], [/^(nct|it87|asus)/, 'BOARD'], [/^(nzxt|kraken)/, 'NZXT']];
const sourceOf = (chip) => SOURCE.find(([re]) => re.test(chip))?.[1] ?? chipName(chip).toUpperCase();

/**
 * pure — the fans grouped by the controller they hang on. A header reading
 * 0 rpm has nothing turning on it; those are counted, not drawn.
 */
export const fanGroups = (readings) => {
  const groups = new Map();
  for (const r of readings.filter((x) => x.type === 'fan')) {
    const source = sourceOf(r.chip);
    const g = groups.get(source) ?? { source, spinning: [], idle: 0 };
    if (r.value > 0) g.spinning.push({ key: `${r.chip}:${r.label}`, name: r.label.replace(/ \dpin$/, '').toUpperCase(), rpm: r.value });
    else g.idle += 1;
    groups.set(source, g);
  }
  return [...groups.values()];
};

/** The Corsair Commander's rails as its driver documents them (corsair-cpro: in0 12 V, in1 5 V, in2 3.3 V). */
const CORSAIR_RAILS = Object.freeze({ in0: 12, in1: 5, in2: 3.3 });
/** ATX: the +12 V, +5 V and +3.3 V rails hold within ±5% of nominal. */
export const ATX_TOLERANCE = 0.05;

/**
 * pure — the rails: those with a documented nominal carry their drift from it
 * (a ratio of nominal); every other input is a bare reading with no claim.
 */
export const railView = (readings) => {
  const volts = readings.filter((r) => r.type === 'volt');
  const named = [];
  const bare = [];
  for (const r of volts) {
    const nominal = /^corsair/.test(r.chip) ? CORSAIR_RAILS[r.label] : undefined;
    if (nominal) named.push({ key: `${r.chip}:${r.label}`, name: `${nominal} V`, value: r.value, drift: (r.value - nominal) / nominal });
    else bare.push({ key: `${r.chip}:${r.label}`, name: r.label.toUpperCase(), value: r.value });
  }
  return Object.freeze({ named, bare });
};

/** pure — which rows sit past their own marks, for the alert strip. */
export const hotRows = (rows) => rows.filter((r) => r.state === 'hot' || r.state === 'critical');

const gbText = (mb) => (Number.isFinite(mb) ? `${(mb / 1024).toFixed(1)}G` : '—');
const part = (key, label, value, tone) => Object.freeze({ key, label, value, tone, text: gbText(value) });

/** pure — the machine's RAM as its parts: the model server's own memory, everything else in use, available. */
export const ramParts = (ram) => {
  if (!Number.isFinite(ram?.totalMB) || !Number.isFinite(ram?.usedMB)) return [];
  const server = Number.isFinite(ram.server?.anonMB) ? Math.min(ram.server.anonMB, ram.usedMB) : 0;
  return [
    part('server', 'MODEL SERVER', server, 'live'),
    part('other', 'OTHER', ram.usedMB - server, 'dim'),
    part('free', 'AVAILABLE', ram.totalMB - ram.usedMB, 'empty'),
  ];
};

/**
 * pure — VRAM as its holders: the three largest processes by name, the rest
 * folded, what no listed process accounts for (driver, display), and free.
 */
export const vramParts = (gpu, processes = []) => {
  if (!Number.isFinite(gpu?.totalMB) || !Number.isFinite(gpu?.usedMB)) return [];
  const procs = [...processes].sort((a, b) => b.memMB - a.memMB);
  // A process exec'd from a descriptor (/proc/self/fd/3) reaches the driver
  // named only by its fd number — say its PID instead of a bare "3".
  const nameOf = (p) => (/^\d*$/.test(String(p.name ?? '')) ? `PID ${p.pid}` : String(p.name).toUpperCase());
  const top = procs.slice(0, 3).map((p, i) => part(`pid-${p.pid}`, nameOf(p), p.memMB, i === 0 ? 'live' : 'dim'));
  const rest = procs.slice(3).reduce((a, p) => a + p.memMB, 0);
  const listed = procs.reduce((a, p) => a + p.memMB, 0);
  return [
    ...top,
    ...(rest > 0 ? [part('rest', `${procs.length - 3} MORE`, rest, 'dim')] : []),
    ...(gpu.usedMB - listed > 0 ? [part('unlisted', 'UNLISTED', gpu.usedMB - listed, 'muted')] : []),
    part('free', 'FREE', gpu.totalMB - gpu.usedMB, 'empty'),
  ];
};
