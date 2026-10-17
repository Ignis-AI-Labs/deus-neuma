// Real workspace resolution and real image collection; no image engine claim.
import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { collectOutputs } from '../../backend/services/image-forge/image-store.js';

test.skipIf(process.platform === 'win32')('collecting an image recreates missing sovereign art directories at 0700', async () => {
  const root = await createTempDir('image-private-directory');
  const priorRoot = getWorkspacesRoot();
  const priorUmask = process.umask(0o022);
  try {
    setWorkspacesRoot(root);
    await workspace.create('image-mode-probe');
    const lane = workspace.pathFor('image-mode-probe');
    // Simulate an older workspace without the newer art skeleton. Remove only
    // directories inside this test's own temporary workspace.
    await fs.rm(path.join(lane, 'art'), { recursive: true });
    const outputDir = path.join(root, 'engine-output');
    await fs.mkdir(outputDir);
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await fs.writeFile(path.join(outputDir, 'image.png'), image);
    const records = collectOutputs({ outputDir, laneId: 'image-mode-probe', jobId: 'mode-proof',
      outputs: [{ filename: 'image.png', subfolder: '', type: 'output' }],
    });
    expect(records).toHaveLength(1);
    expect(records[0].dir).toBe(path.join(lane, 'art', 'images'));
    expect(await fs.readFile(path.join(records[0].dir, records[0].file))).toEqual(image);
    const manifest = JSON.parse((await fs.readFile(path.join(records[0].dir, 'manifest.jsonl'), 'utf8')).trim());
    expect(manifest.imageId).toBe(records[0].imageId);
    for (const directory of [lane, path.join(lane, 'art'), records[0].dir]) {
      expect((await fs.stat(directory)).mode & 0o777, directory).toBe(0o700);
    }
  } finally {
    process.umask(priorUmask);
    setWorkspacesRoot(priorRoot);
  }
});
