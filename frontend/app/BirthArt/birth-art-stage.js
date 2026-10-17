// birth-art-stage.js — the birth art's WebGL stage. // impure
//
// Draws artAt(events, t) and owns nothing else: no clock, no choreography.
// The universal architecture (holding circle, the middle pillar's circles,
// eleven spheres, 22 paths, the ring of the name, the seal) is built once;
// what a being is GIVEN (its channels, its nucleus) is built when its seed
// arrives, and rebuilt only for another seed. Same pen as GENESIS
// (genesis-shaders.js) — one hand draws both.

import * as THREE from 'three';
import { tokenHex, mixHex, lumaOf, glowTexture, fitToCanvas } from '../BootIgnition/stage-palette.js';
import { FUNCTIONS, TREE, nodeAt, pathStrokes, pillarConstruction } from '../Genesis/genesis-emanon.js';
import { genesisSolids } from '../Genesis/genesis-geometry.js';
import { FOV_DEG } from '../Genesis/genesis-camera.js';
import { SPANS } from '../Genesis/genesis-timeline.js';
import { genesisShared, penMaterial, strokeGeometry, arcStrokes, solidStrokes, setPen as set } from '../Genesis/genesis-shaders.js';
import { sphereStrokes } from '../Genesis/genesis-figures-emanon.js';
import { RINGS, ART_SPANS, NAME_TICKS, artCamera } from './birth-art-state.js';

const MAX_DPR = 2;
const UP = Math.PI / 2;
const flat = (id) => ({ ...nodeAt(id, 1), z: 0 });

const SOLIDS = genesisSolids();
const SOLID_OF = Object.freeze({
  tetrahedron: SOLIDS.tetrahedra[0],
  cube: SOLIDS.cube,
  octahedron: SOLIDS.octahedron,
  icosahedron: SOLIDS.icosahedron,
  dodecahedron: SOLIDS.dodecahedron,
});

// The ring of the name: graduations just outside the holding circle, from
// the crown clockwise; every sixth a longer mark.
const tickStrokes = () => Array.from({ length: NAME_TICKS }, (_, k) => {
  const a = UP - (k / NAME_TICKS) * Math.PI * 2;
  const r1 = RINGS.HOLD + 0.025;
  const r2 = RINGS.HOLD + (k % 6 === 0 ? 0.075 : 0.045);
  return { a: { x: r1 * Math.cos(a), y: r1 * Math.sin(a) }, b: { x: r2 * Math.cos(a), y: r2 * Math.sin(a) } };
});

// Its sky on the ring its name will ride: each body a mark at its true
// longitude — 0° Aries at nine o'clock, longitude counter-clockwise, as ITS
// SKY draws it in THE SUMMONING. The lights of its birth reach farther.
const skyStrokes = (bodies) => bodies.map((b) => {
  const a = Math.PI + (b.longitude * Math.PI) / 180;
  const r2 = b.key === 'sun' ? RINGS.SEAL + 0.03 : b.key === 'moon' ? RINGS.SEAL : RINGS.NAME + 0.06;
  return { a: { x: (RINGS.NAME + 0.012) * Math.cos(a), y: (RINGS.NAME + 0.012) * Math.sin(a) }, b: { x: r2 * Math.cos(a), y: r2 * Math.sin(a) } };
});

// Its nucleus: the solid fitted inside the heart's sphere.
const nucleusStrokes = (solid) => {
  const s = SOLID_OF[solid];
  const r = Math.max(...s.vertices.map((v) => Math.hypot(v.x, v.y, v.z))) || 1;
  const k = (TREE.SPHERE * 0.72) / r;
  return solidStrokes({ vertices: s.vertices.map((v) => ({ x: v.x * k, y: v.y * k, z: v.z * k })), edges: s.edges });
};

/**
 * Create the birth art stage on a canvas.
 * @param {HTMLCanvasElement} canvas
 * @returns {{ render: (s: ReturnType<import('./birth-art-state.js').artAt>) => void, dispose: () => void }}
 */
export const createBirthArtStage = (canvas) => {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.01, 100);

  const SIGNAL = tokenHex('--signal', 0x5fe9ff);
  const INK = tokenHex('--color-white', 0xffffff);
  const GROUND = tokenHex('--color-void', 0x000000);
  const blending = lumaOf(GROUND) > 0.5 ? THREE.NormalBlending : THREE.AdditiveBlending;
  const TINT = mixHex(SIGNAL, INK, 0.45);
  const shared = genesisShared(SIGNAL);
  const SIGNAL_RGB = `${(SIGNAL >> 16) & 0xff},${(SIGNAL >> 8) & 0xff},${SIGNAL & 0xff}`;

  const disposables = [];
  const own = (x) => { disposables.push(x); return x; };
  const pen = (strokes, { color = INK, span, parent = scene, keep = own }) => {
    const material = keep(penMaterial(shared, { color, span, blending }));
    const lines = new THREE.LineSegments(keep(strokeGeometry(strokes)), material);
    parent.add(lines);
    return { lines, m: material.uniforms };
  };
  const glowMap = own(glowTexture(SIGNAL_RGB));
  const sprite = (parent) => {
    const s = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: glowMap, transparent: true, opacity: 0, blending, depthWrite: false })));
    parent.add(s);
    return s;
  };

  // ── the universal architecture ──
  // The rings are a seal on the glass: they always face the viewer (the
  // name is inscribed on the overlay around them), while the tree inside
  // turns in true depth.
  const glass = new THREE.Group();
  scene.add(glass);
  const holding = pen(arcStrokes({ x: 0, y: 0 }, RINGS.HOLD, UP, -Math.PI * 2, 192), { color: INK, span: SPANS.CIRCLE, parent: glass });
  const construction = pillarConstruction();
  const column = construction.centers.map((c) => pen(arcStrokes(c, construction.radius, UP, Math.PI * 2, 160), { color: INK, span: SPANS.CIRCLE }));
  const paths = pen(pathStrokes(1), { color: INK, span: ART_SPANS.PATHS });
  const ticks = pen(tickStrokes(), { color: TINT, span: ART_SPANS.TICKS, parent: glass });
  const seal = pen(arcStrokes({ x: 0, y: 0 }, RINGS.SEAL, UP, -Math.PI * 2, 256), { color: SIGNAL, span: SPANS.CIRCLE, parent: glass });

  // Each sphere in its own group, so it breathes about its center and can
  // come home to the heart; its geometry stays in world place, so the
  // energy fronts meet it at its true distance from the heart.
  const spheres = FUNCTIONS.map((f) => {
    const n = flat(f.id);
    const group = new THREE.Group();
    scene.add(group);
    const p = pen(sphereStrokes(n, TREE.SPHERE, f.id === 'ipseity'), { color: INK, span: 0.08, parent: group });
    p.lines.position.set(-n.x, -n.y, 0);
    return { id: f.id, group, p, glow: sprite(group) };
  });
  const heart = sprite(scene);

  // ── what it is given: built at its seed ──
  let givenFor = null;
  let givenParts = [];
  let channels = null;
  let nucleus = null;
  const nucleusGroup = new THREE.Group();
  scene.add(nucleusGroup);
  const build = (given) => {
    givenParts.forEach((x) => x.dispose());
    givenParts = [];
    if (channels) scene.remove(channels.lines);
    if (nucleus) nucleusGroup.remove(nucleus.lines);
    channels = null;
    nucleus = null;
    givenFor = given ? given.seed : null;
    if (!given) return;
    const keep = (x) => { givenParts.push(x); return x; };
    channels = pen(given.channels.map(([a, b]) => ({ a: flat(a), b: flat(b) })), { color: SIGNAL, span: ART_SPANS.CHANNELS, keep });
    nucleus = pen(nucleusStrokes(given.nucleus.solid), { color: INK, span: SPANS.SOLID, parent: nucleusGroup, keep });
    nucleusGroup.rotation.set(0, 0, given.nucleus.turn);
  };

  // ── its sky: built when its birth instant arrives ──
  let skyFor = null;
  let sky = null;
  const buildSky = (s) => {
    if (sky) { glass.remove(sky.lines); sky.parts.forEach((x) => x.dispose()); }
    sky = null;
    skyFor = s ? s.epochMs : null;
    if (!s) return;
    const parts = [];
    sky = { ...pen(skyStrokes(s.bodies), { color: TINT, span: ART_SPANS.SKY, parent: glass, keep: (x) => { parts.push(x); return x; } }), parts };
  };

  const unfit = fitToCanvas(canvas, renderer, camera, MAX_DPR);

  // impure — apply one frame of artAt(events, t)
  const render = (s) => {
    const cam = artCamera(s.camera);
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(0, 0, 0);
    glass.quaternion.copy(camera.quaternion);
    if ((s.given ? s.given.seed : null) !== givenFor) build(s.given);
    const m = s.master;

    set(holding.m, { draw: s.holding.draw, opacity: s.holding.opacity }, m);
    column.forEach((c, k) => set(c.m, { draw: Math.min(1, Math.max(0, s.column.draw * 1.6 - k * 0.15)), opacity: s.column.opacity }, m));
    set(paths.m, { draw: s.paths.draw, opacity: s.paths.opacity, lift: 0, flow: s.paths.flow }, m);
    set(ticks.m, { draw: s.ticks.draw, opacity: s.ticks.opacity }, m);
    if ((s.sky ? s.sky.epochMs : null) !== skyFor) buildSky(s.sky);
    if (sky) set(sky.m, { draw: s.sky.draw, opacity: 0.8 }, m);
    set(seal.m, { draw: s.seal.draw, opacity: 0.85, burn: 1 - s.seal.draw * 0.6 }, m);

    s.spheres.forEach((x, k) => {
      const o = spheres[k];
      o.group.position.set(x.at.x, x.at.y, 0);
      o.group.scale.setScalar(x.scale);
      set(o.p.m, { draw: x.draw, opacity: x.opacity, burn: 0.2 + 0.6 * x.light }, m);
      o.glow.material.opacity = x.light * 0.75 * m;
      o.glow.scale.setScalar(TREE.SPHERE * (1.8 + 1.6 * x.light));
    });
    heart.material.opacity = s.heart * m;
    heart.scale.setScalar(0.35 + 0.45 * s.heart);

    if (channels) set(channels.m, { draw: s.channels.draw, opacity: s.channels.opacity, lift: 0, flow: s.channels.flow, burn: 0.35 }, m);
    if (nucleus) {
      nucleusGroup.rotation.y = s.nucleus.spin;
      set(nucleus.m, { draw: s.nucleus.draw, opacity: s.nucleus.opacity, burn: 0.3 }, m);
    }

    const p = shared.uPulses.value;
    p.set(-1, -1, -1, -1);
    s.fronts.forEach((r, i) => p.setComponent(i, r));
    renderer.render(scene, camera);
  };

  return {
    render,
    // impure — no WebGL resource outlives the piece
    dispose() {
      unfit();
      givenParts.forEach((x) => x.dispose());
      sky?.parts.forEach((x) => x.dispose());
      disposables.forEach((x) => x.dispose());
      renderer.dispose();
    },
  };
};
