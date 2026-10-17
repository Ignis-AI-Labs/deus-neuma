/**
 * The media library — real tmp disk, real file posture, no mock anywhere
 * (RULE 0). The repository is the culture lane's memory: what lands here
 * (sniffed bytes only), the manifest's provenance, and the immutability
 * the scheduler's re-verify law stands on.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { createMediaLibrary } from '../../backend/services/media-library.js';
import { MEDIA_MAX_BYTES } from '../../backend/services/social/x-media.js';

// Real image BYTES (magic header + payload) — the sniff reads the header,
// never the name.
const png = () => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  Buffer.alloc(64, 7),
]);
const gif = () => Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(64, 1)]);
const notAnImage = () => Buffer.from('<html><body>this is a page, not a picture</body></html>');

let dir;
let library;

beforeEach(async () => {
  dir = await createTempDir(`media-library-${Math.random().toString(36).slice(2)}`);
  library = createMediaLibrary({ root: dir });
});

describe('media library (real disk)', () => {
  test('a real image lands: file written, provenance in the manifest, readable back with its absolute path', async () => {
    const saved = await library.save({
      bytes: png(), sourceUrl: 'https://cdn.example.com/culture.png',
      alt: 'a void-black diagram of the gyro', savedBy: 'Kagipem',
    });
    expect(saved.ok).toBe(true);
    expect(saved.entry.contentType).toBe('image/png');
    expect(saved.entry.file).toMatch(/^[0-9a-f]{16}\.png$/);
    expect(saved.entry.savedBy).toBe('Kagipem');
    expect(saved.entry.savedAt).toBeTruthy();

    // The bytes on disk are the bytes that arrived.
    const onDisk = await fs.readFile(path.join(dir, saved.entry.file));
    expect(onDisk.equals(png())).toBe(true);
    expect((await fs.stat(path.join(dir, saved.entry.file))).mode & 0o777).toBe(0o600);

    // The listing carries the ABSOLUTE path — the path `media` names.
    const [entry] = await library.list();
    expect(entry.path).toBe(path.join(dir, saved.entry.file));
    expect(entry.alt).toBe('a void-black diagram of the gyro');
    expect(entry.sourceUrl).toBe('https://cdn.example.com/culture.png');
    expect(await library.pathFor(saved.entry.id)).toBe(path.join(dir, saved.entry.file));
    expect(await library.pathFor('nosuchid')).toBeNull();
  });

  test('the sniff is the door: a page\'s bytes never land, no matter what the url claimed', async () => {
    const refused = await library.save({ bytes: notAnImage(), sourceUrl: 'https://example.com/pic.html' });
    expect(refused.ok).toBe(false);
    expect(refused.detail).toMatch(/not a JPEG, PNG, GIF or WEBP/);
    expect(await library.load()).toHaveLength(0);
  });

  test('the ceiling is X\'s: an image too large for a post is refused, not stored', async () => {
    const huge = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      Buffer.alloc(MEDIA_MAX_BYTES, 3),
    ]);
    const refused = await library.save({ bytes: huge });
    expect(refused.ok).toBe(false);
    expect(refused.detail).toMatch(/over the 5MB ceiling/);
    expect(await library.load()).toHaveLength(0);
  });

  test('no bytes, no entry — honestly', async () => {
    expect((await library.save({})).ok).toBe(false);
    expect((await library.save({ bytes: Buffer.alloc(0) })).ok).toBe(false);
  });

  test('a GIF lands as a GIF — the format is read from the header, and files never overwrite', async () => {
    const first = await library.save({ bytes: gif() });
    expect(first.entry.contentType).toBe('image/gif');
    expect(first.entry.file).toMatch(/\.gif$/);
    const second = await library.save({ bytes: gif() });
    expect(second.entry.file).not.toBe(first.entry.file); // a new id, never an overwrite
    expect(await library.load()).toHaveLength(2);
  });

  test('the manifest lands 0600/0700; a corrupt manifest surfaces, never collapses', async () => {
    await library.save({ bytes: png() });
    expect((await fs.stat(path.join(dir, 'manifest.json'))).mode & 0o777).toBe(0o600);
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
    await fs.writeFile(path.join(dir, 'manifest.json'), '{"not":"an array"}');
    await expect(library.load()).rejects.toThrow('not an array');
  });

  test('a supplied-but-empty root is a BUG, not a request for the default', () => {
    expect(() => createMediaLibrary({ root: '' })).toThrow(TypeError);
  });
});
