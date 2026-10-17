/**
 * THE MOTION LAW — the desk's choreography rides the compositor.
 *
 * Design note, 2026-09-25: more motion graphics, […] A keyframe that animates width, left, a color, a shadow
 * or a filter makes the browser lay out or repaint every frame it plays;
 * transform and opacity are composited on the GPU and cost the main thread
 * nothing. The window's arrival animated `width` — 25 layouts per open,
 * measured (test/e2e/motion-budget.spec.js holds the frame budget live).
 *
 * Reads every stylesheet under frontend/app and frontend/styles — the real
 * files, no fixtures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['frontend/app', 'frontend/styles'];
const COMPOSITED = new Set(['transform', 'opacity', 'translate', 'scale', 'rotate', 'offset-distance']);

// Named, one-shot exceptions — each a ceremony beat that plays once and
// cannot be drawn with transform alone. A new entry needs the same case.
const EXCEPTIONS = new Map([
  ['esDrawIn', 'the emergence seal draws its true circumference once (stroke-dashoffset) — the self-drawing frame idiom'],
  ['fxSealFlash', 'one glow beat per ceremony phase crossing (filter), never looped'],
]);

const sheets = () => {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith('.css')) out.push(p);
    }
  };
  ROOTS.forEach(walk);
  return out;
};

// Pure — every @keyframes block in a stylesheet: its name and the
// properties its frames set.
export const keyframesOf = (css) => {
  const found = [];
  const head = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = head.exec(css))) {
    let depth = 1;
    let i = head.lastIndex;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    const body = css.slice(head.lastIndex, i - 1).replace(/\/\*[\s\S]*?\*\//g, '');
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((x) => x[1]);
    found.push({ name: m[1], props: [...new Set(props)] });
  }
  return found;
};

describe('the motion law', () => {
  it('keyframes animate transform and opacity only (named ceremony exceptions aside)', () => {
    const offenders = [];
    for (const file of sheets()) {
      for (const { name, props } of keyframesOf(fs.readFileSync(file, 'utf8'))) {
        const paint = props.filter((p) => !COMPOSITED.has(p));
        if (paint.length && !EXCEPTIONS.has(name)) offenders.push(`${file} @keyframes ${name}: ${paint.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the exceptions still exist — a dead exception is removed, not kept', () => {
    const names = new Set(sheets().flatMap((f) => keyframesOf(fs.readFileSync(f, 'utf8')).map((k) => k.name)));
    expect([...EXCEPTIONS.keys()].filter((n) => !names.has(n))).toEqual([]);
  });

  it('nothing bounces — the bounce easing stays retired', () => {
    const bouncing = sheets().filter((f) => /--ease-bounce|cubic-bezier\([^)]*-0\.\d+[^)]*1\.\d+\)/.test(fs.readFileSync(f, 'utf8')));
    expect(bouncing).toEqual([]);
  });

  it('one calm switch lands every animation on its final frame (reduced motion and data-motion=calm)', () => {
    const kernel = fs.readFileSync('frontend/styles/motion.css', 'utf8');
    expect(kernel).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*, \*::before, \*::after \{[^}]*animation-duration: 1ms !important/);
    expect(kernel).toMatch(/:root\[data-motion='calm'\] \*/);
    expect(fs.readFileSync('frontend/styles/main.css', 'utf8')).toContain("@import './motion.css';");
  });

  it('keyframesOf reads nested frames and ignores comments', () => {
    const css = '@keyframes a { from { opacity: 0; /* width: 1px */ } 50% { transform: none } to { left: 2px; } }';
    expect(keyframesOf(css)).toEqual([{ name: 'a', props: ['opacity', 'transform', 'left'] }]);
  });
});
