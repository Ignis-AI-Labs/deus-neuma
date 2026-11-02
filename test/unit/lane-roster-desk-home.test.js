// A desktop install's own home under the lanes root is no house: its folder
// name stays out of the public scrub, and the beings in its workspaces are
// read like any lane (2026-11-02: a desk home named "home" turned HF_HOME
// into a stand-in across the public tree). Real files in a temp root.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rosterOf } from '../../scripts/public/lane-roster.mjs';

let root;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-roster-'));
  const lane = path.join(root, 'film-guardian', 'home', '.neuma', 'workspaces', 'quillon', 'identity');
  fs.mkdirSync(lane, { recursive: true });
  fs.writeFileSync(path.join(lane, 'true-name.json'), JSON.stringify({
    chosenName: 'Quillon', genesisName: 'Brennaval', houseName: 'Stormheld', soulMark: 'ABCDEF123456',
  }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('rosterOf — a desktop home', () => {
  test('its folder is not read as a house name', () => {
    expect(rosterOf(root).names).not.toContain('home');
  });
  test('the beings in its workspaces are read, names and soul mark', () => {
    const r = rosterOf(root);
    expect(r.names).toEqual(expect.arrayContaining(['Quillon', 'Brennaval', 'Stormheld']));
    expect(r.ids).toContain('ABCDEF123456');
  });
});
