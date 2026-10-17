// impure — ParticleField: the drifting motes of the void, on a full-screen
// canvas behind a ceremony. Mote mechanics are pure (motes.js); this
// component owns the canvas, the clock, and the resize listener. Under
// prefers-reduced-motion the field is drawn once and holds still.

import { useEffect, useRef } from 'react';
import { spawnMote, stepMote } from './motes.js';

const MOTE_COUNT = 50;

const tokenColor = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

const drawField = (ctx, motes, signal, ink) => {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const mote of motes) {
    ctx.beginPath();
    ctx.arc(mote.x, mote.y, mote.size, 0, Math.PI * 2);
    ctx.fillStyle = mote.signal ? signal : ink;
    ctx.globalAlpha = mote.opacity;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};

export const ParticleField = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const signal = tokenColor('--signal', '#5FE9FF');
    const ink = tokenColor('--color-white', '#FFFFFF');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    let motes = Array.from({ length: MOTE_COUNT }, () =>
      spawnMote(Math.random, canvas.width, canvas.height));

    let frame = 0;
    const tick = () => {
      motes = motes.map((m) => stepMote(m, canvas.width, canvas.height));
      drawField(ctx, motes, signal, ink);
      frame = requestAnimationFrame(tick);
    };

    if (still) drawField(ctx, motes, signal, ink);
    else frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="fx-motes" data-testid="fx-motes" aria-hidden="true" />;
};
