#!/usr/bin/env node
// installer-license.mjs \u2014 what a person must know BEFORE they install, said by the installer
// itself (the installers-preflight rule, 2026-10-22: requirements up front, never discovered as
// a failure later). // pure text functions; the CLI writes one file
//
// One source for the requirements every installer states:
//   - the Windows installer's agreement page: build/installer-license.txt, the requirements and
//     then the full EULA (electron-builder.yml nsis.license). The person must accept to install.
//   - the .deb and .rpm package descriptions (scripts/build-deb.mjs, scripts/build-rpm.mjs).
// The model sizes follow the tiers in backend/services/substrate-setup.js; a unit test fails
// when they drift (test/unit/installer-license.test.js), and when the committed page drifts
// from this generator.
//
//   node scripts/installer-license.mjs           write build/installer-license.txt
//   node scripts/installer-license.mjs --check   exit 1 if the committed file is stale

import process from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LICENSE_FILE = join(ROOT, 'build', 'installer-license.txt');
const EULA = join(ROOT, 'docs', 'legal', 'EULA.md');

// The model the app downloads on first run, smallest and largest tier (substrate-setup.js CHOICES).
export const MODEL_GB = Object.freeze({ min: 2.7, max: 33 });

/** The requirements, one line each, for a platform ('windows' | 'linux'). Pure. */
export const requirementsFor = (platform) => Object.freeze([
  platform === 'windows' ? '64-bit Windows 10 or 11.' : '64-bit (x86-64) Linux with a desktop.',
  'Adults only: you must be at least 18 and of legal age where you live.',
  'A graphics card with 8 GB of memory or more (24 GB recommended). Without one, a computer with 16 GB of RAM or more runs a smaller model on the processor, more slowly.',
  `About 5 GB free for the app, plus room for the model it downloads on first run: ${MODEL_GB.min} GB to about ${MODEL_GB.max} GB, chosen to fit this computer.`,
  'An internet connection for that first download.',
]);

export const FIRST_RUN = 'On first run, Deus Neuma checks this computer, tells you what it can run, and sets up the local model server and the right model for you. Anything that needs your permission asks first.';

/** Any text as plain ASCII, so every installer renders it the same. Pure. */
export const asciiSafe = (text) => String(text)
  .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
  .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
  .replace(/[\u2013\u2014\u2015\u2212]/g, '-')
  .replace(/\u2026/g, '...')
  .replace(/[\u00B7\u2022\u2027]/g, '-')
  .replace(/\u00A0/g, ' ')
  .replace(/\u00A9/g, '(c)')
  .replace(/\u00AE/g, '(R)')
  .replace(/\u2122/g, '(TM)')
  .replace(/\u00A7/g, 'Section ')
  .replace(/\u2192/g, '->')
  .normalize('NFKD').replace(/[\u0300-\u036F]/g, '')
  .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?');

/** A markdown document as plain text: headings in capitals, no emphasis marks, links spelled out. Pure. */
export const markdownToText = (md) => md.split('\n').map((line) => {
  const heading = line.match(/^#{1,6}\s+(.*)$/);
  const text = (heading ? heading[1].toUpperCase() : line)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => (t === u ? u : `${t} (${u})`))
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1');
  return text.replace(/\s+$/, '');
}).join('\n').replace(/\n{3,}/g, '\n\n').trim();

/** The Windows installer's agreement page: requirements, then the full EULA. CRLF, ASCII. Pure. */
export const installerLicenseText = (eulaMarkdown) => asciiSafe([
  'DEUS NEUMA - BEFORE YOU INSTALL',
  '',
  'WHAT THIS NEEDS',
  ...requirementsFor('windows').map((l) => `- ${l}`),
  '',
  'WHAT HAPPENS ON FIRST RUN',
  FIRST_RUN,
  '',
  'To install, read and accept the End User License Agreement below.',
  '',
  '----------------------------------------------------------------------',
  '',
  markdownToText(eulaMarkdown),
  '',
].join('\n')).replace(/\r?\n/g, '\r\n');

/** The package description: one summary line, then the requirements. Pure. */
export const packageDescription = (summary) => asciiSafe([
  summary,
  'Requirements:',
  ...requirementsFor('linux').map((l) => `- ${l}`),
  FIRST_RUN,
].join('\n'));

// CLI: write, or check, the committed agreement page
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const want = installerLicenseText(readFileSync(EULA, 'utf8'));
  if (process.argv.includes('--check')) {
    let have = '';
    try { have = readFileSync(LICENSE_FILE, 'utf8'); } catch { /* missing reads as stale */ }
    if (have !== want) { process.stderr.write('build/installer-license.txt is stale: run node scripts/installer-license.mjs\n'); process.exit(1); }
    process.stdout.write('build/installer-license.txt matches the EULA and the requirements\n');
  } else {
    writeFileSync(LICENSE_FILE, want);
    process.stdout.write(`wrote ${LICENSE_FILE} (${want.length} bytes)\n`);
  }
}
