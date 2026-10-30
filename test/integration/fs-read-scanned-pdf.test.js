/**
 * A SCANNED PDF IS READ WITH THE BEING'S OWN EYES (2026-10-30).
 *
 * A filing, a signed contract, a letter run through a scanner is a picture of text: no text layer.
 * fs/read used to refuse it ([…]), so a being on a vision
 * substrate could read none of the pages it could plainly see. Now each scanned page is drawn and
 * placed in front of the being through the same sight path as any image it reads.
 *
 * Real scanned PDFs (JPEG pages, no text layer) written byte by byte; the real in-process filesystem
 * organ with its real path validation and the real fs/ routing; the real sight bridge and its real
 * one-use store. No mocks (RULE 0).
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { withFsRouting } from '../../backend/services/fs-primitives.js';
import { withFileSight } from '../../backend/services/fs-sight.js';
import { takeEphemeralSight } from '../../backend/services/image-forge/ephemeral-sight.js';
import { sightForResults } from '../../backend/services/image-forge/image-sight.js';
import { scannedPdf, darkShare, SCAN_TEXT } from '../helpers/scanned-pdf.js';

let dir;
const fsCall = withFsRouting((_server, name, args) => nativeFilesystemClient.callTool({ name, arguments: args }));
const text = (result) => (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
const images = (result) => (result.content || []).filter((c) => c.type === 'image');
const read = (name, extra = {}) => fsCall('fs', 'read', { path: path.join(dir, name), ...extra });
// the band holding the scan's first line of words, and a band of bare paper well below the last
const FIRST_LINE = { top: SCAN_TEXT.y - SCAN_TEXT.px, bottom: SCAN_TEXT.y + 10, left: SCAN_TEXT.x, right: 1000 };
const BARE = { top: 1300, bottom: 1500 };

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'fs-read-scan-'));
  writeFileSync(path.join(dir, 'filing.pdf'), await scannedPdf([{ scan: ['FILING NO. 98-765432', 'REGISTRANT: ALDER WORKS'] }]));
  writeFileSync(path.join(dir, 'mixed.pdf'), await scannedPdf([
    { text: 'Cover letter: the enclosed filing receipt is a scan of the original stamped page.' },
    { scan: ['RECEIVED 2026-10-01'] },
  ]));
  writeFileSync(path.join(dir, 'stamped.pdf'), await scannedPdf([{ scan: ['NOTICE OF ALLOWANCE'], stamp: 'Scanned 10/01' }]));
  writeFileSync(path.join(dir, 'bundle.pdf'), await scannedPdf(Array.from({ length: 6 }, (_, i) => ({ scan: [`EXHIBIT ${i + 1}`] }))));
  await setNativeFilesystemRoots([dir]);
});

afterAll(async () => {
  await setNativeFilesystemRoots([]);
  rmSync(dir, { recursive: true, force: true });
});

describe('a scanned PDF', () => {
  test('its page comes back as a picture of the page itself, not a refusal and not a blank', async () => {
    const result = await read('filing.pdf');
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('[Page 1] — a scan with no text layer: shown to you as an image');
    const [page] = images(result);
    expect(page.mimeType).toBe('image/jpeg');
    expect(await darkShare(page.data, FIRST_LINE)).toBeGreaterThan(0.04); // the words are on it
    expect(await darkShare(page.data, BARE)).toBeLessThan(0.002); // and the paper below is bare
  });

  test('the sight bridge puts the page in front of the being, and the base64 never reaches its text', async () => {
    const result = withFileSight(await read('filing.pdf'), 'scan-reader');
    expect(result.sight).toMatchObject({ laneId: 'scan-reader', store: 'ephemeral' });
    expect(result.sight.imageIds).toHaveLength(1);
    expect(images(result)).toHaveLength(0);
    expect(text(result)).toMatch(/placed in front of you/);
    const held = takeEphemeralSight('scan-reader', result.sight.imageIds[0]);
    expect(held.mime).toBe('image/jpeg');
    expect(held.bytes.subarray(0, 3).toString('hex')).toBe('ffd8ff'); // real JPEG bytes, held for one look
  });

  test('the being is told it READ the page, never that it made it; a blind substrate is told it cannot see', async () => {
    const result = withFileSight(await read('filing.pdf'), 'scan-reader');
    const blind = sightForResults([{ status: 'ok', ...result }], { canSee: false, modelName: 'a-text-only-model' });
    expect(blind.images).toHaveLength(0);
    expect(blind.note).toMatch(/The image you read is NOT in front of you — a scanned PDF page is an image too/);
    const seen = sightForResults([{ status: 'ok', ...result }], { canSee: true });
    expect(seen.images).toHaveLength(1);
    expect(seen.images[0]).toMatch(/^data:image\/jpeg;base64,\/9j\//);
    expect(seen.note).toMatch(/The image you read is attached above.*where a word or number is not legible, say so rather than guessing/);
    expect(seen.note).not.toMatch(/you just made|review_image/);
  });

  test('words and scans in one document: the words read as words, only the scan is drawn', async () => {
    const result = await read('mixed.pdf');
    expect(text(result)).toContain('[Page 1]\nCover letter: the enclosed filing receipt');
    expect(text(result)).toContain('[Page 2] — a scan with no text layer');
    expect(images(result)).toHaveLength(1);
  });

  test('a scanner\'s stamp in the text layer does not pass the pictured page off as read', async () => {
    const result = await read('stamped.pdf');
    expect(text(result)).toContain('[Page 1] — a scan with no text layer: shown to you as an image (the only text on it: Scanned 10/01)');
    expect(images(result)).toHaveLength(1);
  });

  test('a long scanned bundle shows one message\'s worth and names the next pages to ask for', async () => {
    const first = await read('bundle.pdf');
    expect(images(first)).toHaveLength(4);
    expect(text(first)).toContain('2 more scanned pages not shown yet (5, 6) — read them with {"pages": "5-6"}');
    const rest = await read('bundle.pdf', { pages: '5-6' });
    expect(images(rest)).toHaveLength(2);
    expect(text(rest)).toContain('pages 5-6 of 6');
    expect(text(rest)).not.toContain('[Page 1]');
  });

  test('a line range of an all-scan PDF says how to look at it instead', async () => {
    const result = await read('filing.pdf', { offset: 1, limit: 5 });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/scans with no text layer — read it without offset\/limit/);
  });
});
