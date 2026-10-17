/**
 * GET /api/v1/workspace/:id/skills — the honest acquisition record over REST,
 * proven on the REAL stack (RULE 0): real NeumaWorkspace over a temp root
 * (WORKSPACES_ROOT), real recordSkillUse writing a real tree.json, real
 * Express route. Auth passthrough only, per the codified convention in
 * AGENTS.md (route logic under test, not auth — auth has its own real tests).
 *
 * This pins the response contract THE CRAFT's craft-client parses:
 *  - never-summoned neuma → legacy default tree, NO acquisitions key
 *  - after real summons  → v2 tree with {skill, firstAcquiredAt, lastUsedAt,
 *    usageCount} acquisitions
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

describe('workspace skill-tree route (real workspace + real tree.json)', () => {
  let app, workspace, tempDir, savedRoot, witnessFor;

  beforeEach(async () => {
    tempDir = await createTempDir('skilltree-route');
    savedRoot = process.env.WORKSPACES_ROOT;
    process.env.WORKSPACES_ROOT = tempDir;
    vi.resetModules();

    // Imported AFTER resetModules so the token is minted from the same
    // auth.js instance the router will verify against (memoized HMAC secret
    // per module instance — a stale import 401s honestly).
    ({ witnessFor } = await import('../helpers/witness.js'));

    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    const { default: workspaceRouter } = await import('../../backend/routes/workspace-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/workspace', workspaceRouter);
  });

  afterEach(() => {
    if (savedRoot === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = savedRoot;
    vi.restoreAllMocks();
  });

  // Real workspace, real owner.json, real paired session token.
  const summon = async (id) => {
    await workspace.create(id);
    return witnessFor(workspace.root, id);
  };

  it('a never-summoned neuma returns the legacy default tree with no acquisitions key', async () => {
    const witness = await summon('quiet-one');
    const res = await request(app).get('/api/v1/workspace/quiet-one/skills').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.skillTree).toEqual({ skills: [], version: '1.0.0' });
    // The exact predicate craft-client applies — must resolve to "no record".
    expect(Array.isArray(res.body.skillTree.acquisitions)).toBe(false);
  });

  it('real skill use lands as v2 acquisitions the client contract can read', async () => {
    const witness = await summon('worker');
    await workspace.recordSkillUse('worker', 'sc-plan');
    await workspace.recordSkillUse('worker', 'sc-plan');
    await workspace.recordSkillUse('worker', 'sc-echo');

    const res = await request(app).get('/api/v1/workspace/worker/skills').set(witness.header);
    expect(res.status).toBe(200);
    const tree = res.body.skillTree;
    expect(tree.version).toBe('2.0.0');
    expect(Array.isArray(tree.acquisitions)).toBe(true);

    const plan = tree.acquisitions.find((a) => a.skill === 'sc-plan');
    const echo = tree.acquisitions.find((a) => a.skill === 'sc-echo');
    expect(plan.usageCount).toBe(2);
    expect(echo.usageCount).toBe(1);
    expect(new Date(plan.firstAcquiredAt).getTime()).toBeLessThanOrEqual(new Date(plan.lastUsedAt).getTime());
  });
});
