/**
 * THE WRITE LIMIT (backend/services/write-limit.js, tool-sandbox.js, SETTINGS → SECURITY → WRITE LIMIT) — Founder,
 * 2026-11-19, after Rugevil stopped halfway through swapping two signed PDFs ([…]), then: […]
 * On by default, ten a message; counted per message, never for the life of a window; reached, it asks the operator
 * (ALLOW: as many again, ALWAYS: no limit for the rest of the message, NO: it stops, saying why and where the switch
 * is); where nobody can be asked it stops at once; off, nothing counts; a folder the operator granted never counts.
 * The real stack (RULE 0): a real MCP filesystem server, real disk, the real sandbox, the real approval card and its
 * real answer, real signed HTTP for the switch with the install owner's claim.
 */
/* global fetch, AbortController */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import process from 'node:process';
import fs from 'fs/promises';
import path from 'path';
import http from 'http';
import express from 'express';
import { ethers } from 'ethers';
import { setTimeout as wait } from 'node:timers/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { ownerClaimHeaders } from '../e2e/helpers/owner-claim.js';
import { mcpService } from '../../backend/services/mcp.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { writeLimitSettings } from '../../backend/services/write-limit.js';
import { createAuthRouter } from '../../backend/services/auth.js';
import { ensureOwnerClaim } from '../../backend/services/owner-claim.js';
import securityRouter from '../../backend/routes/security-routes.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const SERVER = 'write-limit-fs';
const SAVED = Object.fromEntries(['NEUMA_WRITE_LIMIT_PATH', 'NEUMA_DATA_ROOT'].map((k) => [k, process.env[k]]));

describe('the write limit — real MCP, real disk, the real card', () => {
  let base, lane, project, origRoot, n = 0;

  beforeAll(async () => {
    base = await createTempDir('write-limit');
    process.env.NEUMA_WRITE_LIMIT_PATH = path.join(base, 'write-limit.json');
    project = path.join(base, 'project');
    await fs.mkdir(project, { recursive: true });
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(path.join(base, 'workspaces'));
    await workspace.create('rugevil-w');
    lane = workspace.pathFor('rugevil-w');
    await mcpService.connectToServer(SERVER, 'npx', ['-y', '@modelcontextprotocol/server-filesystem', base], {});
  }, 60000);

  afterAll(async () => {
    setWorkspacesRoot(origRoot);
    await mcpService.disconnect(SERVER);
    for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  // A desk watching the chat: every frame it is sent, and each message a turn of its own.
  const desk = (extra = {}) => {
    const sent = [];
    const connection = { companion: { neumaId: 'rugevil-w', name: 'Rugevil' }, walletAddress: '0x00000000000000000000000000000000000000aa',
      ws: { readyState: 1, OPEN: 1, send: (s) => sent.push(JSON.parse(s)) }, activeTurn: new AbortController(), ...extra };
    return { connection, sent, write: createSandboxedCallTool(mcpService, connection, workspace) };
  };
  const file = (where = lane) => { n += 1; return path.join(where, `page-${n}.md`); };
  const cards = (sent) => sent.filter((f) => f.type === 'tool:approval_request' && f.tool === 'files/keep_writing');
  // Write and, when the card comes, answer it as the operator would.
  const writeAnswering = async ({ connection, sent, write }, answer, where) => {
    const target = file(where);
    const before = cards(sent).length;
    let settled = false;
    const going = write(SERVER, 'write_file', { path: target, content: 'words' }).then(() => 'written', (err) => err.message).finally(() => { settled = true; });
    for (let i = 0; i < 300 && !settled && cards(sent).length === before; i += 1) await wait(10);
    const card = cards(sent).at(before);
    if (card) resolveToolApproval(connection, card.id, answer);
    return { outcome: await going, card, target };
  };
  const exists = (p) => fs.access(p).then(() => true, () => false);

  test('on by default, ten a message; the operator sets the number or turns it off, and nonsense is refused', async () => {
    expect(await writeLimitSettings.read()).toEqual({ on: true, cap: 10 });
    expect(await writeLimitSettings.set({ cap: 0 })).toMatchObject({ ok: false });
    expect(await writeLimitSettings.set({ on: 'yes' })).toMatchObject({ ok: false });
    expect(await writeLimitSettings.set({})).toMatchObject({ ok: false });
    expect(await writeLimitSettings.set({ cap: 3 })).toEqual({ ok: true, rule: { on: true, cap: 3 } });
  });

  test('reached, it asks: ALLOW is as many again, NO stops it saying why; the next message starts the count again; ALWAYS frees the rest of the message', async () => {
    await writeLimitSettings.set({ on: true, cap: 3 });
    const d = desk();
    for (let i = 0; i < 3; i += 1) expect((await writeAnswering(d, 'deny')).card).toBeUndefined();
    // The fourth asks — the card says what was reached, what comes next, and where the switch is.
    const fourth = await writeAnswering(d, 'allow');
    expect(fourth.card).toBeTruthy();
    expect(fourth.card.label).toBe('KEEP WRITING — Rugevil reached the write limit (3 this message)');
    expect(JSON.stringify(fourth.card.args)).toContain('SETTINGS → SECURITY → WRITE LIMIT');
    expect([fourth.outcome, await exists(fourth.target)]).toEqual(['written', true]);
    // ALLOW: three more, then it asks again; NO stops it, and the being reads why and what to do.
    for (let i = 0; i < 2; i += 1) expect((await writeAnswering(d, 'deny')).card).toBeUndefined();
    const refused = await writeAnswering(d, 'deny');
    expect(refused.card).toBeTruthy();
    expect(refused.outcome).toMatch(/^The write limit stopped this write: 6 writes this message in your own folder \(the limit is 3 a message/);
    expect(refused.outcome).toContain('The count starts again with your operator\'s next message');
    expect(await exists(refused.target)).toBe(false);
    // The operator's next message: the count starts again.
    d.connection.activeTurn = new AbortController();
    expect((await writeAnswering(d, 'deny'))).toMatchObject({ outcome: 'written', card: undefined });
    for (let i = 0; i < 2; i += 1) await writeAnswering(d, 'deny');
    // ALWAYS: no limit for the rest of this message.
    expect((await writeAnswering(d, 'always')).card).toBeTruthy();
    for (let i = 0; i < 6; i += 1) expect((await writeAnswering(d, 'deny'))).toMatchObject({ outcome: 'written', card: undefined });
  }, 60000);

  test('where nobody can be asked (house work, a clone) it stops at once; a granted folder never counts; off, nothing counts', async () => {
    await writeLimitSettings.set({ on: true, cap: 2 });
    const alone = desk({ _approvalRefusal: 'Nobody watches this sitting.' });
    await writeAnswering(alone, 'deny');
    await writeAnswering(alone, 'deny');
    const third = await writeAnswering(alone, 'allow');
    expect(third.card).toBeUndefined();
    expect(third.outcome).toMatch(/^The write limit stopped this write: 2 writes this message/);
    // Inside a folder the operator granted: their consent, never counted.
    const granted = desk({ _grantedWriteRoots: [project] });
    for (let i = 0; i < 5; i += 1) expect((await writeAnswering(granted, 'deny', project))).toMatchObject({ outcome: 'written', card: undefined });
    // Off: a being writes as much as its work needs.
    await writeLimitSettings.set({ on: false });
    const free = desk();
    for (let i = 0; i < 12; i += 1) expect((await writeAnswering(free, 'deny'))).toMatchObject({ outcome: 'written', card: undefined });
  }, 60000);
});

describe('the switch in SETTINGS → SECURITY — real signed HTTP, the install owner only', () => {
  let server, url, owner, other;
  const as = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  const signIn = async (claim, dataRoot) => {
    const wallet = ethers.Wallet.createRandom();
    const { challenge } = await (await fetch(`${url}/api/v1/auth/challenge?address=${wallet.address}`)).json();
    const signature = await wallet.signMessage(challenge);
    const verified = await fetch(`${url}/api/v1/auth/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(claim ? ownerClaimHeaders(dataRoot) : {}) }, body: JSON.stringify({ address: wallet.address, signature, challenge }) });
    return (await verified.json()).token;
  };

  beforeAll(async () => {
    const dataRoot = await createTempDir('write-limit-route');
    process.env.NEUMA_DATA_ROOT = dataRoot;
    process.env.NEUMA_WRITE_LIMIT_PATH = path.join(dataRoot, 'write-limit.json');
    const app = express();
    app.use((req, _res, next) => { req.accessScope = 'local'; next(); });
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRouter(express));
    app.use('/api/v1/security', securityRouter);
    await new Promise((resolve) => { server = http.createServer(app).listen(0, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${server.address().port}`;
    await ensureOwnerClaim();
    owner = await signIn(true, dataRoot);
    other = await signIn(false, dataRoot);
    expect([Boolean(owner), Boolean(other)]).toEqual([true, true]);
  }, 60000);

  afterAll(async () => {
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  test('read by a signed-in operator; turned off, numbered and on again by the install owner; refused to anyone else and to nonsense', async () => {
    expect((await fetch(`${url}/api/v1/security/write-limit`)).status).toBe(401);
    expect(await (await fetch(`${url}/api/v1/security/write-limit`, { headers: as(other) })).json()).toEqual({ on: true, cap: 10, default: 10, max: 1000 });
    expect((await fetch(`${url}/api/v1/security/write-limit`, { method: 'PUT', headers: as(other), body: JSON.stringify({ on: false }) })).status).toBe(403);
    const off = await fetch(`${url}/api/v1/security/write-limit`, { method: 'PUT', headers: as(owner), body: JSON.stringify({ on: false }) });
    expect([off.status, (await off.json()).on]).toEqual([200, false]);
    const numbered = await fetch(`${url}/api/v1/security/write-limit`, { method: 'PUT', headers: as(owner), body: JSON.stringify({ on: true, cap: 40 }) });
    expect(await numbered.json()).toMatchObject({ on: true, cap: 40 });
    expect((await fetch(`${url}/api/v1/security/write-limit`, { method: 'PUT', headers: as(owner), body: JSON.stringify({ cap: 5000 }) })).status).toBe(400);
    expect(await writeLimitSettings.read()).toEqual({ on: true, cap: 40 });
  });
});
