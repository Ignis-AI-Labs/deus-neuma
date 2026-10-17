import { expect, test } from 'vitest';
import { prepareAttachmentSend } from '../../frontend/app/RelinkShell/attachment-send.js';

test('a second image still loading blocks the whole message', () => {
  const attachments = [
    { key: 'first', kind: 'image', dataUri: 'data:image/png;base64,first' },
    { key: 'second', kind: 'image', dataUri: null },
  ];
  expect(prepareAttachmentSend(attachments)).toMatchObject({ ok: false });
  expect(attachments).toHaveLength(2);
  attachments[1].dataUri = 'data:image/png;base64,second';
  expect(prepareAttachmentSend(attachments)).toEqual({ ok: true, images: attachments.map((a) => a.dataUri), files: [] });
});

test('out-of-order completion keeps selection order and empty documents', () => {
  const attachments = [
    { kind: 'image', dataUri: null },
    { kind: 'doc', name: 'empty.txt', text: '' },
    { kind: 'image', dataUri: 'second' },
  ];
  expect(prepareAttachmentSend(attachments).ok).toBe(false);
  attachments[0].dataUri = 'first';
  expect(prepareAttachmentSend(attachments)).toEqual({ ok: true, images: ['first', 'second'], files: [{ name: 'empty.txt', text: '' }] });
});

test('a loading document also blocks the batch; no attachments permits text', () => {
  expect(prepareAttachmentSend([{ kind: 'doc', text: null }]).ok).toBe(false);
  expect(prepareAttachmentSend([])).toEqual({ ok: true, images: [], files: [] });
});

import { attachmentIds } from '../../frontend/services/attachments-client.js';
test('upload receipt must identify every selected attachment exactly once', () => {
  expect(attachmentIds({ ids: ['first', 'second'] }, 2)).toEqual(['first', 'second']);
  for (const ids of [undefined, ['first'], ['same', 'same'], ['first', null], ['first', '']]) {
    expect(() => attachmentIds({ ids }, 2)).toThrow(/incomplete attachment receipt/);
  }
});
