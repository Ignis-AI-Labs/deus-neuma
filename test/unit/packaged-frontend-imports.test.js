/**
 * THE PACKAGE CARRIES WHAT THE BACKEND IMPORTS FROM frontend/ (electron-builder.yml `files`).
 * frontend/ is not shipped except the few modules listed there. A backend file that imports another
 * one (or one of those pulling in a third) boots fine in a checkout and dies in the installed app:
 * […] (ERR_MODULE_NOT_FOUND, 2026-10-24). This walks the REAL import
 * graph from every backend, core and electron file and checks each reached frontend file is listed.
 */
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SPEC = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
const SKIP = /(^|[\\/])(node_modules|test|dist|release)([\\/]|$)|\.(test|spec)\.[cm]?js$/;

const filesUnder = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (SKIP.test(p)) return [];
  return e.isDirectory() ? filesUnder(p) : /\.[cm]?js$/.test(e.name) ? [p] : [];
});

const importsOf = (file) => [...fs.readFileSync(file, 'utf8').matchAll(SPEC)]
  .map((m) => path.resolve(path.dirname(file), m[1]))
  .filter((p) => fs.existsSync(p) && fs.statSync(p).isFile());

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

describe('the installed app has every frontend module its backend imports', () => {
  test('every frontend file reachable from backend/, core/ or electron/ is packaged', () => {
    const shipped = new Set(
      fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8').split('\n')
        .map((l) => /^\s+-\s+(frontend\/\S+)\s*$/.exec(l)?.[1]).filter(Boolean),
    );
    const seen = new Set();
    const queue = ['backend', 'core', 'electron'].flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? filesUnder(path.join(ROOT, d)) : []));
    while (queue.length) {
      const file = queue.pop();
      for (const dep of importsOf(file)) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        if (rel(dep).startsWith('frontend/')) queue.push(dep);
      }
    }
    const reached = [...seen].map(rel).filter((p) => p.startsWith('frontend/'));
    expect(reached.length).toBeGreaterThan(0);
    expect(reached.filter((p) => !shipped.has(p)).sort()).toEqual([]);
  });
});
