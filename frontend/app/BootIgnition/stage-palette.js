// stage-palette.js — THE LOOK read into a WebGL stage. // impure (DOM reads)
//
// THE LOOK reaches the construct: the palette is read from the live tokens
// at creation (bootLook paints documentElement before render). TRIM is the
// signal, INK the hairlines, GROUND the fog's resting color. One signal
// color — variation lives in intensity, never a second hue.
import * as THREE from 'three';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// impure — one DOM read per token at stage creation, never per frame
export const tokenHex = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return HEX_RE.test(v) ? parseInt(v.slice(1), 16) : fallback;
};

// pure — per-channel mix of two hex ints, a → b by t
export const mixHex = (a, b, t) => {
  const ch = (shift) => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * t) << shift;
  };
  return ch(16) | ch(8) | ch(0);
};

// pure — rough relative luminance of a hex int (0..1)
export const lumaOf = (hex) =>
  (0.2126 * ((hex >> 16) & 0xff) + 0.7152 * ((hex >> 8) & 0xff) + 0.0722 * (hex & 0xff)) / 255;

// impure — runtime radial-gradient glow texture (no asset file ships)
export const glowTexture = (signalRgb) => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, `rgba(${signalRgb},0.85)`);
  g.addColorStop(0.35, `rgba(${signalRgb},0.28)`);
  g.addColorStop(1, `rgba(${signalRgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
};


/**
 * impure — keep a stage's drawing buffer and camera aspect matched to its
 * canvas's CSS box (DPR capped). Returns the observer's disconnect.
 */
export const fitToCanvas = (canvas, renderer, camera, maxDpr) => {
  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  return () => observer.disconnect();
};
