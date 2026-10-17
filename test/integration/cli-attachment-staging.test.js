// Real files -> CLI staging -> production wallet-bound, single-use store.
import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { stageAttachments } from '../../cli/lib/attachments.js';
import { attachmentStore } from '../../backend/services/attachment-store.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('CLI stages real image and text files with atomic refusal and single-use ownership', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-attachments-'));
  const wallet = `0x${randomBytes(20).toString('hex')}`;
  const stagedIds = [];
  try {
    const image = path.join(root, 'proof.PNG');
    const doc = path.join(root, 'notes.md');
    const binary = path.join(root, 'binary.txt');
    await fs.writeFile(image, Buffer.from(PNG, 'base64'));
    await fs.writeFile(doc, 'Real attachment contents — preserved.');
    await fs.writeFile(binary, Buffer.from([0, 1, 2, 3]));
    const parked = await stageAttachments([image, doc], wallet);
    stagedIds.push(...parked.ids);
    expect(parked).toMatchObject({ images: 1, docs: 1 });
    expect(parked.ids).toHaveLength(2);
    expect(attachmentStore.pendingCount(wallet)).toBe(2);
    expect(attachmentStore.take(parked.ids[0], 'another-wallet')).toBeNull();
    expect(attachmentStore.pendingCount(wallet)).toBe(2);
    expect(attachmentStore.take(parked.ids[0], wallet)).toBe(`data:image/png;base64,${PNG}`);
    expect(attachmentStore.take(parked.ids[1], wallet)).toEqual({
      kind: 'text', name: 'notes.md', text: 'Real attachment contents — preserved.',
    });
    expect(attachmentStore.take(parked.ids[0], wallet)).toBeNull();
    expect(attachmentStore.pendingCount(wallet)).toBe(0);
    for (const files of [[], [doc, path.join(root, 'unsupported.pdf')], [image, binary],
      [image, path.join(root, 'missing.md')], Array(6).fill(doc)]) {
      await expect(stageAttachments(files, wallet)).rejects.toThrow();
      expect(attachmentStore.pendingCount(wallet)).toBe(0);
    }
  } finally {
    for (const id of stagedIds) attachmentStore.take(id, wallet);
    await fs.rm(root, { recursive: true, force: true });
  }
});
