import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import {
  GRAPH_COMMUNITY_SNAPSHOT_MAX_BYTES,
  readBoundedRecallCommunities,
} from '../../core/memory/recall-graph-snapshot.js';

describe('readBoundedRecallCommunities', () => {
  let previousRoot;
  let neumaId;

  beforeEach(async () => {
    previousRoot = neumaWorkspace.root;
    neumaWorkspace.root = await createTempDir(`graph-snapshot-${Math.random().toString(36).slice(2)}`);
    neumaId = `n-snapshot-${Math.random().toString(36).slice(2)}`;
    await neumaWorkspace.create(neumaId);
    await neumaWorkspace.writeDNA(neumaId, { identity: { name: 'Fenna' } });
  });

  afterEach(() => {
    neumaWorkspace.root = previousRoot;
  });

  it('reads a real encrypted community snapshot within the byte budget', async () => {
    const communities = [{ id: 1, memberIds: ['a', 'b'], label: 'harbor' }];
    await neumaWorkspace.writeCommunities(neumaId, communities);

    expect(await readBoundedRecallCommunities(neumaWorkspace, neumaId)).toEqual(communities);
  });

  it('fails closed before parsing an oversized persisted snapshot', async () => {
    const path = join(neumaWorkspace.pathFor(neumaId), 'memory', 'communities.json');
    await writeFile(path, Buffer.alloc(GRAPH_COMMUNITY_SNAPSHOT_MAX_BYTES + 1, 0x61));

    expect(await readBoundedRecallCommunities(neumaWorkspace, neumaId)).toEqual([]);
  });

  it('fails closed when the snapshot is absent or exceeds a stricter caller cap', async () => {
    expect(await readBoundedRecallCommunities(neumaWorkspace, neumaId)).toEqual([]);
    await neumaWorkspace.writeCommunities(neumaId, [{ id: 1, memberIds: ['a'] }]);
    expect(await readBoundedRecallCommunities(neumaWorkspace, neumaId, { maxBytes: 0 })).toEqual([]);
  });
});
