// Composer attachment rules (frontend pure layer): what may ride, how many,
// and how files are lifted out of a paste/drop DataTransfer structure.
// filesFrom is exercised for real in the image-share e2e (a genuine
// ClipboardEvent in a real browser); here its selection logic runs over the
// same structural shape the browser hands it.
import { describe, test, expect } from 'vitest';
import {
  rejectReason, admitFiles, filesFrom, classifyFile,
  MAX_IMAGES, MAX_IMAGE_BYTES, MAX_DOCS, MAX_DOC_BYTES,
} from '../../frontend/app/RelinkShell/attachments.js';

const png = (size = 1024) => ({ type: 'image/png', size, name: 'shot.png' });
const doc = (name = 'notes.md', size = 1024, type = '') => ({ type, size, name });

describe('classifyFile', () => {
  test('the four image types are images', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(classifyFile({ type, name: 'x' })).toBe('image');
    }
  });

  test('code/doc files are docs — by extension even when the browser gives no MIME', () => {
    for (const name of ['main.rs', 'app.tsx', 'notes.md', 'data.csv', 'config.yaml', 'q.sql']) {
      expect(classifyFile({ type: '', name })).toBe('doc');
    }
    expect(classifyFile({ type: 'text/plain', name: 'x' })).toBe('doc'); // text/* MIME
    expect(classifyFile({ type: '', name: 'Dockerfile' })).toBe('doc');  // extensionless known name
  });

  test('common text DOTFILES classify as docs (leading-dot handling)', () => {
    for (const name of ['.gitignore', '.env', '.editorconfig', '.dockerignore', '.npmrc']) {
      expect(classifyFile({ type: '', name })).toBe('doc');
    }
  });

  test('SVG and truly-binary/unknown files are neither', () => {
    expect(classifyFile({ type: 'image/svg+xml', name: 'a.svg' })).toBeNull();
    expect(classifyFile({ type: 'application/zip', name: 'a.zip' })).toBeNull();
    expect(classifyFile({ type: 'application/octet-stream', name: 'a.bin' })).toBeNull();
  });
});

describe('rejectReason', () => {
  test('accepts images and documents under their size caps', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(rejectReason({ type, size: 10, name: 'x' })).toBeNull();
    }
    expect(rejectReason(doc('main.rs', 10))).toBeNull();
  });

  test('refuses SVG, unknown binaries, and the oversized (per kind)', () => {
    expect(rejectReason({ type: 'image/svg+xml', size: 10, name: 'a.svg' })).toMatch(/images|documents/);
    expect(rejectReason({ type: 'application/zip', size: 10, name: 'a.zip' })).toMatch(/images|documents/);
    expect(rejectReason(null)).toMatch(/images|documents/);
    expect(rejectReason({ type: 'image/png', size: MAX_IMAGE_BYTES + 1, name: 'x' })).toMatch(/4MB/);
    expect(rejectReason(doc('big.log', MAX_DOC_BYTES + 1))).toMatch(/2MB/);
  });
});

describe('admitFiles', () => {
  test('admits images under the cap, refuses the overflow with one honest line', () => {
    const pending = [png(), png(), png()].map((f) => ({ kind: 'image', ...f }));
    const { accepted, refusal } = admitFiles(pending, [png(), png()]);
    expect(accepted).toHaveLength(MAX_IMAGES - pending.length);
    expect(accepted.every((a) => a.kind === 'image')).toBe(true);
    expect(refusal).toMatch(/At most 4 images/);
  });

  test('images and documents have independent caps and both admit', () => {
    const { accepted, refusal } = admitFiles([], [png(), doc('a.md'), png(), doc('b.ts')]);
    expect(accepted.filter((a) => a.kind === 'image')).toHaveLength(2);
    expect(accepted.filter((a) => a.kind === 'doc')).toHaveLength(2);
    expect(refusal).toBeNull();
  });

  test('the document cap refuses overflow independently of images', () => {
    const docs = Array.from({ length: MAX_DOCS + 1 }, (_, i) => doc(`f${i}.txt`));
    const { accepted, refusal } = admitFiles([], [png(), ...docs]);
    expect(accepted.filter((a) => a.kind === 'doc')).toHaveLength(MAX_DOCS);
    expect(accepted.filter((a) => a.kind === 'image')).toHaveLength(1); // image unaffected
    expect(refusal).toMatch(/At most 5 documents/);
  });

  test('an unsupported file is skipped with an honest line, good ones still admit', () => {
    const { accepted, refusal } = admitFiles([], [png(), { type: 'application/zip', size: 5, name: 'a.zip' }, doc('ok.md')]);
    expect(accepted).toHaveLength(2); // png + md
    expect(refusal).toMatch(/images|documents/);
  });
});

describe('filesFrom', () => {
  const item = (kind, type, file) => ({ kind, type, getAsFile: () => file });

  test('keeps every FILE in order — non-images included, so admitFiles can refuse them out loud', () => {
    const a = png(); const doc = { type: 'application/pdf', size: 5 }; const b = png();
    const dt = {
      items: [
        item('file', 'image/png', a),
        item('string', 'text/plain', null), // plain text paste — not a file
        item('file', 'application/pdf', doc),
        item('file', 'image/jpeg', b),
      ],
    };
    expect(filesFrom(dt)).toEqual([a, doc, b]);
  });

  test('empty/absent transfers yield nothing', () => {
    expect(filesFrom(null)).toEqual([]);
    expect(filesFrom({})).toEqual([]);
  });

  test('an item whose getAsFile yields null is dropped', () => {
    expect(filesFrom({ items: [item('file', 'image/png', null)] })).toEqual([]);
  });
});


describe('PDF documents', () => {
  test('admits PDFs by MIME or extension and applies their binary size ceiling', () => {
    for (const file of [doc('report.PDF'), doc('download', 1024, 'application/pdf'), doc('report.pdf', 1024, 'application/octet-stream')]) {
      expect(classifyFile(file)).toBe('doc');
      expect(rejectReason(file)).toBeNull();
    }
    expect(rejectReason(doc('report.pdf', 20 * 1024 * 1024))).toBeNull();
    expect(rejectReason(doc('report.pdf', 20 * 1024 * 1024 + 1))).toMatch(/20MB/);
    expect(admitFiles(Array.from({ length: MAX_DOCS }, () => ({ kind: 'doc' })), [doc('report.pdf')]).refusal).toMatch(/At most 5 documents/);
  });
});

// A Word document the operator attaches reads in the desk's own code path —
// the browser's DecompressionStream over a real .docx (Node carries the same API).
describe('Word attachments', () => {
  it('a .docx is a document, and reads as its words', async () => {
    const { docxSaying } = await import('../helpers/docx-fixture.js');
    const { classifyFile, fileToText, rejectReason } = await import('../../frontend/app/RelinkShell/attachments.js');
    const file = new File([docxSaying(['Attached brief', 'Second line'])], 'brief.docx');
    expect(classifyFile(file)).toBe('doc');
    expect(rejectReason(file)).toBeNull();
    expect(await fileToText(file)).toBe('Attached brief\nSecond line');
  });
});
