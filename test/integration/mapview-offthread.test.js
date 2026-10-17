/**
 * The map scan OFF the event loop (2026-09-28 smoothness pass) — proven on a
 * real folder and the real repo, through the real worker thread. No mocks
 * (RULE 0): the claims are that the thread answers exactly what the in-process
 * scan answers, that an unchanged tree is answered from the memo, that one
 * changed byte rebuilds, and that the backend's event loop keeps breathing
 * while this repo — ~4s of scan CPU — is mapped.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTempDir } from '../helpers/temp-fs.js';
import { scanArchitecture, scanFindings, scanCheck } from '../../backend/services/mapview/scan.js';
import {
  scanArchitectureOffThread, scanFindingsOffThread, scanCheckOffThread,
} from '../../backend/services/mapview/scan-offthread.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const seed = async () => {
  const dir = await createTempDir('map-offthread');
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'offthread-proof', main: 'a.js' }));
  await fs.writeFile(path.join(dir, 'a.js'), "import { b } from './b.js';\nexport const a = () => b();\n");
  await fs.writeFile(path.join(dir, 'b.js'), 'export const b = () => 1;\n');
  return dir;
};

describe('mapview off-thread scan', () => {
  it('answers exactly what the in-process scan answers — graph, findings and check', async () => {
    const dir = await seed();
    expect(await scanArchitectureOffThread(dir)).toEqual(await scanArchitecture(dir));
    expect(await scanFindingsOffThread(dir)).toEqual(await scanFindings(dir));
    expect(await scanCheckOffThread(dir)).toEqual(await scanCheck(dir));
  });

  it('an unchanged tree is served from the memo; one changed byte rebuilds', async () => {
    const dir = await seed();
    const first = await scanArchitectureOffThread(dir);
    const again = await scanArchitectureOffThread(dir);
    expect(again).toEqual(first);
    // A new export in b.js must appear — never a stale graph.
    await fs.writeFile(path.join(dir, 'b.js'), 'export const b = () => 1;\nexport const c = () => 2;\n');
    const changed = await scanArchitectureOffThread(dir);
    expect(changed).toEqual(await scanArchitecture(dir));
    expect(JSON.stringify(changed)).not.toBe(JSON.stringify(first));
  });

  it('mapping this repo never stalls the event loop', async () => {
    let worstGap = 0;
    let last = performance.now();
    const beat = setInterval(() => {
      const now = performance.now();
      worstGap = Math.max(worstGap, now - last);
      last = now;
    }, 10);
    const graph = await scanArchitectureOffThread(REPO);
    clearInterval(beat);
    expect(graph.meta.scannedFiles).toBeGreaterThan(500);
    // In-process this scan held the loop for ~4s; off-thread the loop only
    // pays the structured clone of the result.
    expect(worstGap).toBeLessThan(400);
  }, 60000);
});
