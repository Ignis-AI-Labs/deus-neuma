import express from 'express';
import request from 'supertest';

/**
 * Integration tests for memory API routes. Nothing is mocked (#390 tranche
 * 5): the real router, the real requireAuth with a real HMAC session, and
 * the real mcpService. The mcpService stub that used to sit here was never
 * reached by a single assertion below — every route on this router now
 * answers 410/404/401 — so it bought nothing and hid the fact that the
 * router's MCP import is inert.
 *
 * Legacy global memory endpoints were decommissioned (CORE-001 / #116):
 * the eight /neuma-memory/* routes and four /memory/* routes now return
 * 410 Gone with a pointer to the sovereign per-neuma workspace. Only the
 * DNA file management route (MCP-filesystem-backed) and the auth gate
 * remain on this router.
 */
describe('Memory API routes', () => {
  let app, witness;

  beforeEach(async () => {
    vi.resetModules();

    // Imported AFTER resetModules so the witness mints its token from the
    // same auth.js instance the router will verify against.
    const { strangerWitness } = await import('../helpers/witness.js');
    // This router carries no neuma lane — a real session that claims no
    // workspace is exactly the right shape.
    witness = strangerWitness();

    const { default: memoryRouter } = await import('../../backend/routes/memory-routes.js');

    app = express();
    app.use(express.json());
    app.use('/api/v1', memoryRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Authentication', () => {
    test('returns 401 without auth token', async () => {
      // Auth is real now — no header against the real router IS the real 401.
      const res = await request(app).get('/api/v1/neuma-memory/status');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication required');
    });
  });

  describe('Decommissioned legacy endpoints (CORE-001 / #116)', () => {
    const DECOMMISSIONED = [
      ['get',  '/api/v1/neuma-memory/status'],
      ['post', '/api/v1/neuma-memory/create-entities'],
      ['post', '/api/v1/neuma-memory/add-observations'],
      ['post', '/api/v1/neuma-memory/create-relations'],
      ['get',  '/api/v1/neuma-memory/read-graph'],
      ['post', '/api/v1/neuma-memory/open-nodes'],
      ['post', '/api/v1/neuma-memory/search-nodes'],
      ['post', '/api/v1/neuma-memory/clear/AnyName'],
      ['get',  '/api/v1/memory/graph/AnyName'],
      ['post', '/api/v1/memory/semantic-search'],
      ['get',  '/api/v1/memory/network/AnyName'],
      ['post', '/api/v1/memory/context'],
    ];

    test.each(DECOMMISSIONED)('%s %s returns 410 Gone with CORE-001 pointer',
      async (method, path) => {
        const res = await request(app)[method](path).set(witness.header).send({});
        expect(res.status).toBe(410);
        expect(res.body.error).toMatch(/CORE-001/);
        expect(res.body.error).toMatch(/#116/);
      }
    );

    test('the clear endpoint (previously 501 under MEM-IDOR-001) is now uniformly 410', async () => {
      const res = await request(app).post('/api/v1/neuma-memory/clear/TestNeuma').set(witness.header).send({});
      expect(res.status).toBe(410);
    });
  });

  describe('/api/v1/clear-user-data removal', () => {
    test('global data wipe endpoint no longer exists', async () => {
      const res = await request(app)
        .post('/api/v1/clear-user-data')
        .set(witness.header)
        .send();

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/companion/dna (decommissioned — SEC-AUDIT W1-003)', () => {
    test('returns 410 Gone for path-traversal style ids', async () => {
      const res = await request(app)
        .post('/api/v1/companion/dna')
        .set(witness.header)
        .send({ companionId: '../../../etc/passwd', action: 'read' });

      expect(res.status).toBe(410);
      expect(res.body.error).toMatch(/removed|workspace/i);
    });

    test('returns 410 Gone for valid ids', async () => {
      const res = await request(app)
        .post('/api/v1/companion/dna')
        .set(witness.header)
        .send({ companionId: 'valid-id', action: 'read' });

      expect(res.status).toBe(410);
    });
  });
});
