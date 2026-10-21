/**
 * THE FAILURES FEED IS PER HOUSE (audit 3, B3). The logger keeps one ring of
 * recent warnings and errors for the whole process, and its rows carry what
 * the caller logged — a wallet, a lane id. Two operators on one machine are
 * two houses: the SUBSTRATE window's feed and the CSO's telemetry show a
 * reader the machine's rows and their own house's, never another house's.
 *
 * Real routers, real auth (each wallet signs a real challenge), real logger
 * ring, real owner.json on a temp workspaces root. The substrate probe points
 * at a dead loopback port and a temp claim dir, so no live model server is
 * asked anything.
 */
import express from 'express';
import request from 'supertest';
import net from 'net';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

const deadPort = () => new Promise((resolve) => {
  const server = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

describe('the failures feed shows a reader only the machine and their own house', () => {
  let app, alpha, beta;
  const LANE = 'alphalane-b3';

  beforeAll(async () => {
    const dir = await createTempDir('failures-feed');
    process.env.WORKSPACES_ROOT = path.join(dir, 'workspaces');
    process.env.NEUMA_REALM_ROOT = path.join(dir, 'realm');
    process.env.NEUMA_SUBSTRATE_CLAIM_DIR = path.join(dir, 'claim');
    process.env.LLAMA_SERVER_URL = `http://127.0.0.1:${await deadPort()}`;
    vi.resetModules();
    const { fullAuth, writeOwner } = await import('../helpers/audit-auth.js');
    alpha = await fullAuth();
    beta = await fullAuth();
    await writeOwner(process.env.WORKSPACES_ROOT, LANE, alpha.address);

    const { createLogger } = await import('../../backend/services/logger.js');
    const log = createLogger('FeedProof');
    log.warn('alpha house bind failed', { neumaId: LANE, wallet: alpha.address });
    log.warn('alpha lane read failed', { laneId: LANE });
    log.error(`a turn for ${alpha.address} died`);
    log.warn('model server answered slowly', { ms: 900 });

    const { default: substrate } = await import('../../backend/routes/substrate-routes.js');
    const { default: cso } = await import('../../backend/routes/cso-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/substrate', substrate);
    app.use('/api/v1/cso', cso);
  });

  const read = async (who, url) => {
    const res = await request(app).get(url).set('Authorization', `Bearer ${who.token}`);
    expect(res.status).toBe(200);
    return res.body;
  };

  test('substrate telemetry: the other house sees none of alpha\'s rows, only a count', async () => {
    const seen = await read(beta, '/api/v1/substrate/telemetry');
    const text = JSON.stringify(seen.failures);
    expect(text).not.toContain(alpha.address);
    expect(text).not.toContain(LANE);
    expect(text).toContain('model server answered slowly');
    expect(seen.failuresWithheld).toBeGreaterThanOrEqual(3);
  });

  test('substrate telemetry: alpha sees its own rows', async () => {
    const seen = await read(alpha, '/api/v1/substrate/telemetry');
    const msgs = seen.failures.map((f) => f.msg);
    expect(msgs).toEqual(expect.arrayContaining(['alpha house bind failed', 'alpha lane read failed', 'model server answered slowly']));
  });

  test('CSO telemetry: the other house sees none of alpha\'s rows', async () => {
    const { telemetry } = await read(beta, '/api/v1/cso/telemetry?logLimit=50');
    const text = JSON.stringify(telemetry.systemIssues);
    expect(text).not.toContain(alpha.address);
    expect(text).not.toContain(LANE);
    expect(text).toContain('model server answered slowly');
    expect(telemetry.systemIssuesWithheld).toBeGreaterThanOrEqual(3);
  });
});
