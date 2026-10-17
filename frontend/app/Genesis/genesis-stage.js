// genesis-stage.js — GENESIS's WebGL stage. // impure
//
// Owns the renderer, the camera and the kit every figure is drawn with, and
// builds the figures of all seven movements once (genesis-figures.js,
// genesis-figures-emanon.js). It owns no clock and no choreography:
// render(sceneAt(t)) is the only way anything moves, so a scrub, a playback
// and the sound engine all see the same frame.

import * as THREE from 'three';
import { tokenHex, mixHex, lumaOf, glowTexture, fitToCanvas } from '../BootIgnition/stage-palette.js';
import { GENESIS } from './genesis-geometry.js';
import { FOV_DEG } from './genesis-camera.js';
import { genesisShared, penMaterial, strokeGeometry, setPen as set } from './genesis-shaders.js';
import { fieldFigures, drawingFigures, constructFigures } from './genesis-figures.js';
import { emanonFigures } from './genesis-figures-emanon.js';

const MAX_DPR = 2;

/**
 * Create the genesis stage on a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {{ turn: number }} opts this install's resting turn (genesis-record restingTurn)
 * @returns {{ render: (state: object) => void, dispose: () => void }}
 */
export const createGenesisStage = (canvas, { turn }) => {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.01, 240);

  const SIGNAL = tokenHex('--signal', 0x5fe9ff);
  const INK = tokenHex('--color-white', 0xffffff);
  const GROUND = tokenHex('--color-void', 0x000000);
  const blending = lumaOf(GROUND) > 0.5 ? THREE.NormalBlending : THREE.AdditiveBlending;
  const palette = { INK, SIGNAL, SIGNAL_TINT: mixHex(SIGNAL, INK, 0.45) };
  const shared = genesisShared(SIGNAL);

  const disposables = [];
  const own = (x) => { disposables.push(x); return x; };
  const pen = (strokes, { color = INK, span, parent = scene }) => {
    const material = own(penMaterial(shared, { color, span, blending }));
    const lines = new THREE.LineSegments(own(strokeGeometry(strokes)), material);
    parent.add(lines);
    return { lines, m: material.uniforms };
  };
  const kit = { scene, palette, pen, set, own, blending };

  const field = fieldFigures(kit);
  const drawing = drawingFigures(kit);
  const construct = constructFigures(kit, { turn });
  const emanon = emanonFigures(kit);

  // The one light: the monad, then the nucleus, then Natura at the center.
  const SIGNAL_RGB = `${(SIGNAL >> 16) & 0xff},${(SIGNAL >> 8) & 0xff},${SIGNAL & 0xff}`;
  const glow = new THREE.Sprite(own(new THREE.SpriteMaterial({
    map: own(glowTexture(SIGNAL_RGB)), transparent: true, opacity: 0, blending, depthWrite: false,
  })));
  scene.add(glow);

  const unfit = fitToCanvas(canvas, renderer, camera, MAX_DPR);

  // impure — apply one frame of sceneAt(t)
  const render = (s) => {
    const master = 1 - 0.6 * s.emanon.fade;
    camera.position.set(s.camera.x, s.camera.y, s.camera.z);
    camera.lookAt(s.camera.target.x, s.camera.target.y, s.camera.target.z);
    field.apply(s.drawing, master);
    drawing.apply(s.drawing, master);
    construct.apply(s.construct, s.settle, master);
    emanon.apply(s.emanon, master);
    const p = shared.uPulses.value;
    p.set(-1, -1, -1, -1);
    // One set of fronts: the construct's first light, later the tree's
    // emanation out from the heart.
    [...s.construct.pulses, ...s.emanon.emanation].slice(-4).forEach((r, i) => p.setComponent(i, r));
    glow.material.opacity = s.glow * master;
    glow.scale.setScalar(GENESIS.R * (0.35 + 0.3 * s.glow));
    renderer.render(scene, camera);
  };

  return {
    render,
    // impure — no WebGL resource outlives the genesis
    dispose() {
      unfit();
      disposables.forEach((x) => x.dispose());
      renderer.dispose();
    },
  };
};
