/**
 * AI disclosure in the file itself (ai-disclosure.js) — real bytes, a real PNG
 * and a real LTX clip, read back by the real ffprobe. No mocks (RULE 0).
 */
import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DISCLOSURE, SOFTWARE, stampPng, stampDisclosure } from '../../backend/services/image-forge/ai-disclosure.js';

const PNG_2X2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z4AATAxIHAgLADS3AR6O5ZFyAAAAAElFTkSuQmCC', 'base64');
const CLIP = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'fixtures', 'forge', 'ltx-clip.mp4');
const probe = (file, args) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-of', 'json', ...args, file], { encoding: 'utf8' }));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'forge-disclosure-'));

describe('a PNG says it was made by AI', () => {
  test('the disclosure chunks sit after IHDR and the image still decodes, unchanged in size', () => {
    const stamped = stampPng(PNG_2X2);
    const text = stamped.toString('latin1');
    expect(text.indexOf('tEXtSoftware')).toBeGreaterThan(text.indexOf('IHDR'));
    expect(text).toContain(DISCLOSURE);
    expect(text).toContain(SOFTWARE);
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'x.png'), stamped);
    expect(probe(path.join(dir, 'x.png'), ['-show_entries', 'stream=width,height']).streams[0]).toEqual({ width: 2, height: 2 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('bytes that are not a PNG are left alone, never mangled', () => {
    expect(stampPng(Buffer.from('not a png at all, just text bytes'))).toBe(null);
  });
});

describe('a clip says it was made by AI', () => {
  test('the mp4 carries the disclosure tags; frames, sound and length are untouched (stream copy)', () => {
    const dir = tmp();
    const file = path.join(dir, 'clip.mp4');
    fs.copyFileSync(CLIP, file);
    const before = probe(file, ['-show_entries', 'stream=codec_name,nb_frames:format=duration']);
    expect(stampDisclosure(file, 'video/mp4')).toBe(true);
    const after = probe(file, ['-show_entries', 'stream=codec_name,nb_frames:format=duration:format_tags']);
    expect(after.format.tags.comment).toBe(DISCLOSURE);
    expect(after.streams).toEqual(before.streams);
    expect(Number(after.format.duration)).toBeCloseTo(Number(before.format.duration), 2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a file that cannot be stamped reports false and stays as it was', () => {
    const dir = tmp();
    const file = path.join(dir, 'broken.mp4');
    fs.writeFileSync(file, 'not a video');
    expect(stampDisclosure(file, 'video/mp4')).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('not a video');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
