/**
 * image-view-model — which files are pictures, and how they are labelled.
 *
 * Design note, 2026-08-30: […]
 *
 * RULE 0: every function here is pure and is called with real inputs. The
 * routing predicate is the load-bearing one — it decides whether a file opens
 * in a viewer that can show it or an editor that will only say
 * […]
 */
import { describe, test, expect } from 'vitest';
import {
  extOf, isImagePath, imageMime, byteLabel, stepZoom, zoomLabel,
} from '../../frontend/app/RelinkShell/files/image-view-model.js';

describe('which files are pictures', () => {
  test('the formats a browser can decode', () => {
    for (const p of ['/a/b.png', '/a/b.jpg', '/a/b.jpeg', '/a/b.gif', '/a/b.webp', '/a/b.avif', '/a/b.bmp', '/a/b.ico', '/a/b.svg']) {
      expect(isImagePath(p), p).toBe(true);
    }
  });

  test('CASE DOES NOT MATTER — a render off a camera is often .PNG', () => {
    expect(isImagePath('/cards/UMBRAE-MILESTONE.PNG')).toBe(true);
    expect(isImagePath('/a/B.JpEg')).toBe(true);
  });

  test('everything else keeps the editor', () => {
    for (const p of ['/a/b.md', '/a/b.js', '/a/b.pdf', '/a/b.txt', '/a/b', '/a/b.pngx', '/a/b.zip']) {
      expect(isImagePath(p), p).toBe(false);
    }
  });

  test('a PDF is NOT an image — it has its own reader', () => {
    // Routing it here would take the document away from pdf.js and hand it to
    // an <img>, which would show nothing at all.
    expect(isImagePath('/a/paper.pdf')).toBe(false);
  });

  test('a dotfile has no extension, and is not a picture', () => {
    expect(extOf('/repo/.gitignore')).toBe('');
    expect(isImagePath('/repo/.gitignore')).toBe(false);
    // …but a dotfile CAN still carry one.
    expect(isImagePath('/repo/.hidden.png')).toBe(true);
  });

  test('a path with dots in its folders is judged by the FILE', () => {
    expect(isImagePath('/repo/v1.2.3/notes.md')).toBe(false);
    expect(isImagePath('/repo/v1.2.3/shot.png')).toBe(true);
  });

  test('junk is not a picture, and does not throw', () => {
    expect(isImagePath(null)).toBe(false);
    expect(isImagePath(undefined)).toBe(false);
    expect(isImagePath('')).toBe(false);
  });
});

describe('the MIME the blob must wear', () => {
  test('restored from the extension — /raw serves octet-stream for everything', () => {
    // Without this the browser gets bytes it will not decode, and the picture
    // silently does not appear.
    expect(imageMime('/a/b.png')).toBe('image/png');
    expect(imageMime('/a/b.JPG')).toBe('image/jpeg');
    expect(imageMime('/a/b.jpeg')).toBe('image/jpeg');
    expect(imageMime('/a/b.svg')).toBe('image/svg+xml');
  });

  test('an unknown extension falls back rather than lying', () => {
    expect(imageMime('/a/b.xyz')).toBe('application/octet-stream');
  });
});

describe('the facts on the bar', () => {
  test('bytes read in the register a person uses', () => {
    expect(byteLabel(512)).toBe('512 B');
    expect(byteLabel(2048)).toBe('2 KB');
    expect(byteLabel(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });

  test('an unknown size is absent, never a zero', () => {
    expect(byteLabel(null)).toBe(null);
    expect(byteLabel(undefined)).toBe(null);
    expect(byteLabel('nope')).toBe(null);
  });
});

describe('the zoom rungs', () => {
  test('FIT is a rung, and it is the floor', () => {
    expect(zoomLabel(0)).toBe('FIT');
    expect(stepZoom(0, -1)).toBe(0);
  });

  test('stepping up and down walks the rungs and clamps at the ceiling', () => {
    expect(stepZoom(0, 1)).toBe(0.25);
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(1, -1)).toBe(0.5);
  });

  test('a zoom off the ladder is treated as 100%', () => {
    expect(stepZoom(0.77, 1)).toBe(2);
  });

  test('percentages read as whole numbers', () => {
    expect(zoomLabel(0.25)).toBe('25%');
    expect(zoomLabel(2)).toBe('200%');
  });
});
