// genesis-state.js — what GENESIS shows at time t. Pure.
//
// sceneAt(t) is the whole opening as data, joined from its movements: the
// field and the drawing (genesis-state-drawing), the construct at cosmic
// scale (genesis-state-construct), the Emanon architecture and the offering
// (genesis-state-emanon), and what the System says (genesis-captions). The
// WebGL stage only applies it; the overlay only prints it. Because both read
// one function of one clock, a frame scrubbed to, a frame played to and a
// frame the sound engine is scoring at are the same frame.

import { partProgress } from './genesis-timeline.js';
import { genesisSolids } from './genesis-geometry.js';
import { cameraAt } from './genesis-camera.js';
import { drawingAt } from './genesis-state-drawing.js';
import { constructAt } from './genesis-state-construct.js';
import { emanonAt } from './genesis-state-emanon.js';
import { captionAt } from './genesis-captions.js';

const SOLIDS = genesisSolids();

/**
 * The genesis at time t (ms). Pure.
 * @param {number} t
 */
export const sceneAt = (t) => {
  const drawing = drawingAt(t);
  const construct = constructAt(t);
  const emanon = emanonAt(t);
  return {
    t,
    camera: cameraAt(t),
    drawing,
    construct,
    emanon,
    glow: Math.min(1, drawing.monadGlow + construct.nucleusGlow + 0.8 * emanon.heart + 0.3 * emanon.emanationGlow),
    // The construct turns into this install's resting turn as the record is
    // inscribed (the stage multiplies by genesis-record restingTurn).
    settle: partProgress('offering', 'record', t),
    counters: { ...drawing.counters, paths: emanon.paths.drawn, tree: emanon.channels.drawn },
    caption: captionAt(t, {
      ...drawing.counters,
      paths: emanon.paths.drawn,
      tree: emanon.channels.drawn,
      solids: SOLIDS,
      icosaDone: construct.icosahedron.draw >= 1,
      dodecaDone: construct.dodecahedron.draw >= 1,
    }),
  };
};
