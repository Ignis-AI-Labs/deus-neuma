// heat-bar.jsx — one temperature as a bar on its group's shared axis, marked
// at the chip's own high and critical marks and toned by its level
// (machine-health.js). The group's label carries the unit, not each row.

import { Bar } from './hud-instruments.jsx';
import { heatLevel, levelTone } from './machine-health.js';

const n0 = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—');

/** pure — a temperature row's instrument tone, from its level against its own marks. */
export const rowTone = (row) => levelTone(heatLevel(row.value, row.high, row.crit));

export const HeatBar = ({ row, axis }) => (
  <Bar name={row.name} value={row.value} max={axis} marks={[{ kind: 'high', at: row.high }, { kind: 'crit', at: row.crit }]}
    text={n0(row.value)} tone={rowTone(row)} title={row.title} />
);
