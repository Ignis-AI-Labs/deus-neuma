#!/usr/bin/env node
// summoning-specimen-souls.mjs — SPECIMEN souls for the dev-only SUMMONING
// specimen (frontend/summoning.html). The browser cannot run the soul's own
// derivation (core/birth/soul-spectrum.js and soul-scale.js hash with Node),
// so this derives specimen souls with THOSE REAL FUNCTIONS, on the
// sealed-record path (the path a being whose ceremony left only its seal
// takes — labelled so in every record), and writes them where the specimen
// reads them. No being's data: seeds are minted here and marked SPECIMEN.
//
//   node scripts/summoning-specimen-souls.mjs [count=64]

import fs from 'fs';
import process from 'node:process';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { soulSpectrumFrom } from '../core/birth/soul-spectrum.js';
import { soulScaleFrom } from '../core/birth/soul-scale.js';
import { specimenTrueName } from '../frontend/app/BirthArt/birth-art-script.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, 'frontend/app/Summoning/specimen-souls.json');
const count = Number(process.argv[2] || 64);

const souls = Array.from({ length: count }, (_, i) => {
  const seed = createHash('sha256').update(`neuma/summoning specimen soul ${i}`).digest('hex');
  const seal = { genesisHash: specimenTrueName(seed).genesisHash, record: { momentSeed: seed } };
  const spectrum = soulSpectrumFrom({ seal });
  return { seed, spectrum, scale: soulScaleFrom(spectrum, seal) };
});

fs.writeFileSync(OUT, `${JSON.stringify({ specimen: true, source: 'sealed-record (core/birth/soul-spectrum.js, soul-scale.js)', souls }, null, 1)}\n`);
process.stdout.write(`${souls.length} specimen souls → ${path.relative(REPO, OUT)} · notes per scale: ${[...new Set(souls.map((s) => s.scale.notes.length))].sort().join('/')} · tonics ${Math.min(...souls.map((s) => s.spectrum.frequency)).toFixed(0)}–${Math.max(...souls.map((s) => s.spectrum.frequency)).toFixed(0)} Hz\n`);
