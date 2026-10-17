// Attachment store — the gate images pass through before a turn may see
// them. Sanitizer matrix + the real store: wallet scoping, single use,
// expiry (via an injected clock — the store under test is the real one),
// and the pending cap.
import { describe, test, expect } from 'vitest';
import {
  sanitizeImageDataUri, sanitizeImages, createAttachmentStore,
  MAX_IMAGES_PER_MESSAGE, MAX_DATA_URI_CHARS, MAX_PENDING_PER_WALLET, MAX_PENDING_TOTAL,
  sanitizeTextDoc, sanitizeTextDocs, MAX_DOCS_PER_MESSAGE, MAX_DOC_CHARS,
} from '../../backend/services/attachment-store.js';
import { solidPngDataUri } from '../helpers/image-fixtures.js';

const NUL = String.fromCharCode(0);

const RED = solidPngDataUri([255, 0, 0]);
const WALLET = '0xAaAa000000000000000000000000000000000001';
const OTHER = '0xBbBb000000000000000000000000000000000002';

describe('sanitizeImageDataUri', () => {
  test('accepts a real PNG data URI', () => {
    expect(sanitizeImageDataUri(RED)).toEqual({ ok: true, mime: 'image/png' });
  });

  test.each(['jpeg', 'webp', 'gif'])('accepts image/%s', (mime) => {
    expect(sanitizeImageDataUri(`data:image/${mime};base64,AAAA`).ok).toBe(true);
  });

  test('refuses SVG — a scriptable document, not a picture', () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`;
    expect(sanitizeImageDataUri(svg).ok).toBe(false);
  });

  test('refuses non-strings, non-data URIs, and empty bodies', () => {
    for (const bad of [null, 42, {}, 'https://x/y.png', 'data:image/png;base64,', 'data:text/html;base64,AAAA']) {
      expect(sanitizeImageDataUri(bad).ok).toBe(false);
    }
  });

  test('refuses a base64 body smuggling other characters', () => {
    expect(sanitizeImageDataUri('data:image/png;base64,AA<script>').ok).toBe(false);
    // control char built without typing one (harness-safe)
    expect(sanitizeImageDataUri(`data:image/png;base64,AA${String.fromCharCode(10)}AA`).ok).toBe(false);
  });

  test('refuses an oversize image', () => {
    const huge = `data:image/png;base64,${'A'.repeat(MAX_DATA_URI_CHARS)}`;
    expect(sanitizeImageDataUri(huge)).toEqual({ ok: false, reason: 'image too large' });
  });
});

describe('sanitizeImages (all-or-nothing)', () => {
  test('accepts a clean batch and copies it', () => {
    const batch = [RED, RED];
    const out = sanitizeImages(batch);
    expect(out.ok).toBe(true);
    expect(out.images).toEqual(batch);
    expect(out.images).not.toBe(batch);
  });

  test('one bad entry fails the whole batch — nothing half-sends', () => {
    expect(sanitizeImages([RED, 'not-an-image']).ok).toBe(false);
  });

  test('refuses empty, non-array, and over-count batches', () => {
    expect(sanitizeImages([]).ok).toBe(false);
    expect(sanitizeImages('x').ok).toBe(false);
    expect(sanitizeImages(Array(MAX_IMAGES_PER_MESSAGE + 1).fill(RED)).ok).toBe(false);
  });
});

describe('createAttachmentStore', () => {
  test('put then take round-trips, and an id is single-use', () => {
    const store = createAttachmentStore();
    const { ids } = store.put(WALLET, [RED]);
    expect(store.take(ids[0], WALLET)).toBe(RED);
    expect(store.take(ids[0], WALLET)).toBeNull(); // consumed
  });

  test('an id is worthless to any other wallet — and survives the attempt', () => {
    const store = createAttachmentStore();
    const { ids } = store.put(WALLET, [RED]);
    expect(store.take(ids[0], OTHER)).toBeNull();
    expect(store.take(ids[0], WALLET)).toBe(RED); // a failed theft must not consume it
  });

  test('entries expire by the injected clock', () => {
    let t = 1_000_000;
    const store = createAttachmentStore({ ttlMs: 500, now: () => t });
    const { ids } = store.put(WALLET, [RED]);
    t += 501;
    expect(store.take(ids[0], WALLET)).toBeNull();
    expect(store.pendingCount(WALLET)).toBe(0); // swept, not lingering
  });

  test('pending cap refuses honestly, per wallet', () => {
    const store = createAttachmentStore();
    for (let i = 0; i < MAX_PENDING_PER_WALLET; i++) store.put(WALLET, [RED]);
    expect(store.put(WALLET, [RED]).ok).toBe(false);
    expect(store.put(OTHER, [RED]).ok).toBe(true); // another wallet is unaffected
  });

  test('a crowd of wallets hits the GLOBAL ceiling — cheap auth cannot grow the heap', () => {
    const store = createAttachmentStore();
    const wallets = Math.ceil(MAX_PENDING_TOTAL / MAX_PENDING_PER_WALLET) + 1;
    let refused = null;
    for (let w = 0; w < wallets && !refused; w++) {
      for (let i = 0; i < MAX_PENDING_PER_WALLET; i++) {
        const out = store.put(`0xcyc1e${w.toString(16).padStart(34, '0')}`, [RED]);
        if (!out.ok) { refused = out; break; }
      }
    }
    expect(refused?.reason).toMatch(/store is full/);
    // ...and expiry frees it again (injected-clock variant proven above).
  });

  test('the store is payload-agnostic — a text-document object round-trips whole', () => {
    const store = createAttachmentStore();
    const doc = { kind: 'text', name: 'notes.md', text: '# hi' };
    const { ids } = store.put(WALLET, [doc]);
    expect(store.take(ids[0], WALLET)).toEqual(doc); // same object shape back
    expect(store.take(ids[0], WALLET)).toBeNull();   // single-use, like an image
  });

  test('images and documents can be parked together and each redeems to its own shape', () => {
    const store = createAttachmentStore();
    const doc = { kind: 'text', name: 'a.txt', text: 'body' };
    const { ids } = store.put(WALLET, [RED, doc]);
    expect(store.take(ids[0], WALLET)).toBe(RED);   // image is a string
    expect(store.take(ids[1], WALLET)).toEqual(doc); // doc is an object
  });
});

describe('sanitizeTextDoc', () => {
  test('accepts a real text document and cleans its name to a basename', () => {
    const r = sanitizeTextDoc({ name: 'src/deep/vad.js', text: 'export const x = 1;' });
    expect(r.ok).toBe(true);
    expect(r.doc.name).toBe('vad.js'); // path stripped
    expect(r.doc.text).toBe('export const x = 1;');
  });

  test('a missing name falls back to "document"', () => {
    expect(sanitizeTextDoc({ text: 'hi' }).doc.name).toBe('document');
  });

  test('refuses a non-object, a missing/empty text, and an over-size text', () => {
    expect(sanitizeTextDoc('nope').ok).toBe(false);
    expect(sanitizeTextDoc({ name: 'x' }).ok).toBe(false);       // no text
    expect(sanitizeTextDoc({ text: '' }).ok).toBe(false);        // empty
    expect(sanitizeTextDoc({ text: 'x'.repeat(MAX_DOC_CHARS + 1) }).ok).toBe(false);
  });

  test('refuses a binary payload (NUL byte) — text with certainty, not by extension', () => {
    const r = sanitizeTextDoc({ name: 'evil.txt', text: `looks fine${NUL}then binary` });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/binary/);
  });

  test('strips control characters from the display name', () => {
    const r = sanitizeTextDoc({ name: `bad${String.fromCharCode(9)}name.md`, text: 'x' });
    expect(r.doc.name).toBe('bad name.md');
  });
});

describe('sanitizeTextDocs (batch)', () => {
  test('an absent field is fine — no documents', () => {
    expect(sanitizeTextDocs(undefined)).toEqual({ ok: true, docs: [] });
  });

  test('all-or-nothing: one bad doc fails the batch', () => {
    const r = sanitizeTextDocs([{ text: 'ok' }, { text: '' }]);
    expect(r.ok).toBe(false);
  });

  test('refuses more than the per-message document cap', () => {
    const many = Array.from({ length: MAX_DOCS_PER_MESSAGE + 1 }, () => ({ text: 'x' }));
    expect(sanitizeTextDocs(many).ok).toBe(false);
  });
});
