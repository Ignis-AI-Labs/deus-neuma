#!/usr/bin/env node
/**
 * THE AURA — the contact sheet: a hundred beings' signatures on one plate.
 *
 * A pass rate is a number about a picture nobody has looked at. This is the
 * looking. Every tile is a real derivation from a real seed through the real
 * gate, so what is on the plate is what a witness would get.
 *
 *   node scripts/aura-contact-sheet.mjs                 # 100 auras, t=0
 *   node scripts/aura-contact-sheet.mjs --cols 8 --tile 260
 *   node scripts/aura-contact-sheet.mjs --strip 7       # one aura across its cycle
 *   node scripts/aura-contact-sheet.mjs --out /tmp/a.png
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deriveAura, formOf } from '../core/aura/derive.js';
import { AURA_CYCLE, cyclePhases } from '../core/aura/form.js';
import { encodeGrayPNG } from './lib/png-gray.mjs';
import { renderTile, blit } from './lib/aura-render.mjs';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const COLS = Number(flag('cols', 10));
const ROWS = Number(flag('rows', 10));
const TILE = Number(flag('tile', 200));
const COUNT = Number(flag('points', 14000));
const STRIP = flag('strip', null);
const OUT = resolve(flag('out', 'data/temp/aura/contact-sheet.png'));

/* Seeds stand in for beings that have not been born. Each is a real 256-bit
   digest, drawn the way a true aura seed is — never a counter dressed as one. */
const seedFor = (label) => createHash('sha256').update(`aura-contact/${label}`).digest('hex');

const sheetOf = (tiles, cols, tileSize) => {
  const rows = Math.ceil(tiles.length / cols);
  const width = cols * tileSize;
  const sheet = new Uint8Array(width * rows * tileSize);
  tiles.forEach((tile, i) => {
    blit(sheet, width, tile, tileSize, (i % cols) * tileSize, Math.floor(i / cols) * tileSize);
  });
  return { sheet, width, height: rows * tileSize };
};

const buildStrip = (label, frames) => {
  const aura = deriveAura(seedFor(label));
  const form = formOf(aura);
  const phases = cyclePhases(frames);
  process.stdout.write(
    `strip "${label}" — ${aura.archetype.carrier}/${aura.archetype.coupling}/${aura.archetype.output}` +
    `  score ${aura.score.toFixed(3)}  round ${aura.round}\n` +
    `${frames} frames across one cycle (${AURA_CYCLE.toFixed(3)} rad)\n`,
  );
  return phases.map((t) => renderTile(form, aura.fit, t, { size: TILE, count: COUNT }));
};

const buildGrid = () => {
  const total = COLS * ROWS;
  const tiles = [];
  const archetypes = new Map();
  let rounds = 0;
  for (let i = 0; i < total; i++) {
    const aura = deriveAura(seedFor(i));
    const key = `${aura.archetype.carrier}/${aura.archetype.coupling}/${aura.archetype.output}`;
    archetypes.set(key, (archetypes.get(key) ?? 0) + 1);
    rounds += aura.round;
    tiles.push(renderTile(formOf(aura), aura.fit, 0, { size: TILE, count: COUNT }));
    if ((i + 1) % 10 === 0) process.stdout.write(`  derived ${i + 1}/${total}\r`);
  }
  process.stdout.write(
    `\n${total} auras · ${archetypes.size} distinct archetypes · ` +
    `mean walk ${(rounds / total).toFixed(3)} rounds\n`,
  );
  return tiles;
};

const tiles = STRIP ? buildStrip(STRIP, Number(flag('frames', 8))) : buildGrid();
const { sheet, width, height } = sheetOf(tiles, STRIP ? tiles.length : COLS, TILE);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, encodeGrayPNG(sheet, width, height));
process.stdout.write(`wrote ${OUT}  (${width}×${height})\n`);
