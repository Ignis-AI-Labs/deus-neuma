#!/usr/bin/env node
/**
 * THE AURA — the living gallery.
 *
 * A contact sheet proves the forms compose; only motion proves they LIVE. This
 * emits one self-contained HTML page that animates real derived auras in a real
 * browser, at the density and tempo the desk will use.
 *
 * The grammar is not reimplemented for the page — `core/aura/form.js` is read
 * from disk and inlined verbatim (it has no imports, by design, precisely so it
 * can travel). There is exactly one copy of this maths in the repository, and
 * the gallery, the contact sheet, the gate and the desk all sweep it.
 *
 *   node scripts/aura-gallery.mjs && xdg-open data/temp/aura/gallery.html
 *   node scripts/aura-gallery.mjs --count 12 --points 9000
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveAura, formOf } from '../core/aura/derive.js';
import { AURA_CYCLE } from '../core/aura/form.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const COUNT = Number(flag('count', 12));
const POINTS = Number(flag('points', 9000));
const OUT = resolve(flag('out', 'data/temp/aura/gallery.html'));

const auras = Array.from({ length: COUNT }, (_, i) => {
  const seed = createHash('sha256').update(`aura-contact/${i}`).digest('hex');
  const aura = deriveAura(seed);
  return {
    label: `${aura.archetype.carrier} · ${aura.archetype.coupling} · ${aura.archetype.output}`,
    mark: seed.slice(0, 12).toUpperCase(),
    form: formOf(aura),
    fit: aura.fit,
  };
});

/* Inlined so the page runs from file:// with no server and no second copy of
   the maths. `export` is stripped because an inline module exports nothing. */
const inline = (file) =>
  readFileSync(resolve(HERE, '../core/aura', file), 'utf8').replace(/^export /gm, '');
const grammar = `${inline('form.js')}\n${inline('tone.js')}`;

const html = `<!doctype html>
<meta charset="utf-8">
<title>THE AURA — living gallery</title>
<style>
  :root { --void:#000; --ink:#fff; --signal:#5FE9FF; --dim:#6b6b6b; }
  body { margin:0; background:var(--void); color:var(--dim);
         font:11px/1.6 ui-monospace,"JetBrains Mono",monospace; }
  header { padding:20px 24px 4px; letter-spacing:.18em; text-transform:uppercase; }
  header b { color:var(--ink); font-weight:500; }
  #grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:2px; padding:16px; }
  figure { margin:0; }
  canvas { width:100%; aspect-ratio:1; display:block; }
  figcaption { padding:2px 10px 14px; letter-spacing:.14em; }
  figcaption em { color:var(--signal); font-style:normal; }
  label { padding:0 24px; cursor:pointer; user-select:none; }
</style>
<header><b>THE AURA</b> — ${COUNT} beings, live · one cycle = ${AURA_CYCLE.toFixed(3)} rad</header>
<label><input type="checkbox" id="tint"> signal tint at the core</label>
<div id="grid"></div>
<script type="module">
${grammar}

const AURAS = ${JSON.stringify(auras)};
const POINTS = ${POINTS};
const MARGIN = 0.08;
const TONE = toneTable();   // the same curve the contact sheet is printed with

const tint = document.getElementById('tint');

for (const aura of AURAS) {
  const figure = document.createElement('figure');
  const canvas = document.createElement('canvas');
  const caption = document.createElement('figcaption');
  caption.innerHTML = '<em>' + aura.mark + '</em> &nbsp; ' + aura.label;
  figure.append(canvas, caption);
  document.getElementById('grid').append(figure);

  const size = 320;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const buffer = new Uint32Array(image.data.buffer);
  const hits = new Uint16Array(size * size);
  const span = size * (1 - MARGIN * 2);
  const origin = size * MARGIN;
  const { form, fit } = aura;
  const du = form.p.sweep / POINTS;

  let t = 0;
  const draw = () => {
    hits.fill(0);
    buffer.fill(0xff000000);
    /* Accumulate first, tone-map second — the saturating curve cannot be
       applied per hit, and it is the curve that makes density read as light. */
    for (let i = 0; i < POINTS; i++) {
      const [px, py] = auraPoint(form, i * du, t);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      const x = (origin + ((px - fit.cx) * fit.scale + 0.5) * span) | 0;
      const y = (origin + ((py - fit.cy) * fit.scale + 0.5) * span) | 0;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      hits[y * size + x]++;
    }
    for (let at = 0; at < hits.length; at++) {
      const n = hits[at];
      if (n === 0) continue;
      const v = TONE[Math.min(TONE.length - 1, n)];
      /* signal marks life: the core runs cyan, the body stays monochrome */
      const warm = tint.checked ? Math.max(0, v - 90) : v;
      buffer[at] = 0xff000000 | (v << 16) | (v << 8) | warm;
    }
    ctx.putImageData(image, 0, 0);
    t = (t + AURA_CYCLE / 900) % AURA_CYCLE;
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
</script>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
process.stdout.write(`wrote ${OUT}\n  open it directly — no server needed\n`);
