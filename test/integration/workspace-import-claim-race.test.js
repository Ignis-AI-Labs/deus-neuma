/**
 * AN IMPORT CLAIMS ITS LANE BEFORE IT WRITES (audit 3 E3, the import race).
 * Two imports for one fresh lane id both find no lane. The one whose claim
 * lands writes; the other is refused before a byte of its bundle reaches a
 * lane that is not its own — another wallet's as not yours, the same
 * wallet's second as a lane that already lives.
 *
 * Real router behind real requireAuth, each wallet signing a real challenge;
 * real NeumaWorkspace on a temp root; the two requests really race over HTTP.
 */
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

const bundleOf = (who, ids) => ({
  dna: { identity: { name: who }, version: '1.0.0' },
  observations: ids.map((id) => ({ id, type: 'self-note', content: `${who} remembers ${id}`, significance: 0.9 })),
});

describe('two imports racing for one fresh lane', () => {
  let app, root, alpha, beta, workspace;

  beforeAll(async () => {
    const dir = await createTempDir('import-race');
    root = path.join(dir, 'workspaces');
    process.env.WORKSPACES_ROOT = root;
    vi.resetModules();
    const { fullAuth } = await import('../helpers/audit-auth.js');
    alpha = await fullAuth();
    beta = await fullAuth();
    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/v1/workspace', (await import('../../backend/routes/workspace-routes.js')).default);
  });

  const importAs = (who, neumaId, bundle) => request(app).post('/api/v1/workspace/import')
    .set('Authorization', `Bearer ${who.token}`).send({ neumaId, bundle });

  test('across two wallets, only the winner\'s bundle lands, under the winner\'s claim', async () => {
    const [a, b] = await Promise.all([
      importAs(alpha, 'contested', bundleOf('Alpha', ['a1a1a1a1', 'a2a2a2a2'])),
      importAs(beta, 'contested', bundleOf('Beta', ['b1b1b1b1', 'b2b2b2b2'])),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 403]);
    const winner = a.status === 200 ? alpha : beta;
    const name = winner === alpha ? 'Alpha' : 'Beta';
    const owner = JSON.parse(await fs.readFile(path.join(root, 'contested', 'owner.json'), 'utf8'));
    expect(owner.wallet.toLowerCase()).toBe(winner.address);
    const contents = (await workspace.listObservations('contested')).map((o) => o.content);
    expect(contents).toHaveLength(2);
    expect(contents.every((c) => c.startsWith(name))).toBe(true);
    expect((await workspace.readDNA('contested')).identity.name).toBe(name);
  });

  test('one wallet importing twice at once lands it once', async () => {
    const bundle = { ...bundleOf('Twice', ['c1c1c1c1']), sessions: { 'session-1': [{ role: 'user', content: 'hello', timestamp: '2026-07-01T10:00:00.000Z' }] } };
    const both = await Promise.all([importAs(alpha, 'doubled', bundle), importAs(alpha, 'doubled', bundle)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await workspace.readSession('doubled', 'session-1')).toHaveLength(1);
  });
});
