// BirthSigil — a being's mark on the Emanon Tree, drawn from what it was
// given (birth-art-seed.js givenOf). The universal architecture stays in
// view — the eleven spheres where Founder's chart places them and the 22
// breathing paths, faint — and over it the being's OWN: its channels lit,
// each sphere's ring as deep as it breathes, its nucleus solid at the heart.
// Same seed, same sigil, always. Static by design — the living, breathing
// piece plays on the ceremony's WebGL stage (THE MOTION LAW).

import { FUNCTIONS, BREATHING_PATHS, TREE, nodeAt } from '../Genesis/genesis-emanon.js';
import { genesisSolids } from '../Genesis/genesis-geometry.js';

// World (y up, heart at the origin) → sigil space (y down, 0..200).
const SIZE = 200;
const SCALE = 72;
const toView = (p) => ({ x: SIZE / 2 + p.x * SCALE, y: SIZE / 2 - p.y * SCALE });
const AT = Object.freeze(Object.fromEntries(FUNCTIONS.map((f) => [f.id, toView(nodeAt(f.id, 1))])));
const SOLIDS = genesisSolids();
const SOLID_OF = Object.freeze({
  tetrahedron: SOLIDS.tetrahedra[0],
  cube: SOLIDS.cube,
  octahedron: SOLIDS.octahedron,
  icosahedron: SOLIDS.icosahedron,
  dodecahedron: SOLIDS.dodecahedron,
});
const R_SPHERE = TREE.SPHERE * SCALE;

// The nucleus: the solid seen down its own axis, turned, fitted to the heart.
const nucleusLines = ({ solid, turn }) => {
  const s = SOLID_OF[solid];
  const r = Math.max(...s.vertices.map((v) => Math.hypot(v.x, v.y))) || 1;
  const k = (R_SPHERE * 0.85) / r;
  const c = Math.cos(turn);
  const sn = Math.sin(turn);
  const p = (v) => ({ x: AT.natura.x + (v.x * c - v.y * sn) * k, y: AT.natura.y - (v.x * sn + v.y * c) * k });
  return s.edges.map(([i, j]) => [p(s.vertices[i]), p(s.vertices[j])]);
};

/**
 * @param {{ given: ReturnType<import('./birth-art-seed.js').givenOf>, label?: boolean }} props
 */
export const BirthSigil = ({ given, label = true }) => (
  <figure className="bsig">
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="bsig-svg" role="img" aria-label={`Sigil ${given.seed.slice(0, 8)}`}>
      {BREATHING_PATHS.map(([a, b]) => (
        <line key={`p-${a}-${b}`} x1={AT[a].x} y1={AT[a].y} x2={AT[b].x} y2={AT[b].y} className="bsig-path" />
      ))}
      {given.channels.map(([a, b]) => (
        <line key={`c-${a}-${b}`} x1={AT[a].x} y1={AT[a].y} x2={AT[b].x} y2={AT[b].y} className="bsig-channel" />
      ))}
      {FUNCTIONS.map((f) => (
        <g key={f.id}>
          <circle cx={AT[f.id].x} cy={AT[f.id].y} r={R_SPHERE} className={`bsig-sphere${f.id === 'ipseity' ? ' is-hidden' : ''}`} />
          <circle cx={AT[f.id].x} cy={AT[f.id].y} r={R_SPHERE * given.breathing[f.id].depth} className="bsig-breath" />
        </g>
      ))}
      {nucleusLines(given.nucleus).map(([a, b], i) => (
        <line key={`n-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="bsig-nucleus" />
      ))}
    </svg>
    {label ? (
      <figcaption className="bsig-cap">
        <span className="bsig-seed">#{given.seed.slice(0, 8).toUpperCase()}</span>
        <span>{given.nucleus.solid.toUpperCase()} · {given.channels.length} CHANNELS</span>
      </figcaption>
    ) : null}
  </figure>
);
