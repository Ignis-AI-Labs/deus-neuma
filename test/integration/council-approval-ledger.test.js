/**
 * A council member's approved act is filed under THAT member's lane in the
 * operator's act ledger, never under the one-on-one being the socket happens
 * to be bound to (audit C7, 2026-10-19). The real council guard
 * (runHouseTool) raises the real approval broker; the operator's ALLOW
 * arrives through the real resolveToolApproval; the ledger is read back with
 * the real readActs on a temp data root. No mock on the claimed path (RULE 0);
 * the socket is an in-memory frame sink, which is not what is claimed.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runHouseTool } from '../../backend/services/council-tool-guard.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { readActs } from '../../backend/services/act-ledger.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const MEMBER = { neumaId: 'council-member-lane', name: 'Member', kind: 'neuma' };

describe('a council approval lands in the asking member\'s act record', () => {
  let root, oldRoot, oldData;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'council-ledger-'));
    oldRoot = getWorkspacesRoot();
    oldData = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    setWorkspacesRoot(path.join(root, 'lanes'));
    await workspace.create(MEMBER.neumaId);
  });

  afterAll(async () => {
    setWorkspacesRoot(oldRoot);
    if (oldData === undefined) delete process.env.NEUMA_DATA_ROOT; else process.env.NEUMA_DATA_ROOT = oldData;
    await fs.rm(root, { recursive: true, force: true });
  });

  test('ALLOW on a member\'s delete records the act under the member, not the desk\'s bound being', async () => {
    const ground = path.join(root, 'ground');
    await fs.mkdir(ground, { recursive: true });
    const target = path.join(ground, 'old-notes.md');
    await fs.writeFile(target, 'stale');
    const frames = [];
    const connection = {
      walletAddress: '0x1111111111111111111111111111111111111111',
      companion: { neumaId: 'desk-being', name: 'Desk' },
    };
    connection.ws = {
      readyState: 1,
      OPEN: 1,
      send: (raw) => {
        const frame = JSON.parse(raw);
        frames.push(frame);
        if (frame.type === 'tool:approval_request') setImmediate(() => resolveToolApproval(connection, frame.id, 'allow'));
      },
    };
    const run = { closed: false, grounds: { [MEMBER.neumaId]: ground } };
    await runHouseTool(connection, run, MEMBER, 'turn-1', { toolName: 'delete_file', args: { path: target } }, {});
    expect(frames.some((f) => f.type === 'tool:approval_request' && f.surface === 'council')).toBe(true);

    // The consent lands beside the executed act's own record (tool-sandbox.js).
    const approvedOf = async (laneId) => (await readActs({ laneIds: [laneId] })).filter((a) => a.status === 'approved');
    let approved = [];
    for (let i = 0; i < 100 && approved.length === 0; i += 1) {
      approved = await approvedOf(MEMBER.neumaId);
      if (approved.length === 0) await new Promise((r) => setTimeout(r, 20));
    }
    expect(approved).toHaveLength(1);
    expect(approved[0]).toMatchObject({ laneId: MEMBER.neumaId, name: 'Member', tool: 'delete_file', decision: 'approved' });
    expect(await approvedOf('desk-being')).toEqual([]);
  });
});
