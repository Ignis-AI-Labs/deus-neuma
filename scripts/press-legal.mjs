#!/usr/bin/env node
/**
 * Press the binding documents into branded PDFs. // impure (fs + chromium)
 *
 *   node scripts/press-legal.mjs
 *
 * Reads every binding document (backend/services/covenant.js) and writes
 * docs/legal/pdf/<FILE>.pdf in the Ignis livery (docs/legal/press-kit/ignis-legal —
 * tracked, unlike data/brand-kits). Re-run after every revision logged in
 * docs/legal/CHANGELOG.md, so the PDF always matches the text a witness signs.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { pressDocument } from '../backend/services/doc-press/index.js';
import { loadDocuments } from '../backend/services/covenant.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGAL = path.join(repoRoot, 'docs/legal');

for (const doc of loadDocuments()) {
  const outputPath = path.join(LEGAL, 'pdf', doc.file.replace(/\.md$/, '.pdf'));
  const { pdf } = await pressDocument({
    markdown: doc.text,
    title: `${doc.title} — v${doc.version}`,
    kitId: 'ignis-legal',
    kitsDir: path.join(LEGAL, 'press-kit'),
    outputPath,
  });
  console.log(`pressed ${doc.id} v${doc.version} → ${path.relative(repoRoot, outputPath)} (${Math.round(pdf.length / 1024)} KB)`);
}
