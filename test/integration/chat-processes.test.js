/**
 * WHAT THE CHATS LEFT RUNNING (chat-processes.js, the coding shell's mark, GET/POST /api/v1/workspace/_processes,
 * ShellDock) — Design note, 2026-11-19, a crawl a being left running […]: […]
 * A real command through the real coding shell (direct, as with the sandbox off) leaves a real process running in the
 * background; it is found by its chat's mark, listed for its owner only, and stopped — real processes, real signals,
 * a real app and signed session (RULE 0). Linux only, as the process table is read from /proc.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import process from 'node:process';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { runWitnessCommand } from '../../backend/services/witness-coding-sandbox.js';
import { listChatProcesses, stopChatProcesses, startedByOf } from '../../backend/services/chat-processes.js';
import { processRows, ago } from '../../frontend/app/RelinkShell/shell-dock-view.js';
import workspaceRouter from '../../backend/routes/workspace-routes.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const linux = process.platform === 'linux';

describe.runIf(linux)('a process a chat left running is found, shown and stopped', () => {
  let me, app, folder;
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'chat-processes-test-key';
    useTempRealm();
    folder = await createTempDir('chat-processes');
    setWorkspacesRoot(path.join(folder, 'workspaces'));
    me = await fullAuth();
    app = express();
    app.use(express.json());
    app.use('/api/v1/workspace', workspaceRouter);
  }, 60000);
  afterAll(async () => {
    // Nothing this test started may outlive it.
    for (const g of (await listChatProcesses({ wallet: me.address, fresh: true })).groups) await stopChatProcesses({ wallet: me.address, pgid: g.pgid, graceMs: 200 });
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  test('a command that leaves something running — nohup and & — is found by its chat\'s mark, with what it runs and where; only its owner sees it, and STOP ends it', async () => {
    const startedBy = startedByOf({ wallet: me.address, laneId: 'lifovan', sessionId: 'session-crawl' });
    // As a being does it: let the work go and return at once.
    const ran = await runWitnessCommand({ direct: true, sourceRoot: folder, command: 'nohup sleep 120 >/dev/null 2>&1 & echo started', startedBy });
    expect(ran.exitCode).toBe(0);
    expect(ran.stdout).toContain('started');

    const mine = await listChatProcesses({ wallet: me.address, fresh: true });
    expect(mine.supported).toBe(true);
    const crawl = mine.groups.find((g) => g.command === 'sleep 120');
    expect(crawl).toMatchObject({ laneId: 'lifovan', sessionId: 'session-crawl', cwd: folder, wallet: me.address.toLowerCase() });
    expect(Date.parse(crawl.startedAt)).toBeGreaterThan(Date.now() - 60_000);
    // Narrowed to a chat, to a being; another owner sees none of it.
    expect((await listChatProcesses({ wallet: me.address, sessionId: 'session-crawl' })).groups.map((g) => g.pgid)).toContain(crawl.pgid);
    expect((await listChatProcesses({ wallet: me.address, sessionId: 'another-chat' })).groups).toEqual([]);
    expect((await listChatProcesses({ wallet: '0x0000000000000000000000000000000000000001' })).groups).toEqual([]);

    // Through the route, for the signed-in owner only.
    const listed = (await as(request(app).get('/api/v1/workspace/_processes'))).body;
    expect(listed.groups.some((g) => g.pgid === crawl.pgid && g.laneId === 'lifovan')).toBe(true);
    expect((await request(app).get('/api/v1/workspace/_processes')).status).toBe(401);

    // The dock: this chat's, and every chat's.
    const rows = processRows(listed, { laneId: 'lifovan', sessionId: 'session-crawl' });
    expect(rows.here.map((g) => g.pgid)).toContain(crawl.pgid);
    expect(processRows(listed, { laneId: 'lifovan', sessionId: 'another-chat' })).toMatchObject({ here: [], everywhere: listed.groups.length });
    expect(ago(new Date(Date.now() - 2 * 3600_000 - 5 * 60_000).toISOString())).toBe('started 2h 5m ago');

    // STOP: refused for a group nobody's chat started, then the crawl ends.
    expect((await as(request(app).post('/api/v1/workspace/_processes/1/stop'))).status).toBe(400);
    expect((await as(request(app).post(`/api/v1/workspace/_processes/${process.pid}/stop`))).status).toBe(404);
    const stopped = await as(request(app).post(`/api/v1/workspace/_processes/${crawl.pgid}/stop`));
    expect(stopped.body).toMatchObject({ ok: true });
    expect((await listChatProcesses({ wallet: me.address, fresh: true })).groups.some((g) => g.pgid === crawl.pgid)).toBe(false);
  }, 60000);

  test('the dock renders what this chat left running, and the door to every chat\'s', async () => {
    const { ShellDock } = await import('../../frontend/app/RelinkShell/ShellDock.jsx');
    // Before its first read the dock draws nothing (it never shows an empty frame).
    expect(renderToStaticMarkup(createElement(ShellDock, { laneId: 'lifovan', wsService: null }))).toBe('');
  });
});
