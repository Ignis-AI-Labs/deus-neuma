// atlas-map-layout.js — pure geometry for the MEMORY view's drawn map.
//
// The old field put every community on one ring and every link on top of it:
// a ball of yarn. This draws the overview a map is for. Each topic is a disc
// whose area is its number of memories; discs are packed outward from the
// largest without overlapping; inside a disc its memories sit on a sunflower
// spiral, the most connected at the centre. Links are NOT laid out here — the
// view draws only the opened memory's own links, and the few strongest ties
// between whole topics.
//
// Abstract units, deterministic, no Math.random, no Date.now.

const GOLDEN_ANGLE = 137.508 * (Math.PI / 180);
const SPACING = 7; // spiral step: a disc of n memories has radius SPACING·√n
const PAD = 10; // ring clearance around a disc's outermost memory
const GAP = 8; // clear space between one disc (with its name) and the next

/** The radius a disc of `n` memories needs. Pure. */
export const discRadius = (n) => SPACING * Math.sqrt(Math.max(1, n)) + PAD;

const LABEL_HEIGHT = 9; // the name's line over a disc
const LABEL_CHAR = 3.9; // one letter of a name, in layout units

/** The name a disc carries on the map: the first two parts of the topic's name. Pure. */
export const discLabel = (name) => String(name || '').split(' · ').slice(0, 2).join(' · ');

// The box a disc and the name over it take up.
const boxOf = (cx, cy, r, half) => ({ left: cx - half, right: cx + half, top: cy - r - LABEL_HEIGHT, bottom: cy + r });
const apart = (a, b) => a.right + GAP <= b.left || b.right + GAP <= a.left || a.bottom + GAP <= b.top || b.bottom + GAP <= a.top;

// Place discs largest first: each takes the first spot on an outward spiral
// from the centre where neither it nor its name touches one already placed.
const pack = (items) => {
  const placed = [];
  items.forEach(({ r, half }) => {
    for (let step = 0; ; step += 1) {
      const angle = step * 0.35;
      const reach = placed.length === 0 ? 0 : 4 + step * 2.2;
      // Wider than tall: a window is.
      const cx = Math.cos(angle) * reach * 1.5;
      const cy = Math.sin(angle) * reach;
      const box = boxOf(cx, cy, r, half);
      if (placed.every((p) => apart(p.box, box))) { placed.push({ cx, cy, r, box }); return; }
    }
  });
  return placed;
};

/**
 * Lay out the atlas.
 * @param {{topics:Array<{id:number, name:string, size:number}>,
 *   memories:Array<{id:string, topic:number, links:number, at:(string|null)}>}} atlas
 * @returns {{discs:Array<{topic:number, name:string, label:string, size:number, cx:number, cy:number, r:number}>,
 *   dots:Array<{id:string, topic:number, x:number, y:number, r:number, age:number}>,
 *   bounds:{minX:number, minY:number, maxX:number, maxY:number}}}
 *   `topic` -1 is the disc of memories in no topic (present only when there are
 *   some). `age` runs 0 (the newest memory) to 1 (the oldest).
 */
export const buildAtlasMapLayout = ({ topics = [], memories = [] } = {}) => {
  const groups = topics.map((t) => ({ topic: t.id, name: t.name, members: [] }));
  const loose = { topic: -1, name: 'No topic', members: [] };
  const groupOf = new Map(groups.map((g) => [g.topic, g]));
  for (const m of memories) (groupOf.get(m.topic) || loose).members.push(m);
  const all = (loose.members.length ? [...groups, loose] : groups).filter((g) => g.members.length > 0);
  // Largest first; the no-topic disc always last, at the edge.
  all.sort((a, b) => (a.topic === -1) - (b.topic === -1) || b.members.length - a.members.length || a.topic - b.topic);

  const times = memories.map((m) => Date.parse(m.at || '')).filter((t) => !Number.isNaN(t));
  const newest = times.reduce((a, b) => Math.max(a, b), -Infinity);
  const oldest = times.reduce((a, b) => Math.min(a, b), Infinity);
  const ageOf = (m) => {
    const t = Date.parse(m.at || '');
    return Number.isNaN(t) || newest === oldest ? (Number.isNaN(t) ? 1 : 0) : (newest - t) / (newest - oldest);
  };
  const mostLinks = memories.reduce((a, m) => Math.max(a, m.links || 0), 0);

  const labelOf = (g) => `${discLabel(g.name)} · ${g.members.length}`;
  const spots = pack(all.map((g) => {
    const r = discRadius(g.members.length);
    return { r, half: Math.max(r, (labelOf(g).length * LABEL_CHAR) / 2) };
  }));
  const discs = [];
  const dots = [];
  all.forEach((g, i) => {
    const { cx, cy, r } = spots[i];
    discs.push({ topic: g.topic, name: g.name, label: labelOf(g), size: g.members.length, cx, cy, r });
    [...g.members]
      .sort((a, b) => (b.links || 0) - (a.links || 0) || (a.id < b.id ? -1 : 1))
      .forEach((m, n) => {
        const reach = SPACING * Math.sqrt(n);
        dots.push({
          id: m.id,
          topic: g.topic,
          x: cx + reach * Math.cos(n * GOLDEN_ANGLE),
          y: cy + reach * Math.sin(n * GOLDEN_ANGLE),
          r: 1.6 + (mostLinks ? 2.2 * ((m.links || 0) / mostLinks) : 0),
          age: ageOf(m),
        });
      });
  });
  const bounds = discs.length === 0
    ? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    : spots.reduce((b, p) => ({
        minX: Math.min(b.minX, p.box.left), minY: Math.min(b.minY, p.box.top),
        maxX: Math.max(b.maxX, p.box.right), maxY: Math.max(b.maxY, p.box.bottom),
      }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  return { discs, dots, bounds };
};
