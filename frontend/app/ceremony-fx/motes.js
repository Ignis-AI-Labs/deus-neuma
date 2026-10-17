// motes.js — pure mote mechanics for the ceremony particle field.
// The void at rest is monochrome: one mote in eight carries signal.

/**
 * A new mote from three random draws, placed within a w×h field.
 * @param {() => number} rand — a [0,1) source, injected so tests are real
 * @param {number} w
 * @param {number} h
 * @returns {{x:number,y:number,vx:number,vy:number,size:number,opacity:number,signal:boolean}}
 */
export const spawnMote = (rand, w, h) => ({
  x: rand() * w,
  y: rand() * h,
  vx: (rand() - 0.5) * 0.5,
  vy: (rand() - 0.5) * 0.5,
  size: rand() * 2 + 0.5,
  opacity: rand() * 0.4 + 0.15,
  signal: rand() < 0.125,
});

/**
 * One drift step: velocity applied, edges wrapped so motes never leave
 * the field. Returns a new mote — the field it drifts in stays pure.
 * @param {ReturnType<typeof spawnMote>} mote
 * @param {number} w
 * @param {number} h
 */
export const stepMote = (mote, w, h) => {
  let x = mote.x + mote.vx;
  let y = mote.y + mote.vy;
  if (x < 0) x = w;
  if (x > w) x = 0;
  if (y < 0) y = h;
  if (y > h) y = 0;
  return { ...mote, x, y };
};
