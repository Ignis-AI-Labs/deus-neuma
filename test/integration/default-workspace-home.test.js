/**
 * Fresh-install default workspace home — REAL router, REAL disk, NO mock at
 * all (#390 tranche 6; the header already claimed […] while
 * four sat in the beforeEach).
 *
 * The user's question: […] This proves it for real. The Electron shell defaults
 * WORKSPACES_ROOT to ~/.neuma/workspaces (a dir that does NOT exist on a fresh
 * machine). When the witness reaches the pre-flight screen, the app must:
 *   1. CREATE that default home on disk, and
 *   2. report it as the neuma's home (and pass the writability check).
 * Both are asserted here against a fresh, non-existent neuma-style path.
 */
import express from 'express';
import request from 'supertest';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('fresh install sets up the default neuma workspace home', () => {
  let app, base, neumaWorkspacesRoot;

  beforeEach(async () => {
    vi.resetModules();
    // Mirror a fresh machine: ~/.neuma/workspaces does not exist yet.
    base = mkdtempSync(path.join(os.tmpdir(), 'fresh-install-'));
    neumaWorkspacesRoot = path.join(base, '.neuma', 'workspaces'); // nested + absent

    const core = await import('../../core/index.js');
    core.setWorkspacesRoot(neumaWorkspacesRoot); // what the Electron default resolves to
    const { default: router } = await import('../../backend/routes/preflight-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/preflight', router);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('reaching pre-flight CREATES the default home and reports it as PASS', async () => {
    // Self-contained false→true proof: truly fresh before the GET, present after.
    expect(existsSync(neumaWorkspacesRoot)).toBe(false); // precondition: nothing created it yet

    const res = await request(app).get('/api/v1/preflight');
    expect(res.status).toBe(200);

    // 1. The default neuma workspace home was created on disk by the GET.
    expect(existsSync(neumaWorkspacesRoot)).toBe(true);

    // 2. The pre-flight reports it as the neuma's home, and the writability
    //    check passed (the […] row).
    expect(res.body.home.root).toBe(neumaWorkspacesRoot);
    const wsCheck = res.body.checks.find((c) => c.id === 'workspace');
    expect(wsCheck).toBeTruthy();
    expect(wsCheck.status).toBe('pass');
    expect(wsCheck.detail).toBe(neumaWorkspacesRoot);
  });
});
