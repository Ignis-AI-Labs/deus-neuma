// machine-sense.js — what a sensor reading IS, in plain words, and whether it
// can be believed (SHINKEI: a mark that looks like data measures something
// real — a floating input's number is not a temperature, so it never reads as
// heat).
//
// Names: a chip's own label mapped to the part it sits on, only where that
// mapping is published (the nct67xx driver's label table, the hwmon driver
// names). An input the chip itself leaves unlabelled (AUXTINn) stays an
// "input n" — no guess at what is wired to it.
//
// Belief — a temperature is not believed when, on evidence from this rig
// (sensors -j, 2026-10-24, docs/work/closed/substrate-legible.md):
//   • it reads 0 °C or below: an unpopulated register (PCH_CHIP_CPU_MAX_TEMP
//     held 0.0 on every read while the machine ran warm);
//   • it reads at the 8-bit register ceiling (127 °C and up): an open input;
//   • a board thermistor input jumped ≥ 20 °C between two reads: AUXTIN3 read
//     55 → 33 → 68 → 49 → 122 → 49 at 5 s polls while every neighbour on the
//     same chip held within 1 °C. A thermistor on a board has thermal mass; no
//     part it could touch moves like that.
// A doubt, once found, holds for the session (trackSense).
//
// pure — no IO; the sense memory is a value the caller carries between polls.

export const SENSE = Object.freeze({ FLOOR_C: 0, CEILING_C: 127, SWING_C: 20 });

/** The super-I/O's thermistor/diode inputs — slow, board-mounted; the only readings judged by their swing. */
const THERMISTOR = /^(SYSTIN|CPUTIN|AUXTIN\d+)$/;
const BOARD_CHIP = /^(nct|it87|w83|f71)/;

/** The chip's own label → the part it reads, per the driver's published label table. */
const LABEL_NAMES = [
  [/^SYSTIN$/, () => 'Motherboard'],
  [/^CPUTIN$/, () => 'CPU socket'],
  [/^PECI(?:\/TSI)? Agent (\d+) Calibration$/, () => 'CPU calibration'],
  [/^PECI(?:\/TSI)? Agent (\d+)$/, () => 'CPU (board)'],
  [/^PCH_CHIP_CPU_MAX_TEMP$/, () => 'Chipset CPU max'],
  [/^PCH_CHIP_TEMP$/, () => 'Chipset'],
  [/^PCH_CPU_TEMP$/, () => 'Chipset CPU'],
  [/^PCH_MCH_TEMP$/, () => 'Chipset memory hub'],
  [/^AUXTIN(\d+)$/, (m) => `Input ${m[1]}`],
];
/** A chip with one lone reading → the device it is, per its hwmon driver name. */
const CHIP_NAMES = [
  [/^acpitz/, 'ACPI zone'],
  [/^iwlwifi/, 'Wi-Fi card'],
  [/^(r8169|r8125|igc|e1000e?|atlantic|tg3|bnxt)/, 'Network card'],
  [/^amdgpu/, 'Graphics'],
];

/** pure — the plain name of a temperature reading; the chip's label when no mapping is published. */
export const sensorName = (r) => {
  for (const [re, name] of LABEL_NAMES) {
    const m = re.exec(r.label);
    if (m) return name(m);
  }
  if (/^temp\d+$/.test(r.label)) {
    const hit = CHIP_NAMES.find(([re]) => re.test(r.chip));
    if (hit) return hit[1];
  }
  return r.label;
};

/** pure — is this an input the chip itself leaves unlabelled (nothing says what is wired to it)? */
export const isUnlabelled = (r) => /^AUXTIN\d+$/.test(r.label);

const keyOf = (r) => `${r.chip}:${r.label}`;
const judged = (r) => r.type === 'temp' && BOARD_CHIP.test(r.chip) && THERMISTOR.test(r.label);

/**
 * pure — the kind of doubt a temperature reading earns, or null when it is
 * believed: 'floor', 'ceiling', or 'swing' (`swing` = its largest jump).
 */
const doubtKind = (r, swing = 0) => {
  if (r.type !== 'temp' || !Number.isFinite(r.value)) return null;
  if (r.value <= SENSE.FLOOR_C) return 'floor';
  if (r.value >= SENSE.CEILING_C) return 'ceiling';
  if (judged(r) && swing >= SENSE.SWING_C) return 'swing';
  return null;
};

const REASON = Object.freeze({
  floor: () => 'reads 0° — no sensor reports here',
  ceiling: () => `reads at the chip's ${SENSE.CEILING_C}° ceiling — input open`,
  swing: (swing) => `jumped ${Math.round(swing)}° between reads — input floating`,
});

/** The sense memory before any read: no last values, no swings, nothing doubted. */
export const NO_SENSE = Object.freeze({ last: Object.freeze({}), swing: Object.freeze({}), doubt: Object.freeze({}) });

/**
 * pure — carry the sense memory over one more poll: the last value of every
 * board thermistor input, the largest jump each has made between two reads,
 * and every reading found not believable with the kind of doubt first found.
 * A doubt is kept for the session — a floating input passes through
 * believable numbers too — so a doubted reading never flips back and forth.
 */
export const trackSense = (memory, readings) => {
  const last = {};
  const swing = { ...memory.swing };
  const doubt = { ...memory.doubt };
  for (const r of readings ?? []) {
    if (r.type !== 'temp' || !Number.isFinite(r.value)) continue;
    const key = keyOf(r);
    if (judged(r)) {
      last[key] = r.value;
      const before = memory.last[key];
      if (Number.isFinite(before)) swing[key] = Math.max(swing[key] ?? 0, Math.abs(r.value - before));
    }
    const kind = doubt[key] ?? doubtKind(r, swing[key]);
    if (kind) doubt[key] = kind;
  }
  return Object.freeze({ last: Object.freeze(last), swing: Object.freeze(swing), doubt: Object.freeze(doubt) });
};

/** pure — why this reading is not believed in this memory, in plain words, or null (a fresh read is judged on its own value). */
export const doubtIn = (memory, r) => {
  const key = keyOf(r);
  const kind = memory?.doubt?.[key] ?? doubtKind(r);
  return kind ? REASON[kind](memory?.swing?.[key] ?? 0) : null;
};
