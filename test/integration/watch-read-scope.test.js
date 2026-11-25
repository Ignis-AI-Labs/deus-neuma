import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readySource } from '../../backend/services/watch/watch-fetch.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { claimOwner } from '../helpers/claim-owner.js';

let root;
let prior;
let lane;
let other;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-watch-scope-'));
  prior = getWorkspacesRoot();
  setWorkspacesRoot(root);
  lane = workspace.pathFor('own-lane');
  other = workspace.pathFor('other-lane');
  await fs.mkdir(lane, { recursive: true });
  await fs.mkdir(other, { recursive: true });
  await claimOwner(root, 'other-lane', `0x${'ab'.repeat(20)}`);
  await fs.writeFile(path.join(other, 'private.mkv'), 'not for this lane');
});

afterEach(async () => {
  setWorkspacesRoot(prior);
  await fs.rm(root, { recursive: true, force: true });
});

describe('PR20 M-17: local media reads stop at lane and house boundaries', () => {
  test('another lane\'s recording is refused before probing it', async () => {
    const result = await readySource(path.join(other, 'private.mkv'), {
      need: 'video', laneDir: lane,
      connection: { walletAddress: `0x${'cd'.repeat(20)}`, _grantedReadRoots: [], _grantedWriteRoots: [], _sensitiveGrants: {} },
    });
    expect(result.ok).toBe(false);
    expect(result.why).toContain('outside what a neuma may read');
  });
});
