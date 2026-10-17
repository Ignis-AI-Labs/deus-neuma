// armillary-stage.js — THE ARMILLARY's WebGL stage: the Deus Neuma logo as
// a lit object in space, its sacred figures drawn in light around it. // impure
//
// Like GENESIS's stage it owns no clock and no input: render(state, view) is
// the only way anything moves, so THE IGNITION (a pure timeline), the gateway
// (an interactive controller) and a scrub all see the same frame. The view
// places it (armillary-layout.js): the still point at (cx, cy), the
// meridian's true silhouette `markPx` across.
//
// The mark is solid ink — the logo's own weights as tubes, the axis a steel
// spindle, the core a sphere — lit so it reads as an object, fogged so its
// far half recedes as the logo's hairline back does. The figures
// (armillary-geometry.js) are energy lines (gyro-shaders): they draw
// themselves in a radar sweep and carry fronts out from the core.

import * as THREE from 'three';
import { tokenHex, mixHex, lumaOf, glowTexture } from '../BootIgnition/stage-palette.js';
import { sharedUniforms, energyLine, edgeGeometry, ringGeometry } from '../BootIgnition/gyro-shaders.js';
import { ARMILLARY, cardinalOctahedron, dualCube, equatorSeed, nucleusPair } from './armillary-geometry.js';

const MAX_DPR = 2;
const FOV_DEG = 30;
const HALF_FOV_TAN = Math.tan((FOV_DEG * Math.PI) / 180 / 2);
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const DIVE_DISTANCE = 0.32; // inside the meridian, at the core: the threshold crossed
const PACKET_PERIOD_S = { meridian: 7.5, equator: 11 }; // light travels the rings

// The camera distance at which a sphere of radius R shows a silhouette of
// `px` pixels in a frame `fullH` pixels tall. Pure.
const distanceFor = (R, px, fullH) => R / Math.sin(Math.atan((px * HALF_FOV_TAN) / (fullH / 2)));

// A lit ink material that draws itself around its ring: fragments past the
// sweep (radians from `start`, clockwise as the eye reads it) are discarded.
const sweepMaterial = (params, start) => {
  const m = new THREE.MeshStandardMaterial(params);
  const uSweep = { value: 1 };
  m.userData.uSweep = uSweep;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSweep = uSweep;
    shader.uniforms.uStart = { value: start };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSweepLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSweepLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSweepLocal;\nuniform float uSweep;\nuniform float uStart;')
      .replace('void main() {', 'void main() {\n  float sweepD = mod(uStart - atan(vSweepLocal.y, vSweepLocal.x), 6.2831853);\n  if (sweepD > uSweep * 6.2831853 + 0.001) discard;');
  };
  return m;
};

/**
 * Create the armillary's stage on a canvas.
 * @param {HTMLCanvasElement} canvas
 * @returns {{ render: (s: object, view: { w: number, h: number, cx: number, cy: number, markPx: number }) => void,
 *   dispose: () => void }}
 */
export const createArmillaryStage = (canvas) => {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.02, 60);

  const SIGNAL = tokenHex('--signal', 0x5fe9ff);
  const INK = tokenHex('--color-white', 0xffffff);
  const GROUND = tokenHex('--color-void', 0x000000);
  const BLEND = lumaOf(GROUND) > 0.5 ? THREE.NormalBlending : THREE.AdditiveBlending;
  const SIGNAL_TINT = mixHex(SIGNAL, INK, 0.45);
  const SIGNAL_RGB = `${(SIGNAL >> 16) & 0xff},${(SIGNAL >> 8) & 0xff},${SIGNAL & 0xff}`;
  scene.fog = new THREE.Fog(GROUND, 1, 10);

  const owned = [];
  const own = (x) => { owned.push(x); return x; };

  // the light: a key from upper-left-front, a cool rim from behind in the signal
  scene.add(new THREE.AmbientLight(INK, 0.5));
  const key = new THREE.DirectionalLight(INK, 1.6);
  key.position.set(-2.5, 3, 4);
  const rim = new THREE.DirectionalLight(SIGNAL, 0.9);
  rim.position.set(3, -1.5, -3);
  scene.add(key, rim);

  // presence (the pointer's pull) → lean (the tilt, in the picture plane) →
  // tilt (seen from above the equator) → spin (the turn about the axis)
  const presence = new THREE.Group();
  const lean = new THREE.Group();
  const tilt = new THREE.Group();
  const spin = new THREE.Group();
  presence.add(lean);
  lean.add(tilt);
  tilt.add(spin);
  scene.add(presence);

  const inkParams = { color: INK, emissive: INK, emissiveIntensity: 0.42, roughness: 0.32, metalness: 0.35 };
  const inkMaterial = own(new THREE.MeshStandardMaterial(inkParams));

  // THE MERIDIAN — the whole: one ring in the plane of the axis, drawn from the top
  const meridianMaterial = own(sweepMaterial(inkParams, Math.PI / 2));
  const meridian = new THREE.Mesh(own(new THREE.TorusGeometry(ARMILLARY.RADIUS, ARMILLARY.RING_TUBE, 14, 220)), meridianMaterial);
  spin.add(meridian);

  // THE EQUATOR — turns in from the meridian's plane to its own, perpendicular to the axis
  const equatorMaterial = own(sweepMaterial(inkParams, Math.PI));
  const equatorPivot = new THREE.Group();
  equatorPivot.add(new THREE.Mesh(own(new THREE.TorusGeometry(ARMILLARY.RADIUS, ARMILLARY.EQUATOR_TUBE, 14, 220)), equatorMaterial));
  tilt.add(equatorPivot);

  // THE AXIS — a steel spindle reaching its true points; THE CORE — the still point
  const half = ARMILLARY.AXIS_HALF_WIDTH;
  const reach = ARMILLARY.AXIS_REACH;
  const axis = new THREE.Mesh(own(new THREE.LatheGeometry([
    new THREE.Vector2(0, -reach), new THREE.Vector2(half, 0), new THREE.Vector2(0, reach),
  ], 28)), inkMaterial);
  spin.add(axis);
  const core = new THREE.Mesh(own(new THREE.SphereGeometry(ARMILLARY.CORE, 40, 20)), inkMaterial);
  tilt.add(core);

  // THE FIGURES — energy lines on the shared fronts
  const shared = sharedUniforms(SIGNAL);
  shared.uPulseWidth.value = 0.09;
  const figures = [];
  const figure = (geometry, opacity, color = INK, parent = spin) => {
    const m = own(energyLine(shared, { color, opacity, blending: BLEND }));
    parent.add(new THREE.LineSegments(own(geometry), m));
    figures.push(m);
    return m;
  };
  const octa = cardinalOctahedron();
  figure(edgeGeometry(octa.vertices, octa.edges), 0.3);
  const cube = dualCube();
  figure(edgeGeometry(cube.vertices, cube.edges), 0.16);
  const seed = equatorSeed();
  seed.centres.forEach((c) => figure(ringGeometry(seed.radius, 96, new THREE.Matrix4().makeTranslation(c.x, c.y, c.z)), 0.17, SIGNAL_TINT));
  const nucleus = nucleusPair();
  const icosaMaterial = figure(edgeGeometry(nucleus.icosahedron.vertices, nucleus.icosahedron.edges), 0.7, SIGNAL);
  figure(edgeGeometry(nucleus.dodecahedron.vertices, nucleus.dodecahedron.edges), 0.35);

  // the one glow at the still point, and the light travelling the two rings
  const glowMap = own(glowTexture(SIGNAL_RGB));
  const sprite = (parent) => {
    const s = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: glowMap, transparent: true, opacity: 0, blending: BLEND, depthWrite: false })));
    parent.add(s);
    return s;
  };
  const glow = sprite(tilt);
  const meridianPacket = sprite(spin);
  const equatorPacket = sprite(equatorPivot);

  let size = '';

  // impure — one frame of the armillary's state, placed by the view
  const render = (s, { w, h, cx, cy, markPx }) => {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const sizeKey = `${w}x${h}@${dpr}`;
    if (sizeKey !== size) {
      size = sizeKey;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
    }
    // the still point sits at (cx, cy): a window of a larger frame centred there
    const offX = Math.abs(w / 2 - cx);
    const offY = Math.abs(h / 2 - cy);
    const fullW = w + 2 * offX;
    const fullH = h + 2 * offY;
    camera.aspect = fullW / fullH;
    camera.setViewOffset(fullW, fullH, cx < w / 2 ? 2 * offX : 0, cy < h / 2 ? 2 * offY : 0, w, h);
    const rest = distanceFor(ARMILLARY.RADIUS, markPx, fullH);
    const d = rest + (DIVE_DISTANCE - rest) * s.dive;
    camera.position.set(0, 0, d);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    scene.fog.near = d - 0.35;
    scene.fog.far = d + 2.4;
    shared.uFogNear.value = d - 0.2;
    shared.uFogFar.value = d + 2.6;

    presence.rotation.set(s.presence.y, s.presence.x, 0);
    lean.rotation.z = s.lean * DEG;
    tilt.rotation.x = ARMILLARY.ELEVATION;
    spin.rotation.y = s.spin;

    core.scale.setScalar(Math.max(1e-3, s.point));
    axis.scale.set(1, Math.max(1e-3, s.axis), 1);
    meridian.visible = s.meridian > 0;
    meridianMaterial.userData.uSweep.value = s.meridian;
    const turn = s.equator * s.equator * (3 - 2 * s.equator);
    equatorPivot.rotation.x = (Math.PI / 2) * turn;
    equatorPivot.visible = s.equator > 0;
    equatorMaterial.userData.uSweep.value = Math.min(1, s.equator * 1.4);
    // charged (the witness reaches for the threshold): the ink takes the
    // signal's light — slowly (charge is damped); a front never tints the ink
    const lit = Math.min(1, s.charge * 0.5);
    [inkMaterial, meridianMaterial, equatorMaterial].forEach((m) => {
      m.emissive.setHex(mixHex(INK, SIGNAL, lit));
      m.emissiveIntensity = 0.42 + 0.25 * lit;
    });

    const p = shared.uPulses.value;
    p.set(-1, -1, -1, -1);
    s.pulses.slice(-4).forEach((r, i) => p.setComponent(i, r));
    const gain = s.intensity * (1 + 0.6 * s.charge);
    for (const m of figures) {
      m.uniforms.uDraw.value = s.geometry;
      m.uniforms.uOpacity.value = m.userData.baseOpacity * gain;
    }
    const breath = 0.5 + 0.5 * Math.sin((s.t * TAU) / 6);
    icosaMaterial.uniforms.uOpacity.value = (0.35 + 0.3 * breath + 0.35 * s.flare + 0.3 * s.charge) * s.intensity * s.geometry;
    // the glow and the travelling light give way as the camera dives — the
    // core never fills the frame with light (the no-flash law)
    glow.material.opacity = (0.25 + 0.2 * breath + 0.3 * s.flare + 0.25 * s.charge) * s.intensity * s.point * (1 - s.dive);
    glow.scale.setScalar(0.5 + 0.12 * breath + 0.15 * s.flare + 0.12 * s.charge);

    const travel = (packet, period, phase) => {
      const a = phase - (s.t / period) * TAU;
      packet.position.set(Math.cos(a) * ARMILLARY.RADIUS, Math.sin(a) * ARMILLARY.RADIUS, 0);
      packet.material.opacity = s.geometry * s.intensity * (0.55 + 0.45 * s.charge) * (1 - s.dive);
      packet.scale.setScalar(0.16 + 0.08 * s.charge);
    };
    travel(meridianPacket, PACKET_PERIOD_S.meridian, Math.PI / 2);
    travel(equatorPacket, PACKET_PERIOD_S.equator, Math.PI);
    renderer.render(scene, camera);
  };

  return {
    render,
    // impure — no WebGL resource outlives the stage
    dispose() {
      owned.forEach((x) => x.dispose());
      renderer.dispose();
    },
  };
};
