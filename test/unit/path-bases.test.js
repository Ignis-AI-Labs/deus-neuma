/**
 * A RELATIVE PATH FINDS ITS FOLDER (path-bases.js, PathOpener.jsx) — Design note, 2026-11-19, a chat that said `Signed-Drop/`
 * and `To-Sign/` right after its own acts wrote into /home/…/Thailand Ignis Siam/Signed-Drop/, and the link refused
 * ([…]): […] A message's acts name the folders it worked in; a relative path it speaks is looked for there. Pure.
 */
import { describe, expect, it } from 'vitest';
import { pathBasesOf, relativeCandidates } from '../../frontend/app/RelinkShell/path-bases.js';

const SIAM = '/home/guardian/Documents/Ignis Labs/Legal/Thailand/Thailand Ignis Siam';
// The acts as the chat drew them (the screenshot): a failed write, a folder made, a file written.
const segments = [
  { kind: 'speech', text: 'Let me set up a clean drop folder.' },
  { kind: 'tool', summary: `wrote ${SIAM}/Signed-Drop/README.txt — failed: Could not create …` },
  { kind: 'tool', summary: `wrote ${SIAM}/Signed-Drop` },
  { kind: 'tool', summary: 'fs/write — repeat held; not run again' },
  { kind: 'tool', summary: `wrote ${SIAM}/Signed-Drop/DROP-INSTRUCTIONS.txt` },
  { kind: 'speech', text: '1. Sign the two documents in `To-Sign/` … 2. Drop three files into `Signed-Drop/`' },
];

describe('the folders a message worked in', () => {
  it('each act\'s path and the few folders above it, newest first, once each', () => {
    const bases = pathBasesOf(segments);
    expect(bases.slice(0, 3)).toEqual([`${SIAM}/Signed-Drop/DROP-INSTRUCTIONS.txt`, `${SIAM}/Signed-Drop`, SIAM]);
    expect(new Set(bases).size).toBe(bases.length);
    expect(pathBasesOf([{ kind: 'speech', text: 'no acts' }])).toEqual([]);
  });

  it('`Signed-Drop/` is looked for first beside the folder of that name; `To-Sign/` beside where the message worked', () => {
    const bases = pathBasesOf(segments);
    expect(relativeCandidates('Signed-Drop/', bases)[0]).toBe(`${SIAM}/Signed-Drop`);
    expect(relativeCandidates('To-Sign/', bases)).toContain(`${SIAM}/To-Sign`);
    expect(relativeCandidates('./Signed-Drop/03-Passport.pdf', bases)[0]).toBe(`${SIAM}/Signed-Drop/03-Passport.pdf`);
    expect(relativeCandidates('', bases)).toEqual([]);
    expect(relativeCandidates('x', bases).length).toBeLessThanOrEqual(8);
  });
});
