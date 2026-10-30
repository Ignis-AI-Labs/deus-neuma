/**
 * AN IMPORT NEVER OPENS A LANE BOUND TO SOMEONE ELSE (re-audit 2026-10-29, NEW-H2).
 * A harness lane's id is computed from its wallet (harness-<first 8 hex>), and a witness lane is
 * made only by its summoning. An import used to open any FRESH id for whoever asked, writing
 * owner.json = the caller: one signed-in wallet could compute another's harness id, claim it first,
 * and that wallet's own harness would then fail owner_claim_conflict for good.
 *
 * Real router behind real requireAuth, each wallet signing a real challenge; real NeumaWorkspace on
 * a temp root (harness lanes on its sibling ground). No mocks (RULE 0).
 */
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

const bundle = { dna: { identity: { name: 'Planted' }, version: '1.0.0' }, observations: [] };

describe('an import into a reserved lane id', () => {
  let app, root, victim, attacker, workspace, harnessLaneId;

  beforeAll(async () => {
    const dir = await createTempDir('import-reserved');
    root = path.join(dir, 'workspaces');
    process.env.WORKSPACES_ROOT = root;
    vi.resetModules();
    const { fullAuth } = await import('../helpers/audit-auth.js');
    victim = await fullAuth();
    attacker = await fullAuth();
    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    ({ harnessLaneId } = await import('../../backend/services/harness-lane.js'));
    app = express();
    app.use(express.json());
    app.use('/api/v1/workspace', (await import('../../backend/routes/workspace-routes.js')).default);
  });

  const importAs = (who, neumaId) => request(app).post('/api/v1/workspace/import')
    .set('Authorization', `Bearer ${who.token}`).send({ neumaId, bundle });

  test('another wallet\'s harness id is refused, and nothing is claimed in it', async () => {
    const id = harnessLaneId(victim.address);
    const res = await importAs(attacker, id);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/another wallet/);
    expect(existsSync(workspace.pathFor(id))).toBe(false);
  });

  test('a witness lane id is refused for every wallet, and nothing is made', async () => {
    const res = await importAs(attacker, 'witness-kimi-code-Probe');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/summoning/);
    expect(existsSync(workspace.pathFor('witness-kimi-code-Probe'))).toBe(false);
  });

  test('a wallet restoring into its own harness id, and into an ordinary new id, still lands', async () => {
    const own = harnessLaneId(victim.address);
    expect((await importAs(victim, own)).status).toBe(200);
    const owner = JSON.parse(await fs.readFile(path.join(workspace.pathFor(own), 'owner.json'), 'utf8'));
    expect(owner.wallet.toLowerCase()).toBe(victim.address);
    expect((await importAs(attacker, 'restored-being')).status).toBe(200);
  });
});
