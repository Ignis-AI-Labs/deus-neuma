/**
 * THE GALLERY's organizing law (pure display) and its root allowlist (pure
 * fold). Real functions, real inputs, no mock (RULE 0).
 */
import { describe, test, expect, vi } from 'vitest';
import {
  applyView, groupByDay, readableBytes, fileUrl, itemKey, neighborOf, positionOf, madeOn, plaqueOf, KINDS, SORTS,
} from '../../frontend/app/RelinkShell/gallery/gallery-view.js';
import { applyRootChange, builtInRoots, rootById, COMFY_ROOT_ID } from '../../backend/services/gallery/gallery-roots.js';
import { parseByteRange } from '../../backend/routes/gallery-routes.js';

const item = (over = {}) => ({
  rootId: 'r1', rootLabel: 'R1', rel: 'a.png', name: 'a.png',
  kind: 'image', mime: 'image/png', bytes: 100, modified: 1000, ...over,
});

describe('applyView', () => {
  const items = [
    item({ name: 'b.png', modified: 3000, bytes: 300 }),
    item({ name: 'a.png', modified: 1000, bytes: 900 }),
    item({ name: 'c.mp4', kind: 'video', modified: 2000, bytes: 50, rootId: 'r2' }),
  ];

  test('defaults to newest first — the thing you just made', () => {
    expect(applyView(items).items.map((i) => i.name)).toEqual(['b.png', 'c.mp4', 'a.png']);
  });

  test('filters by kind', () => {
    expect(applyView(items, { kind: 'video' }).items.map((i) => i.name)).toEqual(['c.mp4']);
    expect(applyView(items, { kind: 'image' }).items).toHaveLength(2);
  });

  test('counts describe the FOLDER scope, not the kind scope', () => {
    // Otherwise selecting VIDEOS would report "0 images" and read as broken.
    const { counts } = applyView(items, { kind: 'video' });
    expect(counts).toEqual({ all: 3, image: 2, video: 1 });
  });

  test('filters by folder, and counts follow it', () => {
    const { items: got, counts } = applyView(items, { rootId: 'r2' });
    expect(got.map((i) => i.name)).toEqual(['c.mp4']);
    expect(counts).toEqual({ all: 1, image: 0, video: 1 });
  });

  test('searches by name, case-insensitively', () => {
    expect(applyView(items, { query: 'C.MP' }).items.map((i) => i.name)).toEqual(['c.mp4']);
    expect(applyView(items, { query: 'nothing' }).items).toEqual([]);
  });

  test('sorts by each offered axis', () => {
    expect(applyView(items, { sort: 'oldest' }).items[0].name).toBe('a.png');
    expect(applyView(items, { sort: 'largest' }).items[0].name).toBe('a.png');
    expect(applyView(items, { sort: 'name' }).items.map((i) => i.name)).toEqual(['a.png', 'b.png', 'c.mp4']);
  });

  test('name sort is natural, so img10 follows img9', () => {
    const nums = [item({ name: 'img10.png' }), item({ name: 'img9.png' }), item({ name: 'img1.png' })];
    expect(applyView(nums, { sort: 'name' }).items.map((i) => i.name))
      .toEqual(['img1.png', 'img9.png', 'img10.png']);
  });

  test('does not mutate the input list', () => {
    const before = items.map((i) => i.name);
    applyView(items, { sort: 'name' });
    expect(items.map((i) => i.name)).toEqual(before);
  });

  test('survives junk input and unknown view values', () => {
    expect(applyView(null).items).toEqual([]);
    expect(applyView(items, { kind: 'nope', sort: 'nope' }).items).toHaveLength(3);
  });

  test('every offered kind and sort is honoured', () => {
    for (const k of KINDS) expect(() => applyView(items, { kind: k })).not.toThrow();
    for (const s of SORTS) expect(applyView(items, { sort: s.id }).items).toHaveLength(3);
  });
});

describe('groupByDay', () => {
  test('groups by local calendar day, preserving the incoming order', () => {
    const d1 = new Date(2026, 7, 1, 10).getTime();
    const d2 = new Date(2026, 7, 2, 10).getTime();
    const groups = groupByDay([item({ modified: d2 }), item({ modified: d2 }), item({ modified: d1 })]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items).toHaveLength(1);
  });

  test('an unreadable timestamp lands in its own bucket rather than throwing', () => {
    expect(groupByDay([item({ modified: NaN })])[0].key).toBe('unknown');
  });
});

describe('readableBytes / fileUrl', () => {
  test('scales the unit', () => {
    expect(readableBytes(512)).toBe('512 B');
    expect(readableBytes(2048)).toBe('2 KB');
    expect(readableBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  test('refuses to invent a size', () => {
    expect(readableBytes(undefined)).toBe('');
    expect(readableBytes(-1)).toBe('');
  });

  test('encodes the path so a name with spaces or & still resolves', () => {
    const url = fileUrl(item({ rel: 'sub dir/a & b.png', rootId: 'r 1' }));
    expect(url).toContain('rootId=r%201');
    expect(url).toContain('rel=sub%20dir%2Fa%20%26%20b.png');
  });
});

// The src a plain <img>/<video> is handed. `fileUrl` stays pure; the token is
// added here, at the one impure edge that knows about a session.
describe('fileSrc — the token an element can carry', () => {
  const withSession = async (token, fn) => {
    const store = new Map(token === null ? [] : [['authToken', token]]);
    globalThis.sessionStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    vi.resetModules();
    try {
      const { fileSrc } = await import('../../frontend/services/gallery-client.js');
      await fn(fileSrc);
    } finally {
      delete globalThis.sessionStorage;
      vi.resetModules();
    }
  };

  test('appends the session token, so the element’s own GET is authenticated', () =>
    withSession('tok-123', (fileSrc) => {
      const src = fileSrc(item());
      expect(src).toContain('/api/v1/gallery/file?');
      expect(src).toContain('&token=tok-123');
    }));

  test('encodes the token — a base64 token carries + / and =', () =>
    withSession('a+b/c=', (fileSrc) => {
      expect(fileSrc(item())).toContain('&token=a%2Bb%2Fc%3D');
    }));

  test('no session ⇒ no empty token= param, just the plain url (the route 401s honestly)', () =>
    withSession(null, (fileSrc) => {
      const src = fileSrc(item());
      expect(src).toBe(fileUrl(item()));
      expect(src).not.toContain('token=');
    }));
});

describe('the root allowlist — the whole of the gallery’s reach', () => {
  test('ComfyUI output is built in, so a fresh install has a working gallery', () => {
    const built = builtInRoots({ outputDir: '/data/comfyui/output' });
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({ id: COMFY_ROOT_ID, dir: '/data/comfyui/output', builtIn: true });
  });

  test('no comfy config ⇒ no built-in root, rather than a bogus one', () => {
    expect(builtInRoots({})).toEqual([]);
    expect(builtInRoots(null)).toEqual([]);
  });

  test('adding a folder appends it with a stable id', () => {
    const r = applyRootChange([], { op: 'add', dir: '/media/photos' });
    expect(r.ok).toBe(true);
    expect(r.roots[0]).toMatchObject({ dir: '/media/photos', label: 'photos' });
    // Same input, same id — so a re-add is recognisably the same row.
    expect(applyRootChange([], { op: 'add', dir: '/media/photos' }).roots[0].id).toBe(r.roots[0].id);
  });

  test('adding the same folder twice is a no-op, not a duplicate scan', () => {
    const once = applyRootChange([], { op: 'add', dir: '/media/photos' }).roots;
    expect(applyRootChange(once, { op: 'add', dir: '/media/photos/' }).roots).toHaveLength(1);
  });

  test('a relative path is refused — a root must be unambiguous', () => {
    const r = applyRootChange([], { op: 'add', dir: 'photos' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/absolute/);
  });

  test('removing works, and the built-in root cannot be removed', () => {
    const roots = applyRootChange([], { op: 'add', dir: '/media/photos' }).roots;
    expect(applyRootChange(roots, { op: 'remove', id: roots[0].id }).roots).toEqual([]);
    const blocked = applyRootChange(roots, { op: 'remove', id: COMFY_ROOT_ID });
    expect(blocked.ok).toBe(false);
    expect(blocked.roots).toHaveLength(1);
  });

  test('an unknown op changes nothing', () => {
    const roots = applyRootChange([], { op: 'add', dir: '/a' }).roots;
    expect(applyRootChange(roots, { op: 'wat' }).ok).toBe(false);
  });

  test('rootById is the gate — an unknown id resolves to nothing', () => {
    const roots = applyRootChange([], { op: 'add', dir: '/a' }).roots;
    expect(rootById(roots, roots[0].id)).toBeTruthy();
    expect(rootById(roots, 'made-up')).toBeNull();
  });
});

describe('parseByteRange — RFC 7233, the form a <video> actually sends', () => {
  const m = (spec) => /^bytes=(\d*)-(\d*)$/.exec(spec);

  test('SUFFIX `bytes=-N` is the LAST N bytes, not the first N', () => {
    // The defect both lenses caught: reading match[1] as a plain falsy check
    // served bytes 0..N and returned 206 claiming it was right.
    expect(parseByteRange(m('bytes=-500'), 2048)).toEqual({ start: 1548, end: 2047 });
  });

  test('a suffix larger than the file clamps to the whole file', () => {
    expect(parseByteRange(m('bytes=-9999'), 100)).toEqual({ start: 0, end: 99 });
  });

  test('open-ended `bytes=N-` runs to the end', () => {
    expect(parseByteRange(m('bytes=100-'), 2048)).toEqual({ start: 100, end: 2047 });
  });

  test('closed `bytes=A-B` is honoured and clamped to the file', () => {
    expect(parseByteRange(m('bytes=0-99'), 2048)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange(m('bytes=0-9999'), 2048)).toEqual({ start: 0, end: 2047 });
  });

  test('unsatisfiable ranges answer null so the route can 416', () => {
    expect(parseByteRange(m('bytes=5000-'), 2048)).toBeNull();   // start past EOF
    expect(parseByteRange(m('bytes=100-50'), 2048)).toBeNull();  // inverted
    expect(parseByteRange(m('bytes=-'), 2048)).toBeNull();       // names nothing
    expect(parseByteRange(m('bytes=-0'), 2048)).toBeNull();      // zero-length suffix
    expect(parseByteRange(m('bytes=0-0'), 0)).toBeNull();        // empty file
  });
});

describe('viewer navigation — the left/right keys', () => {
  const a = item({ rel: 'a.png', name: 'a.png', modified: 3000 });
  const b = item({ rel: 'b.png', name: 'b.png', modified: 2000 });
  const c = item({ rel: 'c.mp4', name: 'c.mp4', kind: 'video', modified: 1000 });
  const view = [a, b, c]; // newest-first, as the grid shows them

  test('identity is the ROOT+PATH pair, not either alone', () => {
    // Two roots can both hold `shot.png`; neither half addresses a file.
    expect(itemKey(a)).toBe('r1:a.png');
    expect(itemKey({ rootId: 'r2', rel: 'a.png' })).not.toBe(itemKey(a));
  });

  test('right steps forward, left steps back', () => {
    expect(neighborOf(view, a, 1)).toBe(b);
    expect(neighborOf(view, b, 1)).toBe(c);
    expect(neighborOf(view, b, -1)).toBe(a);
  });

  test('does NOT wrap at either end', () => {
    // Silently reappearing at the far end makes a long gallery impossible to
    // keep your place in, and nothing cues that it happened.
    expect(neighborOf(view, a, -1)).toBeNull();
    expect(neighborOf(view, c, 1)).toBeNull();
  });

  test('walks the FILTERED view, so arrowing inside VIDEOS stays on videos', () => {
    const videos = applyView(view, { kind: 'video' }).items;
    expect(videos).toHaveLength(1);
    expect(neighborOf(videos, c, 1)).toBeNull();
    expect(neighborOf(videos, c, -1)).toBeNull();
  });

  test('an item no longer in the view has no neighbour', () => {
    // What happens when a filter hides whatever is open.
    expect(neighborOf(view, item({ rel: 'gone.png' }), 1)).toBeNull();
  });

  test('junk input never throws in the render path', () => {
    expect(neighborOf(null, a, 1)).toBeNull();
    expect(neighborOf(view, null, 1)).toBeNull();
    expect(neighborOf(view, a, undefined)).toBe(a);
  });

  test('position reads as 1-based "n of total"', () => {
    expect(positionOf(view, a)).toEqual({ index: 1, total: 3 });
    expect(positionOf(view, c)).toEqual({ index: 3, total: 3 });
    expect(positionOf(view, item({ rel: 'gone.png' }))).toBeNull();
    expect(positionOf(view, null)).toBeNull();
  });
});

describe('the wall label', () => {
  // Built in LOCAL time from the date's own parts, so the label is the same
  // string on every machine — constructed locally here for the same reason.
  const evening = new Date(2026, 7, 5, 19, 24).getTime();

  test('reads as a date a person remembers, not a timestamp', () => {
    expect(madeOn(evening)).toBe('5 AUG 2026 · 7:24 PM');
  });

  test('midnight and noon are not both 0 or both 12', () => {
    expect(madeOn(new Date(2026, 0, 1, 0, 5).getTime())).toBe('1 JAN 2026 · 12:05 AM');
    expect(madeOn(new Date(2026, 0, 1, 12, 5).getTime())).toBe('1 JAN 2026 · 12:05 PM');
  });

  test('a time that is not a time says nothing rather than "Invalid Date"', () => {
    expect(madeOn(undefined)).toBe('');
    expect(madeOn('not a date')).toBe('');
  });

  test('carries maker, accession and the facts', () => {
    const plaque = plaqueOf(
      item({ name: 'b2d90097.png', rootLabel: 'CAEL', bytes: 758784, modified: evening }),
      { w: 1024, h: 1024 },
    );
    expect(plaque.maker).toBe('CAEL');
    expect(plaque.accession).toBe('b2d90097.png');
    expect(plaque.facts).toEqual(['5 AUG 2026 · 7:24 PM', '1024 × 1024', '741 KB']);
  });

  test('dimensions are absent until the browser has decoded the work — never guessed', () => {
    const before = plaqueOf(item({ bytes: 100, modified: evening }), { w: 0, h: 0 });
    expect(before.facts).toEqual(['5 AUG 2026 · 7:24 PM', '100 B']);
    expect(plaqueOf(item({ bytes: 100, modified: evening }), null).facts).toHaveLength(2);
  });

  test('an item with nothing to say produces an empty label, not a crash', () => {
    expect(plaqueOf(null, null)).toEqual({ maker: '', accession: '', facts: [] });
  });
});
