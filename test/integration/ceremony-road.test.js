/**
 * THE FLIGHT CHECK WALKS THE ROAD (Echo, 2026-08-06).
 *
 * Five community failures shared one shape: the flight check said READY and
 * a ceremony write then died on the operator's screen — because the check
 * probed a different road (host-side fs at the workspace root) than the one
 * the being walks (the MCP filesystem subprocess, into the scratch and the
 * lane's dna/). probeCeremonyRoad walks the real road: real subprocess,
 * real writes, verified bytes, cleaned traces, and one self-heal reconnect
 * when the wall is stale.
 *
 * No mocks (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';

let prevDataRoot;
let root;
let workspacesRoot;
let probeCeremonyRoad;
let PROBE_LANE;
let mcpService;
let setWorkspacesRoot;
let neumaWorkspace;

beforeAll(async () => {
  prevDataRoot = process.env.NEUMA_DATA_ROOT;
  root = await createTempDir('ceremony-road');
  // The packaged shape: data root and workspaces root both OUTSIDE the cwd.
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  await fs.mkdir(process.env.NEUMA_DATA_ROOT, { recursive: true });
  workspacesRoot = path.join(root, 'workspaces');

  ({ setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js'));
  ({ neumaWorkspace } = await import('../../core/index.js'));
  setWorkspacesRoot(workspacesRoot);

  ({ probeCeremonyRoad, PROBE_LANE } = await import('../../backend/services/ceremony-road.js'));
  ({ mcpService } = await import('../../backend/services/mcp.js'));
}, 30000);

afterAll(async () => {
  await mcpService.disconnect('filesystem').catch(() => {});
  if (prevDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
  else process.env.NEUMA_DATA_ROOT = prevDataRoot;
});

describe('probeCeremonyRoad — the real road, end to end', () => {
  test('a fresh packaged-shaped home: the road is SET UP, both writes land, every trace removed', async () => {
    // No server connected yet, no dirs exist yet — the probe must build the
    // road itself (Founder's law) and heal the dead client with its one reconnect.
    const road = await probeCeremonyRoad({ workspacesRoot });
    expect(road.ok).toBe(true);

    // The road it built for the ceremony REMAINS (that is the setup)…
    const scratch = path.join(process.env.NEUMA_DATA_ROOT, 'temp');
    expect((await fs.stat(scratch)).isDirectory()).toBe(true);
    // …but the probe artifacts do not.
    await expect(fs.stat(path.join(scratch, '.preflight-probe.txt'))).rejects.toThrow();
    await expect(fs.stat(path.join(workspacesRoot, PROBE_LANE))).rejects.toThrow();

    // And nothing the probe did can ever read as a being.
    expect(await neumaWorkspace.listNeuma()).toEqual([]);
  }, 30000);

  test('a STALE wall self-heals: the home moved after boot, the probe reconnects once and passes', async () => {
    // The server is currently rooted at the first home (previous test). Move
    // the home — the exact real-world shape: POST /workspace after boot, or
    // a settings file pointing somewhere the boot-time connect never saw.
    const movedRoot = path.join(root, 'moved-home');
    setWorkspacesRoot(movedRoot);
    try {
      const road = await probeCeremonyRoad({ workspacesRoot: movedRoot });
      expect(road.ok).toBe(true);
      await expect(fs.stat(path.join(movedRoot, PROBE_LANE))).rejects.toThrow();
    } finally {
      setWorkspacesRoot(workspacesRoot);
    }
  }, 30000);

  test('an impossible home FAILS with the reason, never a false READY', async () => {
    // A workspaces root nested under a plain FILE cannot be created — the
    // probe must say so (this is the row that blocks the launch).
    const file = path.join(root, 'not-a-dir');
    await fs.writeFile(file, 'x');
    const road = await probeCeremonyRoad({ workspacesRoot: path.join(file, 'ws') });
    expect(road.ok).toBe(false);
    expect(road.detail).toMatch(/could not create/i);
  }, 30000);

  test('an interrupted cleanup can never read as a being — the probe lane is marked from birth', async () => {
    // Simulate the interruption: a leftover probe lane with its marker.
    const leftover = path.join(workspacesRoot, PROBE_LANE);
    await fs.mkdir(path.join(leftover, 'dna'), { recursive: true });
    await fs.writeFile(path.join(leftover, 'lane.json'), JSON.stringify({ kind: 'preflight-probe' }));
    try {
      expect(await neumaWorkspace.listNeuma()).toEqual([]);
    } finally {
      await fs.rm(leftover, { recursive: true, force: true });
    }
  });
});
