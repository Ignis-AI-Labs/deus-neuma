// gyro-shaders.js — the construct's two materials. // impure (Three objects)
//
// ONE line material does three jobs on the GPU, so the choreography costs
// the main thread nothing per frame beyond a handful of uniforms:
//   DRAW-IN — every edge carries its position along itself (aAlong 0→1) and
//     its place in its solid's sweep (aOrder 0..1, the edge midpoint's angle
//     around the axis): uDraw 0→1 draws the solid edge by edge, a radar
//     sweep — structure snaps into being, it never fades in.
//   ENERGY — up to four pulse fronts (uPulses, radii from the center) run
//     out through the whole construct: an edge burns toward the signal as a
//     front passes its point's true distance from the center. A pulse is
//     fired only by a real event (a check declaring), never on a timer.
//   DEPTH — a fog band that rides the camera dims the far hemisphere.
// The pulse uniform is SHARED by reference across every material, so one
// write per frame moves the energy through all of them.
import * as THREE from 'three';

const LINE_VERTEX = /* glsl */ `
  attribute float aAlong;
  attribute float aOrder;
  varying float vAlong;
  varying float vOrder;
  varying float vRadius;
  varying float vDepth;
  void main() {
    vAlong = aAlong;
    vOrder = aOrder;
    vRadius = length(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

export const PULSE_GLSL = /* glsl */ `
  uniform vec4 uPulses;
  uniform float uPulseWidth;
  float energyAt(float r) {
    float e = 0.0;
    for (int i = 0; i < 4; i++) {
      float R = uPulses[i];
      if (R > 0.0) {
        float d = (r - R) / uPulseWidth;
        e += exp(-d * d) * (1.0 - smoothstep(0.85, 1.25, R));
      }
    }
    return clamp(e, 0.0, 1.0);
  }
`;

const LINE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSignal;
  uniform float uOpacity;
  uniform float uDraw;
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vAlong;
  varying float vOrder;
  varying float vRadius;
  varying float vDepth;
  ${PULSE_GLSL}
  void main() {
    float local = clamp(uDraw * 2.0 - vOrder, 0.0, 1.0);
    if (vAlong > local) discard;
    float e = energyAt(vRadius);
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    float a = (uOpacity + e * 0.75) * (1.0 - fog);
    gl_FragColor = vec4(mix(uColor, uSignal, e), a);
  }
`;

const POINT_VERTEX = /* glsl */ `
  uniform float uSize;
  varying float vRadius;
  varying float vDepth;
  void main() {
    vRadius = length(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_PointSize = uSize / max(vDepth, 0.1);
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSignal;
  uniform float uOpacity;
  uniform float uDraw;
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vRadius;
  varying float vDepth;
  ${PULSE_GLSL}
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float disc = 1.0 - smoothstep(0.3, 0.5, length(c));
    float e = energyAt(vRadius);
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    float a = (uOpacity + e) * disc * uDraw * (1.0 - fog);
    gl_FragColor = vec4(mix(uColor, uSignal, e), a);
  }
`;

/**
 * The shared uniforms every construct material reads by reference: the
 * pulse fronts, the fog band, the signal color.
 * @param {number} signalHex
 */
export const sharedUniforms = (signalHex) => ({
  uPulses: { value: new THREE.Vector4(-1, -1, -1, -1) },
  uPulseWidth: { value: 0.07 },
  uFogNear: { value: 1 },
  uFogFar: { value: 10 },
  uSignal: { value: new THREE.Color(signalHex) },
});

/**
 * A construct line material: color, base opacity (the master intensity
 * scales from it), its own draw-in, and the shared energy/fog uniforms.
 */
export const energyLine = (shared, { color, opacity, blending }) => {
  const m = new THREE.ShaderMaterial({
    vertexShader: LINE_VERTEX,
    fragmentShader: LINE_FRAGMENT,
    uniforms: {
      ...shared,
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uDraw: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending,
  });
  m.userData.baseOpacity = opacity;
  return m;
};

/** The lattice's node points: flash as an energy front reaches them. */
export const energyPoints = (shared, { color, opacity, size, blending }) => {
  const m = new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    uniforms: {
      ...shared,
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uDraw: { value: 0 },
      uSize: { value: size },
    },
    transparent: true,
    depthWrite: false,
    blending,
  });
  m.userData.baseOpacity = opacity;
  return m;
};

/**
 * Segment geometry for the energy line: each edge [a, b] becomes one
 * segment carrying aAlong (0 at a, 1 at b) and aOrder (its midpoint's angle
 * around the vertical axis, 0..1 — the draw-in's radar sweep). Pure data in,
 * a BufferGeometry out.
 * @param {Array<{x:number,y:number,z:number}>} vertices
 * @param {Array<[number, number]>} edges
 */
export const edgeGeometry = (vertices, edges) => {
  const position = new Float32Array(edges.length * 6);
  const along = new Float32Array(edges.length * 2);
  const order = new Float32Array(edges.length * 2);
  edges.forEach(([i, j], e) => {
    const a = vertices[i];
    const b = vertices[j];
    position.set([a.x, a.y, a.z, b.x, b.y, b.z], e * 6);
    along.set([0, 1], e * 2);
    const angle = (Math.atan2(a.z + b.z, a.x + b.x) + Math.PI) / (2 * Math.PI);
    order.set([angle, angle], e * 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  g.setAttribute('aOrder', new THREE.BufferAttribute(order, 1));
  return g;
};

/**
 * A circle as segments — radius r in the XZ plane, then placed by `matrix`
 * (a THREE.Matrix4: tilt, offset) and BAKED into the vertices, so every
 * vertex's length is its true distance from the construct's center (the
 * energy front reads that length). Each segment's order is its place around
 * the ring, so it draws itself around.
 * @param {number} r
 * @param {number} [segments]
 * @param {THREE.Matrix4} [matrix]
 */
export const ringGeometry = (r, segments = 128, matrix = null) => {
  const v = new THREE.Vector3();
  const vertices = Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    v.set(r * Math.cos(a), 0, r * Math.sin(a));
    if (matrix) v.applyMatrix4(matrix);
    return { x: v.x, y: v.y, z: v.z };
  });
  const edges = vertices.map((_, i) => [i, (i + 1) % segments]);
  const g = edgeGeometry(vertices, edges);
  const order = g.getAttribute('aOrder');
  for (let i = 0; i < segments; i++) order.setX(i * 2, i / segments).setX(i * 2 + 1, i / segments);
  return g;
};

/**
 * A sphere READ — three orthogonal great circles — centered at `center`,
 * baked (see ringGeometry). The lightest true-volume drawing of a sphere.
 */
export const sphereReadGeometries = (r, center, segments = 64) => {
  const at = new THREE.Matrix4().makeTranslation(center.x, center.y, center.z);
  const tilt = (x, z) => at.clone().multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, 0, z)));
  return [
    ringGeometry(r, segments, at),
    ringGeometry(r, segments, tilt(Math.PI / 2, 0)),
    ringGeometry(r, segments, tilt(0, Math.PI / 2)),
  ];
};
