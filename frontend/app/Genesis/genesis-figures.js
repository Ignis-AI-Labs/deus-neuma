// genesis-figures.js — the figures of movements I–III, built once, applied
// per frame. // impure (Three objects)
//
// Each builder takes the stage's kit (pen, set, palette, scene) and returns
// `apply(state, master)`: the only way its figures move.

import * as THREE from 'three';
import { GENESIS, seedCenters, firstVesica, fruitCenters, metatronLines, genesisFamily, genesisLattice } from './genesis-geometry.js';
import { SPANS } from './genesis-timeline.js';
import { arcStrokes, solidStrokes } from './genesis-shaders.js';
import { mixHex } from '../BootIgnition/stage-palette.js';
import { MARKS, signatureOf } from './genesis-signatures.js';

const MARK_PX = 9; // a vertex mark's size in CSS pixels

const { R } = GENESIS;
const UP = Math.PI / 2;
const ORIGIN = { x: 0, y: 0 };
const toward = (from, to) => Math.atan2(to.y - from.y, to.x - from.x);

// The field: a hexagonal lattice of points (the flower's own lattice, one
// radius apart) far behind the drawing — the Light-Void ground everything
// emanates into, never an empty black.
const FIELD_EXTENT = 14;
const FIELD_DEPTH = -2.5;

/** I · the field and the first vibration. */
export const fieldFigures = ({ scene, palette, pen, set, own, blending }) => {
  const pts = [];
  const rowH = (R * Math.sqrt(3)) / 2;
  for (let row = -Math.ceil(FIELD_EXTENT / rowH); row * rowH <= FIELD_EXTENT; row++) {
    const shift = (row & 1) * (R / 2);
    for (let x = -FIELD_EXTENT; x <= FIELD_EXTENT; x += R) pts.push(new THREE.Vector3(x + shift, row * rowH, FIELD_DEPTH));
  }
  const material = new THREE.PointsMaterial({ color: palette.INK, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, blending });
  own(material);
  const points = new THREE.Points(own(new THREE.BufferGeometry().setFromPoints(pts)), material);
  scene.add(points);
  const wave = pen(arcStrokes(ORIGIN, 1, UP, Math.PI * 2, 160), { color: palette.SIGNAL, span: 1 });
  return {
    apply(d, master) {
      material.opacity = d.field.opacity * master;
      wave.lines.scale.setScalar(Math.max(d.wave.radius, 1e-4));
      set(wave.m, { opacity: d.wave.opacity, burn: 1 }, master);
    },
  };
};

/** II · the drawing: monad hand, circles, vesica lens, the first line, seed, fruit, Metatron. */
export const drawingFigures = ({ palette, pen, set }) => {
  const seed = seedCenters();
  const vesica = firstVesica();
  const circle = (c, start) => pen(arcStrokes(c, R, start), { span: SPANS.CIRCLE });
  const center = circle(ORIGIN, UP);
  // Every petal circle passes through the center — so its pen starts there.
  const petals = seed.slice(1).map((p) => circle(p, toward(p, ORIGIN)));
  const hand = pen([{ a: ORIGIN, b: { x: R, y: 0 } }], { color: palette.SIGNAL, span: 1 });

  // The lens: the arc of each circle that lies inside the other.
  const [xa, xb] = vesica.crossings;
  const b = vesica.b;
  const lensA = pen(arcStrokes(ORIGIN, R, toward(ORIGIN, xb), toward(ORIGIN, xa) - toward(ORIGIN, xb), 48), { color: palette.SIGNAL, span: 1 });
  const lensB = pen(arcStrokes(b, R, toward(b, xa), (toward(b, xb) + Math.PI * 2 - toward(b, xa)) % (Math.PI * 2), 48), { color: palette.SIGNAL, span: 1 });

  // The first line: through the two crossings, drawn out from between them.
  const mid = { x: (xa.x + xb.x) / 2, y: (xa.y + xb.y) / 2 };
  const len = Math.hypot(xb.x - xa.x, xb.y - xa.y);
  const dir = { x: (xb.x - xa.x) / len, y: (xb.y - xa.y) / len };
  const reach = 1.6 * R;
  const chord = pen([
    { a: mid, b: { x: mid.x + dir.x * reach, y: mid.y + dir.y * reach } },
    { a: mid, b: { x: mid.x - dir.x * reach, y: mid.y - dir.y * reach } },
  ], { color: palette.SIGNAL_TINT, span: 1 });
  const apex = xa.x < 0 ? xa : xb;
  const triad = pen([{ a: ORIGIN, b }, { a: b, b: apex }, { a: apex, b: ORIGIN }], { color: palette.SIGNAL_TINT, span: 0.34 });

  // The fruit: twelve circles that walk out along the six rays.
  const fruit = fruitCenters().slice(1).map((target) => {
    const c = circle(ORIGIN, UP);
    const r = Math.hypot(target.x, target.y);
    return { ...c, ux: target.x / r, uy: target.y / r, r };
  });
  const fc = fruitCenters();
  const metatron = pen(metatronLines().map(([i, j]) => ({ a: fc[i], b: fc[j] })), { span: SPANS.METATRON });

  return {
    apply(d, master) {
      set(center.m, d.center, master);
      petals.forEach((p, i) => set(p.m, d.petals[i], master));
      hand.lines.rotation.z = d.radiusHand.angle;
      set(hand.m, { opacity: d.radiusHand.opacity, burn: 1 }, master);
      set(lensA.m, { opacity: d.lens.opacity, burn: 1 }, master);
      set(lensB.m, { opacity: d.lens.opacity, burn: 1 }, master);
      set(chord.m, { ...d.chord, burn: 0.6 }, master);
      set(triad.m, { ...d.triad, burn: 0.6 }, master);
      fruit.forEach((f) => {
        const r = R + (f.r - R) * d.fruit.reach;
        f.lines.position.set(f.ux * r, f.uy * r, 0);
        set(f.m, { opacity: d.fruit.opacity }, master);
      });
      set(metatron.m, { draw: d.metatron.u, opacity: d.metatron.opacity }, master);
    },
  };
};

/** III · the construct: the simplex, the family, the lattice — one group that grows to cosmic scale. */
export const constructFigures = ({ scene, palette, pen, mark, set }, { turn }) => {
  const group = new THREE.Group();
  scene.add(group);
  const solids = genesisFamily();
  // each solid in its own hand: tint, dash, and a mark on every vertex
  const solid = (s, key) => {
    const sig = signatureOf(key);
    const color = mixHex(palette.INK, palette.SIGNAL, sig.mix);
    return {
      ...pen(solidStrokes(s), { color, span: SPANS.SOLID, parent: group }),
      marks: mark(s.vertices, { color, shape: MARKS.indexOf(sig.mark), parent: group }),
      dash: sig.dashes,
    };
  };
  const figures = [
    [solid(solids.tetrahedra[0], 'tetrahedron'), 'tetrahedron'],
    [solid(solids.tetrahedra[1], 'stella'), 'stella'],
    [solid(solids.cube, 'cube'), 'cube'],
    [solid(solids.octahedron, 'octahedron'), 'octahedron'],
    [solid(solids.icosahedron, 'icosahedron'), 'icosahedron'],
    [solid(solids.dodecahedron, 'dodecahedron'), 'dodecahedron'],
  ];
  const lattice = pen(solidStrokes(genesisLattice()), { color: palette.INK, span: SPANS.SOLID, parent: group });
  return {
    apply(c, settle, master) {
      group.scale.setScalar(c.scale);
      group.rotation.z = turn * settle;
      for (const [f, key] of figures) {
        const s = c[key];
        const opacity = s.opacity * c.gain;
        set(f.m, { ...s, opacity, dash: f.dash }, master);
        // the marks arrive as the solid closes, never before its edges
        f.marks.m.uOpacity.value = opacity * master * Math.min(1, Math.max(0, (s.draw - 0.6) / 0.4));
        f.marks.m.uLift.value = s.lift;
        f.marks.m.uBurn.value = s.burn;
        f.marks.m.uSize.value = MARK_PX * f.marks.dpr();
      }
      set(lattice.m, { ...c.lattice, opacity: c.lattice.opacity * c.gain }, master);
    },
  };
};
