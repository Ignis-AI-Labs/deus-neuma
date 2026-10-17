/**
 * READING AN IMAGE, END TO END, THROUGH THE REAL ORGAN.
 *
 * Design note, 2026-08-29: […]
 *
 * The unit tests pin the bridge; this pins the WALK. A real PNG on a real
 * disk, read through the real in-process filesystem organ with its real path
 * validation, then through the real sight bridge and the real fold — the
 * whole path a being takes when it asks to look at a picture.
 *
 * No mocks (RULE 0). The only thing not present is the model itself, and the
 * assertion is precisely what the model would be handed.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { nativeFilesystemClient, isSightablePath, mediaMimeFor } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { withFileSight } from '../../backend/services/fs-sight.js';
import { foldSight } from '../../backend/services/image-forge/image-sight.js';
import { withFsRouting } from '../../backend/services/fs-primitives.js';
import { takeEphemeralSight } from '../../backend/services/image-forge/ephemeral-sight.js';

// A real 1x1 PNG. Bytes, not a fixture string pretending to be one.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const LANE = 'metidar';

let dir;
const call = (name, args) => nativeFilesystemClient.callTool({ name, arguments: args });

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'fs-sight-'));
  mkdirSync(path.join(dir, 'art'), { recursive: true });
  writeFileSync(path.join(dir, 'art', 'card.png'), PNG);
  writeFileSync(path.join(dir, 'art', 'notes.md'), '# a real text file\nwith lines\n');
  writeFileSync(path.join(dir, 'art', 'tune.mp3'), Buffer.from([0xff, 0xfb, 0x00, 0x00]));
  await setNativeFilesystemRoots([dir]);
});

afterAll(async () => {
  await setNativeFilesystemRoots([]);
  rmSync(dir, { recursive: true, force: true });
});

describe('THE REGRESSION: a plain read of a PNG shows the picture', () => {
  test('read_text_file on an image comes back as SIGHT, not as empty text', async () => {
    // This is Metidar's exact failure. The being read a .png with the ordinary
    // read verb and got nothing usable back — silently. Now the same call puts
    // the image in front of it.
    const raw = await call('read_text_file', { path: path.join(dir, 'art', 'card.png') });
    const result = withFileSight(raw, LANE);

    const refs = foldSight([{ status: 'ok', ...result }]);
    expect(refs, 'the eye saw nothing — the bridge is not wired').toHaveLength(1);
    expect(refs[0].laneId).toBe(LANE);
    expect(refs[0].store).toBe('ephemeral');

    // ...and the bytes really are the file's.
    const entry = takeEphemeralSight(refs[0].laneId, refs[0].imageId);
    expect(entry.mime).toBe('image/png');
    expect(entry.bytes.equals(PNG)).toBe(true);
  });

  test('what the model is handed is a short line, never the base64', async () => {
    const raw = await call('read_text_file', { path: path.join(dir, 'art', 'card.png') });
    const result = withFileSight(raw, LANE);
    const text = JSON.stringify(result.content);
    expect(text).not.toContain(PNG.toString('base64'));
    expect(text.length).toBeLessThan(400);
    expect(result.content.at(-1).text).toMatch(/next turn/i);
  });

  test('head/tail on an image are ignored rather than refused', async () => {
    // Asking for the first 20 lines of a PNG is a wrong question, not a fatal
    // one — the being still gets to look at the picture.
    const raw = await call('read_text_file', { path: path.join(dir, 'art', 'card.png'), head: 20 });
    expect(foldSight([{ status: 'ok', ...withFileSight(raw, LANE) }])).toHaveLength(1);
  });

  test('the deprecated read_file name walks the same path', async () => {
    const raw = await call('read_file', { path: path.join(dir, 'art', 'card.png') });
    expect(foldSight([{ status: 'ok', ...withFileSight(raw, LANE) }])).toHaveLength(1);
  });
});

describe('everything that is not an image is untouched', () => {
  test('a text file still reads as text, and pays nothing for any of this', async () => {
    const raw = await call('read_text_file', { path: path.join(dir, 'art', 'notes.md') });
    const result = withFileSight(raw, LANE);
    expect(result).toBe(raw);                       // the very same object
    expect(result.sight).toBeUndefined();
    expect(JSON.stringify(result)).toContain('a real text file');
  });

  test('head still works on a text file', async () => {
    const raw = await call('read_text_file', { path: path.join(dir, 'art', 'notes.md'), head: 1 });
    const text = JSON.stringify(raw);
    expect(text).toContain('a real text file');
    expect(text).not.toContain('with lines');
  });

  test('AUDIO is not routed to the eye — a promise of a look must be keepable', async () => {
    // The organ still returns audio as an audio block; the bridge leaves it
    // alone. Telling a being it is about to see a sound would be a lie.
    const raw = await call('read_text_file', { path: path.join(dir, 'art', 'tune.mp3') });
    expect(withFileSight(raw, LANE).sight).toBeUndefined();
  });
});

describe('the batch read says what it cannot show', () => {
  test('an image in read_multiple_files names the gesture that CAN show it', async () => {
    // A batch read joins many files into one string; an image has no place in
    // that. It used to return the same silent nothing.
    const raw = await call('read_multiple_files', {
      paths: [path.join(dir, 'art', 'notes.md'), path.join(dir, 'art', 'card.png')],
    });
    const text = JSON.stringify(raw);
    expect(text).toContain('a real text file');
    expect(text).toMatch(/this is an image/i);
    expect(text).toMatch(/read it on its own/i);
    expect(text).not.toContain(PNG.toString('base64'));
  });
});

describe('the type gate itself', () => {
  test('only what the eye takes is called sightable', () => {
    for (const ok of ['a.png', 'A.PNG', 'b.jpg', 'c.jpeg', 'd.webp', '/deep/path/e.png']) {
      expect(isSightablePath(ok), ok).toBe(true);
    }
    for (const no of ['a.svg', 'a.gif', 'a.bmp', 'a.mp3', 'a.md', 'a', '', null, undefined]) {
      expect(isSightablePath(no), String(no)).toBe(false);
    }
  });

  test('mediaMimeFor answers for media and stays silent otherwise', () => {
    expect(mediaMimeFor('x.png')).toBe('image/png');
    expect(mediaMimeFor('x.mp3')).toBe('audio/mpeg');
    expect(mediaMimeFor('x.md')).toBeNull();
  });

  test('a path outside the allowed roots is still refused, image or not', async () => {
    // The bridge must not have widened the wall it stands behind.
    const out = await call('read_text_file', { path: '/etc/hosts' });
    expect(out.isError).toBe(true);
  });
});

describe('THE BEING’S ACTUAL VERB: fs/read, through the real routing layer', () => {
  // A being never sees the 16 organ names — it has five primitives, and
  // `fs/read` is the only read it knows (fs-primitives.js). `withFsRouting`
  // wraps the SANDBOX, so this is the exact composition a turn runs:
  //     fs/read  →  routing  →  sandbox (where sight is stamped)  →  organ
  // If the bridge were on the wrong side of that wrap, an image would still
  // never reach the eye. This is the test that says it is on the right one.
  const sandboxLike = async (_server, toolName, args) => {
    const raw = await call(toolName, args);
    return withFileSight(raw, LANE);           // exactly what the sandbox does last
  };
  const beingCallTool = withFsRouting(sandboxLike);

  test('fs/read on a PNG lands sight the fold can see', async () => {
    const result = await beingCallTool('fs', 'read', {
      path: path.join(dir, 'art', 'card.png'),
    });
    const refs = foldSight([{ status: 'ok', ...result }]);
    expect(refs, 'fs/read did not reach the eye').toHaveLength(1);
    expect(refs[0].laneId).toBe(LANE);
    const entry = takeEphemeralSight(refs[0].laneId, refs[0].imageId);
    expect(entry.bytes.equals(PNG)).toBe(true);
  });

  test('fs/read on a text file is unchanged, and still reads', async () => {
    const result = await beingCallTool('fs', 'read', {
      path: path.join(dir, 'art', 'notes.md'),
    });
    expect(result.sight).toBeUndefined();
    expect(JSON.stringify(result)).toContain('a real text file');
  });

  test('fs/read with several paths still batches, and flags the image', async () => {
    const result = await beingCallTool('fs', 'read', {
      paths: [path.join(dir, 'art', 'notes.md'), path.join(dir, 'art', 'card.png')],
    });
    const text = JSON.stringify(result);
    expect(text).toContain('a real text file');
    expect(text).toMatch(/this is an image/i);
  });
});
