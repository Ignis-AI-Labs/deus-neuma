/**
 * Gnosis validation for sc-audit run neuma-security-audit-b435 — wave 2
 * (tool/MCP/LLM surface findings).
 *
 * RULE 0: no mocks on the security boundary under claim.
 * Real auth (challenge → sign → session), real disk, real MCP where claimed.
 *
 * Run:
 *   npx vitest run .waves/runs/neuma-security-audit-b435/validation/gnosis-validation.test.js
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import { readFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { mcpService } from '../../backend/services/mcp.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import { checkToolAccess, resolvePolicy, GLOBAL_DEFAULTS } from '../../backend/services/tool-policy.js';
import { fullAuth } from '../helpers/audit-auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// W2-001 — REST call-tool bypasses sandbox
// ---------------------------------------------------------------------------
describe('AUDIT-W2-001 REST call-tool no sandbox (real MCP + disk)', () => {
  let app, house, wallet, victimPath, token;

  beforeAll(async () => {
    house = await fs.mkdtemp(path.join(os.tmpdir(), 'gnosis-calltool-'));
    setWorkspacesRoot(house);
    await fs.mkdir(path.join(house, 'neuma-victim', 'dna'), { recursive: true });
    victimPath = path.join(house, 'neuma-victim', 'dna', 'active.json');
    await fs.writeFile(victimPath, JSON.stringify({ secret: 'VICTIM' }));

    try { await mcpService.disconnect('filesystem'); } catch { /* */ }
    await mcpService.connectToServer(
      'filesystem',
      'npx',
      ['-y', '@modelcontextprotocol/server-filesystem', house],
      {},
    );

    const auth = await fullAuth();
    token = auth.token;
    wallet = auth;

    // Real mcp-routes with REAL requireAuth (not mocked)
    const { default: router } = await import('../../backend/routes/mcp-routes.js');
    app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/v1/mcp', router);
  }, 90000);

  afterAll(async () => {
    try { await mcpService.disconnect('filesystem'); } catch { /* */ }
    rmSync(house, { recursive: true, force: true });
  });

  test('sandbox WOULD deny cross-lane write', async () => {
    const sandboxed = createSandboxedCallTool(
      mcpService,
      { companion: { neumaId: 'neuma-attacker' }, _writeOps: 0 },
      workspace,
    );
    await fs.mkdir(path.join(house, 'neuma-attacker'), { recursive: true });
    await expect(
      sandboxed('filesystem', 'write_file', {
        path: victimPath,
        content: '{"hacked":true}',
      }),
    ).rejects.toThrow();
    const still = await fs.readFile(victimPath, 'utf8');
    expect(still).toContain('VICTIM');
  });

  test('REST /call-tool cannot write victim DNA — sandbox + ownership (SEC-AUDIT-004 fixed)', async () => {
    // Ensure attacker owns a different lane for token context
    await fs.mkdir(path.join(house, 'neuma-attacker'), { recursive: true });
    await fs.writeFile(
      path.join(house, 'neuma-attacker', 'owner.json'),
      JSON.stringify({ wallet: wallet.address, claimedAt: Date.now() }),
    );
    const marker = `REST-BYPASS-${Date.now()}`;
    const before = await fs.readFile(victimPath, 'utf8');
    const res = await request(app)
      .post('/api/v1/mcp/call-tool')
      .set('Authorization', `Bearer ${token}`)
      .send({
        server: 'filesystem',
        tool: 'write_file',
        neumaId: 'neuma-attacker',
        args: { path: victimPath, content: JSON.stringify({ secret: marker }) },
      });
    expect([403, 500]).toContain(res.status);
    expect(await fs.readFile(victimPath, 'utf8')).toBe(before);
    expect(before).not.toContain(marker);
  });

  test('approval_required tools are blocked by REST policy (SEC-AUDIT-004 fixed)', async () => {
    await fs.mkdir(path.join(house, 'neuma-attacker'), { recursive: true });
    await fs.writeFile(
      path.join(house, 'neuma-attacker', 'owner.json'),
      JSON.stringify({ wallet: wallet.address, claimedAt: Date.now() }),
    );
    const access = checkToolAccess(
      resolvePolicy(GLOBAL_DEFAULTS, null, null),
      'filesystem',
      'totally_unknown_tool_xyz',
    );
    expect(access).toBe('approval_required');
    const res = await request(app)
      .post('/api/v1/mcp/call-tool')
      .set('Authorization', `Bearer ${token}`)
      .send({
        server: 'filesystem',
        tool: 'totally_unknown_tool_xyz',
        neumaId: 'neuma-attacker',
        args: {},
      });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// W2-002 — client spawn arbitrary roots
// ---------------------------------------------------------------------------
describe('AUDIT-W2-002 client MCP spawn arbitrary roots', () => {
  let app, token, tmpRoot;

  beforeEach(async () => {
    const auth = await fullAuth();
    token = auth.token;
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gnosis-mcp-root-'));
    const { default: router } = await import('../../backend/routes/mcp-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/mcp', router);
  });

  afterEach(async () => {
    try { await mcpService.disconnect('evil-fs'); } catch { /* */ }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('POST /connect rejects arbitrary root outside house (SEC-AUDIT-005 fixed)', async () => {
    const res = await request(app)
      .post('/api/v1/mcp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'evil-fs',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', tmpRoot],
      });
    expect(res.status).toBe(403);
    expect(res.body.error || '').toMatch(/root|home|project/i);
  }, 90000);
});

// ---------------------------------------------------------------------------
// W2-003 — package @spec strip
// ---------------------------------------------------------------------------
describe('AUDIT-W2-003 package allowlist strips @spec', () => {
  let app, token;

  beforeEach(async () => {
    token = (await fullAuth()).token;
    const { default: router } = await import('../../backend/routes/mcp-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/mcp', router);
  });

  test('package name with @version suffix is rejected (SEC-AUDIT-006 fixed)', async () => {
    const res = await request(app)
      .post('/api/v1/mcp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'fs-pin-test',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem@0.0.0-nonexistent-pin', process.cwd()],
      });
    expect(res.status).toBe(403);
    expect(res.body.error || '').toMatch(/not in allowlist/i);
  }, 90000);

  test('evil prefix package IS denied (control)', async () => {
    const res = await request(app)
      .post('/api/v1/mcp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'evil',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem-evil', '/tmp'],
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not in allowlist/i);
  });
});

// ---------------------------------------------------------------------------
// W2-004 — /llm/models SSRF (real local listener)
// ---------------------------------------------------------------------------
describe('AUDIT-W2-004 /llm/models unguarded fetch', () => {
  let app, token, probeServer, probePort, hits;

  beforeAll(async () => {
    hits = [];
    probeServer = createServer((req, res) => {
      hits.push({ url: req.url, method: req.method });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'probe-model' }] }));
    });
    await new Promise((resolve) => {
      probeServer.listen(0, '127.0.0.1', () => {
        probePort = probeServer.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((r) => probeServer.close(r));
  });

  beforeEach(async () => {
    hits.length = 0;
    token = (await fullAuth()).token;
    const { default: router } = await import('../../backend/routes/llm-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1', router);
  });

  test('ollama models path still allows localhost after guard (assertSafeEndpoint)', async () => {
    const endpoint = `http://127.0.0.1:${probePort}`;
    const res = await request(app)
      .post('/api/v1/llm/models')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'ollama', endpoint });

    expect(res.status).toBe(200);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.url.includes('/api/tags'))).toBe(true);
  });

  test('ollama models path rejects private/metadata endpoint (SEC-AUDIT-007 fixed)', async () => {
    const res = await request(app)
      .post('/api/v1/llm/models')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'ollama', endpoint: 'http://169.254.169.254/' });
    expect(res.status).toBe(400);
    expect(hits.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// W2-005 PUT provider / W2-007 platform tools / W2-008 doctrine — code path
// ---------------------------------------------------------------------------
describe('AUDIT-W2 mediums with runtime or closed code proof', () => {
  test('W2-008 doctrine: resolved policy allows the fs write (product intent residual)', () => {
    const policy = resolvePolicy(GLOBAL_DEFAULTS, null, null);
    // The own-lane sovereign-write law lives on the being-facing primitive (Stage 3 batch 3).
    expect(checkToolAccess(policy, 'fs', 'write')).toBe('allowed');
    // delete is IRREVERSIBLE — approval-required; fs/edit's delete sub-op resolves to this row (fsPolicyTarget).
    expect(checkToolAccess(policy, 'filesystem', 'delete_file')).toBe('approval_required');
  });

  test('W2-005/007: llm models + provider use assertSafeEndpoint (SEC-AUDIT-007 fixed)', async () => {
    const src = readFileSync(path.join(REPO, 'backend/routes/llm-routes.js'), 'utf8');
    expect(src).toMatch(/assertSafeEndpoint/);
    const modelsIdx = src.indexOf("router.post('/llm/models'");
    const modelsSlice = src.slice(modelsIdx, modelsIdx + 800);
    expect(modelsSlice).toMatch(/assertSafeEndpoint/);
    const putIdx = src.indexOf("router.put('/llm/provider'");
    const putSlice = src.slice(putIdx, putIdx + 600);
    expect(putSlice).toMatch(/assertSafeEndpoint/);
  });

  test('W2-007: platform branches before the MCP policy loop; team acts are intents now', () => {
    // The invariant W2-007 guards, structural since 2026-07-26: platform
    // capabilities resolve in `dispatchPlatformTool` BEFORE the MCP path.
    // Team RUNS left the dispatcher in Stage 3 (filed intents, settled by the
    // sweep), so no team branch may remain here. The fan and the loop moved
    // VERBATIM out of portal-stream (size-law breakdown step 9), so the
    // structure is pinned where it now lives.
    const dispatchSrc = readFileSync(path.join(REPO, 'backend/services/portal-tool-dispatch.js'), 'utf8');
    const dispatcher = dispatchSrc.indexOf('export const dispatchPlatformTool');
    expect(dispatcher).toBeGreaterThan(-1);
    const dispatcherBody = dispatchSrc.slice(dispatcher);
    expect(dispatcherBody).not.toContain('_isTeamRunTool');
    expect(dispatcherBody).not.toContain('_isWorkspaceRunTool');
    expect(dispatcherBody).toContain('if (isSkillTool(match))');
    // No capability branch falls through to MCP: all settle in the dispatcher.
    expect(dispatcherBody).not.toContain('applyToolMode(baseAccess, toolMode');
    const loopSrc = readFileSync(path.join(REPO, 'backend/services/portal-tool-loop.js'), 'utf8');
    const loopStart = loopSrc.indexOf('for (const rawMatch of matches)');
    expect(loopStart).toBeGreaterThan(-1);
    const platformCall = loopSrc.indexOf('await dispatchPlatformTool(match, {', loopStart);
    const mcpApply = loopSrc.indexOf('applyToolMode(baseAccess, toolMode', loopStart);
    expect(platformCall).toBeGreaterThan(loopStart);
    expect(mcpApply).toBeGreaterThan(platformCall);
    const sweepCall = loopSrc.indexOf('await sweepIntents(connection, {', loopStart);
    expect(sweepCall).toBeGreaterThan(platformCall);
    const loopReturn = loopSrc.indexOf('return results;', loopStart);
    expect(sweepCall).toBeLessThan(loopReturn);
  });
});
