// ignition-panels.js — THE IGNITION raised to THE SUMMONING RITE's instrument
// language (Design note, 2026-10-06: […]): an instrument column, a column of the answers timed,
// a dense graduated ring that bursts where a verdict's light lands, and THE
// MEASURE along the foot. // pure but for the canvas it is handed
//
// SHINKEI, as the rite: every number is true. The left column reads the mark
// as it is drawn (its axis's live lean, its meridian's sweep, its figures'
// progress) and this install's genesis; the right column and the measure read
// each instrument's TRUE answer time — when its probe returned, not when the
// panel let it show. Metrics follow the rite's panels (BirthArt.css .ba-*):
// 11 px data type tracked .14em, a 1 px rule on the column's edge, a diamond
// per row, 1 px bars.

const ALERT = '255,96,96';
const LIGHT_OF = { ok: 'signal', bound: 'signal', empty: 'ink', standby: 'ink', fail: ALERT };
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');
const secs = (ms) => `${(ms / 1000).toFixed(3)} S`;

const SIZE = 11;
const ROW = 23; // the rite's 6 px gap at 11 px type, line-height included
const TAG_GAP = 10;

// the column's box: the rite's clamp(24px, 4vw, 64px) inset, under the frame's readouts
const columnTop = (k) => Math.round(Math.min(k.w, k.h) * 0.02) + 62;
const inset = (k) => Math.min(64, Math.max(24, k.w * 0.04)) + Math.round(Math.min(k.w, k.h) * 0.02);

const rule = (k, x, y0, y1, color, alpha) => {
  k.ctx.beginPath();
  k.ctx.moveTo(x + 0.5, y0);
  k.ctx.lineTo(x + 0.5, y1);
  k.ctx.strokeStyle = k.rgba(color, alpha);
  k.ctx.lineWidth = 1;
  k.ctx.stroke();
};

const diamond = (k, x, y, color, alpha) => {
  const { ctx } = k;
  ctx.beginPath();
  ctx.moveTo(x, y - 3.5);
  ctx.lineTo(x + 3.5, y);
  ctx.lineTo(x, y + 3.5);
  ctx.lineTo(x - 3.5, y);
  ctx.closePath();
  ctx.fillStyle = k.rgba(color, alpha);
  ctx.fill();
};

/**
 * The instrument column, left: what the mark truly is as it wakes.
 * @returns {Array<[string, string, boolean]>} rows [key, value, dim] — exported for its test
 */
export const instrumentRowsOf = (s, genesis) => {
  const declared = s.instruments.filter((i) => i.state).length;
  const sec = s.t / 1000;
  return [
    ['T+', `${pad2(sec)}.${pad2((sec % 1) * 100)} S`, false],
    ['DECLARED', `${pad2(declared)} / ${pad2(s.instruments.length)}`, declared === 0],
    ['AXIS', s.axis > 0 ? `${s.lean.toFixed(2)}°` : 'AT REST', s.axis <= 0],
    ['MERIDIAN', `${String(Math.round(s.meridian * 360)).padStart(3, '0')}°`, s.meridian <= 0],
    ['FIGURES', s.geometry > 0 ? `04 · ${String(Math.round(s.geometry * 100)).padStart(3, '0')} % DRAWN` : 'UNDRAWN', s.geometry <= 0],
    ['GENESIS', genesis ? genesis.replace(/^GENESIS\s*·\s*/i, '') : 'NONE RECORDED', !genesis],
  ];
};

const paintInstrumentColumn = (k, s, genesis, fade) => {
  const x = inset(k);
  const top = columnTop(k);
  const rows = instrumentRowsOf(s, genesis);
  const alpha = fade;
  k.text('IGNITION · INSTRUMENT', x + 16, top, { size: SIZE, align: 'left', color: 'signal', alpha, tracking: 0.26, weight: 400 });
  rows.forEach(([key, value, dim], i) => {
    const y = top + TAG_GAP + ROW * (i + 1);
    k.text(key, x + 16, y, { size: SIZE, align: 'left', alpha: 0.45 * alpha, tracking: 0.14, weight: 400 });
    k.text(value.length > 30 ? `${value.slice(0, 29)}…` : value, x + 16 + SIZE * 9.5, y, {
      size: SIZE, align: 'left', alpha: (dim ? 0.4 : 0.92) * alpha, tracking: 0.14, weight: 400,
    });
  });
  rule(k, x, top - 12, top + TAG_GAP + ROW * rows.length + 12, 'ink', 0.16 * alpha);
};

// the answers' scale: a second, or the slowest true answer
const scaleOf = (s) => Math.max(1000, ...s.instruments.map((i) => (Number.isFinite(i.arrived) ? i.arrived : 0)));

const paintAnswerColumn = (k, s, fade) => {
  const right = k.w - inset(k);
  const top = columnTop(k);
  const alpha = fade;
  const scale = scaleOf(s);
  const barW = 72;
  k.text('ITS ANSWERS · TIMED', right - 16, top, { size: SIZE, align: 'right', color: 'signal', alpha, tracking: 0.26, weight: 400 });
  s.instruments.forEach((inst, i) => {
    const y = top + TAG_GAP + ROW * (i + 1);
    const color = inst.state ? LIGHT_OF[inst.state] || 'ink' : 'ink';
    const timeX = right - 16;
    const barX = timeX - SIZE * 7.6 - barW;
    const nameX = barX - SIZE * 1.4;
    diamond(k, nameX - SIZE * 11.2, y, inst.state ? color : 'ink', (inst.state ? 0.25 + 0.75 * inst.lit : 0.18) * alpha);
    k.text(inst.key, nameX - SIZE * 10, y, { size: SIZE, align: 'left', alpha: 0.7 * alpha, tracking: 0.14, weight: 400 });
    // the bar: a hairline, and the answer's true time along it
    k.ctx.beginPath();
    k.ctx.moveTo(barX, y + 0.5);
    k.ctx.lineTo(barX + barW, y + 0.5);
    k.ctx.strokeStyle = k.rgba('ink', 0.14 * alpha);
    k.ctx.lineWidth = 1;
    k.ctx.stroke();
    if (inst.state && Number.isFinite(inst.arrived)) {
      k.ctx.beginPath();
      k.ctx.moveTo(barX, y + 0.5);
      k.ctx.lineTo(barX + barW * clamp01(inst.arrived / scale) * inst.lit + 1, y + 0.5);
      k.ctx.strokeStyle = k.rgba(color, 0.85 * alpha);
      k.ctx.stroke();
    }
    const read = inst.state && Number.isFinite(inst.arrived) ? secs(inst.arrived) : inst.checking ? '· · ·' : '';
    k.text(read, timeX, y, { size: SIZE, align: 'right', alpha: (inst.state ? 0.92 : 0.4) * alpha, tracking: 0.14, weight: 400 });
  });
  rule(k, right, top - 12, top + TAG_GAP + ROW * s.instruments.length + 12, 'signal', 0.35 * alpha);
};

/**
 * The dense ring, outside the instruments' ring: 180 graduations swept in
 * from the top (every 15th long, every 5th mid); where a verdict's light
 * lands, a burst of signal ticks reaches outward and settles.
 */
export const paintDenseRing = (k, s, [cx, cy], r, instrumentAngleOf) => {
  if (s.notation <= 0) return;
  const { ctx } = k;
  const n = 180;
  const shown = Math.ceil(s.notation * n);
  const bursts = s.instruments
    .map((inst, i) => ({ a: instrumentAngleOf(i, s.instruments.length), lit: inst.lit, state: inst.state }))
    .filter((b) => b.state && b.state !== 'fail' && b.lit > 0);
  for (let i = 0; i < shown; i++) {
    const a = -Math.PI / 2 + (i / n) * TAU;
    const long = i % 15 === 0;
    const mid = i % 5 === 0;
    let reach = long ? 9 : mid ? 6 : 3;
    let color = 'ink';
    let alpha = long ? 0.5 : mid ? 0.32 : 0.18;
    for (const b of bursts) {
      const d = Math.abs(Math.atan2(Math.sin(a - b.a), Math.cos(a - b.a)));
      if (d > 0.42) continue;
      // the light lands and runs out: longest at its arc's middle, settling as it lights
      const swell = (1 - d / 0.42) * Math.sin(Math.PI * Math.min(1, b.lit)) * (0.6 + 0.4 * ((i * 7919) % 13) / 13);
      if (swell <= 0.05) continue;
      reach = Math.max(reach, 3 + 22 * swell);
      color = LIGHT_OF[b.state] || 'signal';
      alpha = Math.max(alpha, 0.35 + 0.55 * swell);
    }
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r + 4), cy + Math.sin(a) * (r + 4));
    ctx.lineTo(cx + Math.cos(a) * (r + 4 + reach), cy + Math.sin(a) * (r + 4 + reach));
    ctx.strokeStyle = k.rgba(color, alpha * s.notation);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
};

/**
 * THE MEASURE, along the foot: the ignition's own clock as a rail, each
 * instrument marked where it truly answered, the cursor at now, and when the
 * still point opens. Exported pieces for its test: the rail's span.
 */
export const measureSpanOf = (s) => Math.max(4000, Number.isFinite(s.openAt) ? s.openAt + 400 : 0, s.t + 200, scaleOf(s) + 400);

const paintMeasure = (k, s, fade) => {
  const { ctx } = k;
  const w = Math.min(560, k.w * 0.4);
  const x0 = k.w / 2 - w / 2;
  const y = k.h - Math.round(Math.min(k.w, k.h) * 0.02) - 96;
  const span = measureSpanOf(s);
  const at = (ms) => x0 + w * clamp01(ms / span);
  const alpha = fade;
  const declared = s.instruments.filter((i) => i.state).length;
  k.text(`THE MEASURE · ${declared} / ${s.instruments.length} · EACH INSTRUMENT'S TRUE ANSWER, TIMED — NEVER STAGED`, k.w / 2, y - 26, {
    size: 9.5, alpha: 0.55 * alpha, tracking: 0.22, weight: 400,
  });
  // the rail, and a graduation each second
  ctx.beginPath();
  ctx.moveTo(x0, y + 0.5);
  ctx.lineTo(x0 + w, y + 0.5);
  ctx.strokeStyle = k.rgba('ink', 0.28 * alpha);
  ctx.lineWidth = 1;
  ctx.stroke();
  for (let ms = 0; ms <= span; ms += 1000) {
    ctx.beginPath();
    ctx.moveTo(at(ms) + 0.5, y);
    ctx.lineTo(at(ms) + 0.5, y + 6);
    ctx.strokeStyle = k.rgba('ink', 0.4 * alpha);
    ctx.stroke();
    k.text(`${ms / 1000} S`, at(ms), y + 16, { size: 9, alpha: 0.4 * alpha, tracking: 0.18, weight: 400 });
  }
  // each true answer, in its state's light
  s.instruments.forEach((inst) => {
    if (!inst.state || !Number.isFinite(inst.arrived)) return;
    const color = LIGHT_OF[inst.state] || 'ink';
    ctx.beginPath();
    ctx.moveTo(at(inst.arrived) + 0.5, y - 14 * inst.lit);
    ctx.lineTo(at(inst.arrived) + 0.5, y);
    ctx.strokeStyle = k.rgba(color, 0.9 * alpha);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
  // now
  ctx.beginPath();
  ctx.moveTo(at(s.t) + 0.5, y - 6);
  ctx.lineTo(at(s.t) + 0.5, y + 1);
  ctx.strokeStyle = k.rgba('signal', 0.9 * alpha);
  ctx.lineWidth = 1;
  ctx.stroke();
  const pending = s.instruments.length - declared;
  const read = Number.isFinite(s.openAt)
    ? `OPENS AT T+ ${(s.openAt / 1000).toFixed(2)} S`
    : `AWAITING ${pad2(pending)} ${pending === 1 ? 'ANSWER' : 'ANSWERS'}`;
  k.text(read, k.w / 2, y + 36, { size: 9.5, color: Number.isFinite(s.openAt) ? 'signal' : 'ink', alpha: 0.7 * alpha, tracking: 0.22, weight: 400 });
};

/** The raised panels, over the plane — they settle in with the frame and yield with the opening. */
export const paintRaisedPanels = (k, s, genesis) => {
  const fade = s.frame * (1 - s.open);
  if (fade <= 0) return;
  paintInstrumentColumn(k, s, genesis, fade);
  paintAnswerColumn(k, s, fade);
  paintMeasure(k, s, fade);
};
