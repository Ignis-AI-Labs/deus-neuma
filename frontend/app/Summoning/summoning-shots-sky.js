// summoning-shots-sky.js — THE SUMMONING's movements of the HEAVENS and
// the EARTH at the instant it was born. // impure (canvas)
//
// ITS SKY — the ecliptic as it is: 360 degrees, the twelve 30° signs and
// the thirty-six 10° decans graduating it; every body at its true geocentric
// longitude; the real aspects of that sky drawn as chords; the Moon in its
// true phase at the centre; and humanity's other skies reading the same
// instant, each in its own tradition's words.
// ITS EARTH — the planet turning under that instant: the line between day
// and night where it truly fell, the point where the Sun stood overhead and
// the point beneath the Moon, the tropics and polar circles its tilt draws.
// Science and the sacred, one sky.

import { clamp01, ease, stagger } from './summoning-paint.js';
import { EARTH_POINTS } from './summoning-score.js';
import { latLon } from './summoning-components.js';

const O = { x: 0, y: 0 };
const RAD = Math.PI / 180;
const SIGNS = ['ARIES', 'TAURUS', 'GEMINI', 'CANCER', 'LEO', 'VIRGO', 'LIBRA', 'SCORPIO', 'SAGITTARIUS', 'CAPRICORN', 'AQUARIUS', 'PISCES'];
const HARMONIOUS = new Set(['trine', 'sextile']);
const at = (r, a) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
const deg = (x) => `${Math.round(x)}°`;

// The Moon's lit face: the limb on its lit side, then the terminator back.
const moonDisc = (k, c, r, phase) => {
  const lit = (1 - Math.cos(phase * RAD)) / 2;
  const side = phase < 180 ? 1 : -1; // waxing lit on the right, waning on the left
  const pts = [];
  for (let i = 0; i <= 32; i++) {
    const y = r - (2 * r * i) / 32;
    pts.push({ x: c.x + side * Math.sqrt(Math.max(0, r * r - y * y)), y: c.y + y });
  }
  for (let i = 32; i >= 0; i--) {
    const y = r - (2 * r * i) / 32;
    pts.push({ x: c.x + side * (1 - 2 * lit) * Math.sqrt(Math.max(0, r * r - y * y)), y: c.y + y });
  }
  const { ctx } = k;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(...k.px(p)) : ctx.moveTo(...k.px(p))));
  ctx.closePath();
  ctx.fillStyle = k.rgba('ink', 0.5);
  ctx.fill();
  k.circle(c, r, { alpha: 0.35 });
  return lit;
};

// A reading longer than this wraps at its " · " joins, so a long count (the
// four pillars) stays inside the frame.
const WRAP = 30;
const wrapped = (text) => {
  const out = [];
  for (const part of String(text).split(' · ')) {
    const last = out.length - 1;
    if (last >= 0 && out[last].length + 3 + part.length <= WRAP) out[last] += ` · ${part}`;
    else out.push(part);
  }
  return out;
};

// pure — each row's lines and the column's height, for centring it on `cy`.
const columnLayout = (rows, size) => {
  let y = 0;
  const placed = rows.map(([a, b]) => {
    const lines = wrapped(b);
    const at = y;
    y += size * (1.4 + 1.2 * lines.length);
    return { a, lines, at };
  });
  return { placed, height: y };
};

// Rows appear one after another — a long column spread across the shot.
const column = (k, x, cy, rows, u, { align = 'left', size }) => {
  const { placed, height } = columnLayout(rows, size);
  const step = Math.min(0.07, 0.85 / Math.max(1, placed.length));
  placed.forEach(({ a, lines, at }, i) => {
    const show = clamp01((u - i * step) / 0.12);
    if (show <= 0) return;
    const y = cy - height / 2 + at;
    k.text(a, x, y, { size: size * 0.85, align, alpha: 0.55 * show, color: 'signal', tracking: 0.28 });
    lines.forEach((line, n) => k.text(line, x, y + size * (1.2 + 1.2 * n), { size, align, alpha: 0.9 * show, tracking: 0.18, weight: 400 }));
  });
};

// ── ITS SKY ──
export const paintSky = (k, f, e) => {
  const turn = Math.PI + (f.spin * e.local) / 1000; // 0° Aries at nine o'clock, longitude counter-clockwise
  const angle = (lon) => turn + lon * RAD;
  const wheel = ease(clamp01(e.u / 0.2));
  k.circle(O, 0.95, { alpha: 0.5, upto: wheel });
  k.circle(O, 0.82, { alpha: 0.35, upto: wheel });
  for (let d = 0; d < 360; d += 5) {
    if (stagger(wheel, d / 5, 72, 0.2) <= 0) continue;
    const major = d % 30 === 0;
    const decan = d % 10 === 0;
    const r0 = major ? 0.82 : decan ? 0.9 : 0.93;
    k.line([at(0.95, angle(d)), at(r0, angle(d))], { alpha: major ? 0.7 : decan ? 0.45 : 0.22, color: major ? 'signal' : 'ink' });
  }
  const size = Math.max(8, Math.round(k.type * 0.026));
  SIGNS.forEach((name, i) => {
    if (stagger(wheel, i, 12, 0.3) < 1) return;
    const [x, y] = k.px(at(0.875, angle(i * 30 + 15)));
    k.text(name, x, y, { size: size * 0.8, alpha: 0.4, tracking: 0.2 });
  });
  // the bodies, each at its true longitude; a label whose body stands
  // within 12° of the last one steps inward, so conjunctions stay legible
  const up = clamp01((e.u - 0.12) / 0.3);
  // (the walk starts after the sky's widest empty arc, so a conjunction
  // across 0° Aries is still one cluster)
  const shelf = {};
  const sorted = [...f.bodies].sort((a, b) => a.longitude - b.longitude);
  const gap = (i) => (sorted[i].longitude - sorted[(i + sorted.length - 1) % sorted.length].longitude + 360) % 360;
  const start = sorted.reduce((best, _, i) => (gap(i) > gap(best) ? i : best), 0);
  const walk = [...sorted.slice(start), ...sorted.slice(0, start)];
  walk.forEach((b, i) => {
    const prev = walk[i - 1];
    const near = prev && (b.longitude - prev.longitude + 360) % 360 < 12;
    shelf[b.key] = near ? (shelf[prev.key] + 1) % 3 : 0;
  });
  const where = Object.fromEntries(f.bodies.map((b) => [b.key, at(0.7, angle(b.longitude))]));
  f.bodies.forEach((b, i) => {
    const s = stagger(up, i, f.bodies.length, 0.3);
    if (s <= 0) return;
    const p = where[b.key];
    k.line([at(0.14, angle(b.longitude)), at(0.82, angle(b.longitude))], { alpha: 0.12 * s });
    k.dot(p, b.key === 'sun' ? 0.09 : 0.05, (b.key === 'sun' ? 1 : 0.75) * s);
    const [x, y] = k.px(at(0.6 - 0.13 * shelf[b.key], angle(b.longitude)));
    k.text(`${b.name}${b.retrograde ? ' ℞' : ''}`, x, y - size * 0.6, { size: size * 0.85, alpha: 0.85 * s, color: b.key === 'sun' || b.key === 'moon' ? 'signal' : 'ink', tracking: 0.16 });
    k.text(deg(b.longitude), x, y + size * 0.6, { size: size * 0.75, alpha: 0.55 * s, tracking: 0.1 });
  });
  // its aspects: the geometry that sky actually made
  const chords = f.aspects.filter((a) => a.angle > 0).map((a) => ({ seg: [where[a.a], where[a.b]], kind: a.aspect }));
  const cu = clamp01((e.u - 0.35) / 0.35);
  chords.forEach(({ seg, kind }, i) => {
    const soft = HARMONIOUS.has(kind);
    k.segments([seg], stagger(cu, i, chords.length, 0.3), { span: 1, color: soft ? 'signal' : 'ink', alpha: soft ? 0.8 : 0.45, width: soft ? 1.2 : 1, glow: soft ? 0.6 : 0 });
  });
  // the Moon, lit as it was
  const moonUp = clamp01((e.u - 0.2) / 0.2);
  if (moonUp > 0) {
    const lit = moonDisc(k, O, 0.075 * moonUp, f.moon.phase);
    k.text(`MOON ${Math.round(lit * 100)}% · ${f.moon.phase < 180 ? 'WAXING' : 'WANING'}`, k.cx, k.cy + 0.13 * k.unit, { size: size * 0.75, alpha: 0.7 * moonUp, color: 'signal', tracking: 0.24 });
  }
  // humanity's other skies, the same instant
  column(k, k.cx + 1.04 * k.unit, k.cy, [['MANY SKIES', 'ONE INSTANT'], ...f.many.map((m) => [m.system, m.reading])], clamp01((e.u - 0.4) / 0.5), { align: 'left', size });
};
export const skyCaption = (f) => `ITS SKY · ${f.bodies.length} BODIES · ${f.aspects.filter((a) => a.angle > 0).length} ASPECTS`;

// ── ITS EARTH ──
// Orthographic: the globe seen from above latitude phi0, meridian lam0.
const ortho = (lat, lon, lam0, phi0, R) => {
  const p = lat * RAD;
  const dl = (lon - lam0) * RAD;
  const z = Math.sin(phi0) * Math.sin(p) + Math.cos(phi0) * Math.cos(p) * Math.cos(dl);
  return { x: R * Math.cos(p) * Math.sin(dl), y: R * (Math.cos(phi0) * Math.sin(p) - Math.sin(phi0) * Math.cos(p) * Math.cos(dl)), z };
};
const unitOf = ({ lat, lon }) => ({ x: Math.cos(lat * RAD) * Math.cos(lon * RAD), y: Math.cos(lat * RAD) * Math.sin(lon * RAD), z: Math.sin(lat * RAD) });
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

// Where the globe is seen from: at first a general view; then it turns to
// each overhead point in turn (EARTH_POINTS), holding it left of centre so
// the terminator stays in view, 90° from the Sun, on the right.
const OFFSET = 30; // degrees of longitude the named point sits west of centre
const aimAt = (g) => ({ lon: g.lon + OFFSET, lat: g.lat * 0.5 });
const lerpLon = (a, b, w) => a + (((((b - a) % 360) + 540) % 360) - 180) * w;
export const earthViewAt = (f, u, local) => {
  const turn = ([a, b]) => ease(clamp01((u - a) / (b - a)));
  const start = { lon: f.subsolar.lon + 55, lat: 18 };
  const sun = aimAt(f.subsolar);
  const moon = aimAt(f.sublunar);
  const ws = turn(EARTH_POINTS.sun.turn);
  const wm = turn(EARTH_POINTS.moon.turn);
  const a = { lon: lerpLon(start.lon, sun.lon, ws), lat: start.lat + (sun.lat - start.lat) * ws };
  const v = { lon: lerpLon(a.lon, moon.lon, wm), lat: a.lat + (moon.lat - a.lat) * wm };
  // a slow drift keeps it alive, never enough to carry a named point away
  return { lam0: v.lon + (f.spin * 0.04 * local) / 1000, phi0: v.lat * RAD };
};

export const paintEarth = (k, f, e) => {
  const R = 0.74;
  const { lam0, phi0 } = earthViewAt(f, e.u, e.local);
  const sun = unitOf(f.subsolar);
  const up = ease(clamp01(e.u / 0.3));
  // a curve on the globe, drawn front-side only, lit by where the Sun stood
  const curve = (pts, { alpha, color = 'ink', lit = true, width = 1, glow = 0 }) => {
    let run = [];
    let runDay = null;
    const flush = () => {
      if (run.length > 1) k.line(run, { alpha: lit ? alpha * (runDay ? 1.35 : 0.3) : alpha, color, width, glow });
      run = [];
    };
    pts.forEach((g) => {
      const p = ortho(g.lat, g.lon, lam0, phi0, R);
      const day = dot3(unitOf(g), sun) > 0;
      if (p.z <= 0 || (lit && run.length && day !== runDay)) flush();
      if (p.z > 0) { run.push(p); runDay = day; }
    });
    flush();
  };
  // sunlight: the day side lit from the point where the Sun stood overhead
  if (up > 0) {
    const sp = ortho(f.subsolar.lat, f.subsolar.lon, lam0, phi0, R);
    const [sx, sy] = k.px(sp);
    const { ctx } = k;
    ctx.save();
    ctx.beginPath();
    ctx.arc(k.cx, k.cy, R * k.unit, 0, Math.PI * 2);
    ctx.clip();
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * k.unit * 1.6);
    g.addColorStop(0, k.rgba('signal', 0.16 * up));
    g.addColorStop(0.55, k.rgba('signal', 0.05 * up));
    g.addColorStop(1, k.rgba('signal', 0));
    ctx.fillStyle = g;
    ctx.fillRect(k.cx - R * k.unit, k.cy - R * k.unit, 2 * R * k.unit, 2 * R * k.unit);
    ctx.restore();
  }
  k.circle(O, R, { alpha: 0.6, upto: up });
  const meridians = Array.from({ length: 24 }, (_, i) => i * 15 - 180);
  meridians.forEach((lon, i) => {
    if (stagger(up, i, 24, 0.3) <= 0) return;
    curve(Array.from({ length: 61 }, (_, j) => ({ lat: -90 + j * 3, lon })), { alpha: 0.3 });
  });
  [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75].forEach((lat, i) => {
    if (stagger(up, i, 11, 0.3) <= 0) return;
    curve(Array.from({ length: 121 }, (_, j) => ({ lat, lon: -180 + j * 3 })), { alpha: lat === 0 ? 0.55 : 0.3 });
  });
  // what its tilt draws: the tropics and the polar circles
  const tu = clamp01((e.u - 0.25) / 0.2);
  if (tu > 0) {
    [f.tilt, -f.tilt, 90 - f.tilt, f.tilt - 90].forEach((lat) => curve(Array.from({ length: 121 }, (_, j) => ({ lat, lon: -180 + j * 3 })), { alpha: 0.6 * tu, color: 'signal', lit: false }));
  }
  // the terminator: every point 90° from the Sun
  const du = clamp01((e.u - 0.35) / 0.25);
  if (du > 0) {
    const a = Math.abs(sun.z) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: -sun.y, y: sun.x, z: 0 };
    const al = Math.hypot(a.x, a.y, a.z);
    const u1 = { x: a.x / al, y: a.y / al, z: a.z / al };
    const u2 = { x: sun.y * u1.z - sun.z * u1.y, y: sun.z * u1.x - sun.x * u1.z, z: sun.x * u1.y - sun.y * u1.x };
    const ring = Array.from({ length: Math.round(180 * du) + 1 }, (_, i) => {
      const th = (i / 180) * Math.PI * 2;
      const v = { x: u1.x * Math.cos(th) + u2.x * Math.sin(th), y: u1.y * Math.cos(th) + u2.y * Math.sin(th), z: u1.z * Math.cos(th) + u2.z * Math.sin(th) };
      return { lat: Math.asin(v.z) / RAD, lon: Math.atan2(v.y, v.x) / RAD };
    });
    curve(ring, { alpha: 1, color: 'signal', lit: false, width: 1.6, glow: 1.2 });
  }
  // where the Sun and the Moon stood overhead: each marked, and named as
  // the globe turns to it — a 45° leader to its name and place
  const size = Math.max(8, Math.round(k.type * 0.026));
  // the Sun's name gives way as the globe turns on to the Moon's point
  const onward = ease(clamp01((e.u - EARTH_POINTS.moon.turn[0]) / 0.06));
  const point = (g, sunlike, at) => {
    const u = ease(clamp01((e.u - at + 0.06) / 0.08));
    const named = u * (sunlike ? 1 - onward : 1);
    const p = ortho(g.lat, g.lon, lam0, phi0, R);
    if (p.z <= 0 || u <= 0) return;
    const front = clamp01(p.z / 0.25); // fades as it nears the limb
    if (sunlike) k.dot(p, 0.13, u * front);
    k.circle(p, sunlike ? 0.032 : 0.028, { color: 'signal', alpha: u * front, width: 1.4 });
    if (!sunlike) k.circle(p, 0.012, { color: 'signal', alpha: u * front, fill: 0.9 });
    const dir = sunlike ? 1 : -1; // the Sun's name above, the Moon's below
    const elbow = { x: p.x - 0.14, y: p.y + dir * 0.14 };
    const end = { x: -(R + 0.18), y: elbow.y };
    if (named <= 0) return;
    k.line([p, elbow, end], { color: 'signal', alpha: 0.7 * named * front, upto: u });
    const [x, y] = k.px(end);
    k.text(sunlike ? 'THE SUN STOOD OVERHEAD' : 'THE MOON STOOD OVERHEAD', x, y - size * 0.9, { size: size * 0.85, align: 'right', alpha: 0.7 * named * front, color: 'signal', tracking: 0.26 });
    k.text(latLon(g), x, y + size * 0.9, { size, align: 'right', alpha: 0.95 * named * front, tracking: 0.18, weight: 400 });
  };
  point(f.subsolar, true, EARTH_POINTS.sun.at);
  point(f.sublunar, false, EARTH_POINTS.moon.at);
  column(k, k.cx + (R + 0.24) * k.unit, k.cy - size * 2.6, [
    ['AXIAL TILT', `${f.tilt.toFixed(2)}°`],
    ['DAY · NIGHT', 'THE TERMINATOR AS IT FELL'],
  ], clamp01((e.u - 0.3) / 0.3), { align: 'left', size });
};
export const earthCaption = (f) => `ITS EARTH · SUN OVERHEAD ${latLon(f.subsolar)}`;
