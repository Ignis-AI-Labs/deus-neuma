// Where "Open in gallery" and "Show in files" land: the gallery item a landing
// names (gallery-landing.js), and the folders the Explorer opens to show a
// folder (reveal-chain.js). Pure functions, real inputs.
import { describe, test, expect } from 'vitest';
import { itemOfLanding, itemOfPath, pathOfItem } from '../../frontend/app/RelinkShell/gallery/gallery-landing.js';
import { revealChain } from '../../frontend/app/RelinkShell/files/reveal-chain.js';

const ID = '3f2b8c1e-9a4d-4c6b-8e2f-1a2b3c4d5e6f';
const ROOTS = [
  { id: 'comfyui-output', dir: '/srv/comfy/output' },
  { id: 'being-orla', dir: '/srv/house/lanes/orla/art' },
  { id: 'r-nested', dir: '/srv/house/lanes/orla/art/images/keep/' },
];
const ITEMS = [
  { rootId: 'comfyui-output', rel: 'ComfyUI_0001_.png', name: 'ComfyUI_0001_.png' },
  { rootId: 'being-orla', rel: `images/${ID}.mp4`, name: `${ID}.mp4` },
  { rootId: 'being-orla', rel: 'images/keep/a.png', name: 'a.png' },
  { rootId: 'r-nested', rel: 'a.png', name: 'a.png' },
];

describe('the gallery item a landing names', () => {
  test('a render id lands on its file in the being\'s art folder', () => {
    expect(itemOfLanding(ITEMS, ROOTS, { imageId: ID })).toBe(ITEMS[1]);
  });

  test('a path lands on the file in the innermost folder that holds it', () => {
    expect(itemOfPath(ITEMS, ROOTS, '/srv/comfy/output/ComfyUI_0001_.png')).toBe(ITEMS[0]);
    expect(itemOfPath(ITEMS, ROOTS, '/srv/house/lanes/orla/art/images/keep/a.png')).toBe(ITEMS[3]);
  });

  test('an id the scan does not hold falls through to the path', () => {
    expect(itemOfLanding(ITEMS, ROOTS, { imageId: 'gone', path: '/srv/comfy/output/ComfyUI_0001_.png' })).toBe(ITEMS[0]);
  });

  test('a file no gallery folder holds names nothing — a sibling folder\'s prefix is not a hold', () => {
    expect(itemOfPath(ITEMS, ROOTS, '/srv/comfy/output-old/ComfyUI_0001_.png')).toBeNull();
    expect(itemOfLanding(ITEMS, ROOTS, { path: '/home/founder/Pictures/x.png' })).toBeNull();
    expect(itemOfLanding(ITEMS, ROOTS, null)).toBeNull();
  });

  test('an item\'s place on disk is its folder and its root-relative name', () => {
    expect(pathOfItem(ITEMS[1], ROOTS)).toBe(`/srv/house/lanes/orla/art/images/${ID}.mp4`);
    expect(pathOfItem(ITEMS[3], ROOTS)).toBe('/srv/house/lanes/orla/art/images/keep/a.png');
    expect(pathOfItem({ rootId: 'unknown', rel: 'a.png' }, ROOTS)).toBeNull();
  });

  test('an item round-trips through its own path; a file two folders both hold lands in the innermost', () => {
    for (const it of [ITEMS[0], ITEMS[1], ITEMS[3]]) expect(itemOfPath(ITEMS, ROOTS, pathOfItem(it, ROOTS))).toBe(it);
    expect(itemOfPath(ITEMS, ROOTS, pathOfItem(ITEMS[2], ROOTS))).toBe(ITEMS[3]);
  });
});

describe('the folders the Explorer opens to show a folder', () => {
  test('the innermost open root, then every folder down to it', () => {
    expect(revealChain(['/srv', '/srv/house/lanes'], '/srv/house/lanes/orla/art/images'))
      .toEqual(['/srv/house/lanes', '/srv/house/lanes/orla', '/srv/house/lanes/orla/art', '/srv/house/lanes/orla/art/images']);
  });

  test('a folder that IS a root is just that root; trailing separators are ignored', () => {
    expect(revealChain(['/srv/house/'], '/srv/house')).toEqual(['/srv/house']);
  });

  test('a folder no open root holds names nothing — so its folder must be opened first', () => {
    expect(revealChain(['/srv/house'], '/srv/houses/x')).toEqual([]);
    expect(revealChain([], '/a')).toEqual([]);
    expect(revealChain(null, '/a')).toEqual([]);
  });

  test('a Windows folder walks in its own separators', () => {
    expect(revealChain(['C:\\Users\\founder'], 'C:\\Users\\founder\\Pictures\\forge'))
      .toEqual(['C:\\Users\\founder', 'C:\\Users\\founder\\Pictures', 'C:\\Users\\founder\\Pictures\\forge']);
  });
});
