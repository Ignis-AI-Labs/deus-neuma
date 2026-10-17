// genesis-shaders.js — GENESIS's pen. // impure (Three objects)
//
// One line material draws every figure of the first-ever opening:
//   THE PEN — a group of strokes draws under one uniform (uDraw 0..1); stroke
//     k runs over its own window of it by the SAME formula the captions count
//     with (genesis-timeline.js strokeProgress), so the GPU and the counters
//     can never disagree about what is drawn. Each stroke also draws along
//     itself (aAlong 0→1): a pen, not a fade.
//   THE LIFT — uLift scales every vertex's depth: at 0 a solid lies exactly
//     on its projection (Metatron's lines), at 1 it stands at true depth.
//   THE BURN — uBurn mixes the hairline toward the signal: a figure is lit
//     while it forms and cools once it holds.
//   ENERGY — the construct's fronts (gyro-shaders PULSE_GLSL, shared).
//   FLOW — uFlow ≥ 0 sends a head of light along every stroke, each on its
//     own phase (its order), so a whole channel system is visibly carrying
//     energy rather than glowing all at once.
import * as THREE from 'three';
import { PULSE_GLSL } from '../BootIgnition/gyro-shaders.js';

const VERTEX = /* glsl */ `
  attribute float aAlong;
  attribute float aOrder;
  uniform float uLift;
  varying float vAlong;
  varying float vOrder;
  varying float vRadius;
  void main() {
    vAlong = aAlong;
    vOrder = aOrder;
    vec3 p = vec3(position.xy, position.z * uLift);
    vRadius = length(p);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSignal;
  uniform float uOpacity;
  uniform float uDraw;
  uniform float uSpan;
  uniform float uBurn;
  uniform float uFlow;
  varying float vAlong;
  varying float vOrder;
  varying float vRadius;
  ${PULSE_GLSL}
  void main() {
    float local = clamp((uDraw - vOrder * (1.0 - uSpan)) / uSpan, 0.0, 1.0);
    if (local <= 0.0 || vAlong > local) discard;
    float e = energyAt(vRadius);
    float f = 0.0;
    if (uFlow >= 0.0) {
      float d = vAlong - fract(uFlow + vOrder * 7.0);
      f = exp(-(d * d) / 0.006);
    }
    float heat = max(max(uBurn, e), f);
    gl_FragColor = vec4(mix(uColor, uSignal, heat), uOpacity * (1.0 + e * 0.8 + f * 2.2));
  }
`;

/** The shared uniforms: energy fronts and the signal color. */
export const genesisShared = (signalHex) => ({
  uPulses: { value: new THREE.Vector4(-1, -1, -1, -1) },
  uPulseWidth: { value: 0.07 },
  uSignal: { value: new THREE.Color(signalHex) },
});

/** A pen material for one group of strokes. */
export const penMaterial = (shared, { color, span, blending }) => new THREE.ShaderMaterial({
  vertexShader: VERTEX,
  fragmentShader: FRAGMENT,
  uniforms: {
    ...shared,
    uColor: { value: new THREE.Color(color) },
    uOpacity: { value: 0 },
    uDraw: { value: 0 },
    uSpan: { value: span },
    uBurn: { value: 0 },
    uLift: { value: 1 },
    uFlow: { value: -1 },
  },
  transparent: true,
  depthWrite: false,
  blending,
});

/** impure — set one pen's uniforms for a frame; `master` scales its opacity. */
export const setPen = (u, { draw = 1, opacity = 0, burn = 0, lift = 1, flow = -1 }, master) => {
  u.uDraw.value = draw;
  u.uOpacity.value = opacity * master;
  u.uBurn.value = burn;
  u.uLift.value = lift;
  u.uFlow.value = flow;
};

/**
 * Stroke geometry: each stroke {a, b} becomes one segment carrying aAlong
 * (0 at a, 1 at b) and aOrder (its place k/n in the group's draw).
 * @param {Array<{a:{x,y,z?}, b:{x,y,z?}}>} strokes in draw order
 */
export const strokeGeometry = (strokes) => {
  const n = strokes.length;
  const position = new Float32Array(n * 6);
  const along = new Float32Array(n * 2);
  const order = new Float32Array(n * 2);
  strokes.forEach(({ a, b }, k) => {
    position.set([a.x, a.y, a.z || 0, b.x, b.y, b.z || 0], k * 6);
    along.set([0, 1], k * 2);
    order.set([k / n, k / n], k * 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  g.setAttribute('aOrder', new THREE.BufferAttribute(order, 1));
  return g;
};

/**
 * A circle (or arc) as pen strokes in the genesis plane, drawn from
 * `start` counter-clockwise through `sweep` radians. Pure data out.
 */
export const arcStrokes = (center, r, start, sweep = Math.PI * 2, segments = 128) =>
  Array.from({ length: segments }, (_, i) => {
    const a0 = start + (sweep * i) / segments;
    const a1 = start + (sweep * (i + 1)) / segments;
    return {
      a: { x: center.x + r * Math.cos(a0), y: center.y + r * Math.sin(a0) },
      b: { x: center.x + r * Math.cos(a1), y: center.y + r * Math.sin(a1) },
    };
  });

/**
 * A solid's edges as strokes, ordered as a radar sweep around the camera
 * axis (the midpoint's angle), so it draws itself around. Pure data out.
 */
export const solidStrokes = (solid) =>
  solid.edges
    .map(([i, j]) => ({ a: solid.vertices[i], b: solid.vertices[j] }))
    .map((s) => ({ ...s, angle: Math.atan2(s.a.y + s.b.y, s.a.x + s.b.x) }))
    .sort((p, q) => p.angle - q.angle);
