/**
 * INFRA-008 (#210) and INFRA-009 (#211) — the launch and the quit.
 *
 * Both were witnessed on Mars's machine, 2026-07-29, on a fresh Windows install.
 *
 * #210 — THE LAUNCH. `initializeMCP()` was `await`ed BEFORE `server.listen`. The
 * filesystem server rides an `npx` wrapper, so a cold npm cache, a slow registry
 * or an antivirus pass over its ~130 packages can hold the handshake for the
 * whole 30s connect timeout. While it did, `/api/v1/health` did not exist yet —
 * so the Electron shell's own 30s wait expired and the app quit with […]. Two 30s budgets in SERIES: the shell gave up at the
 * exact moment the backend would have gone on.
 *
 * #211 — THE QUIT. On Windows `child.kill()` is TerminateProcess against ONE
 * pid: no JS SIGTERM, no handlers, no tree. The orphaned MCP server then died
 * writing into a dead pipe, printing an unhandled EPIPE stack that reads like a
 * real fault on a perfectly clean quit.
 *
 * Source assertions, and deliberately so: both defects are ORDERING and REACH —
 * what is awaited before the listen, and how many processes a kill takes. There
 * is no pure function to drive; the Electron modules cannot be imported outside
 * an Electron runtime, and proving the launch race for real means a cold npm cache
 * on Windows. The assertions pin the exact shapes that regressed.
 *
 * The boot/lifecycle sequence lives in backend/server-boot.js since the
 * size-law breakdown (2026-08-26) — the pinned shapes moved there verbatim,
 * so these assertions read that file now.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';

const read = (rel) => fs.readFile(path.join(process.cwd(), rel), 'utf8');

describe('INFRA-008 #210 — the listen never waits on an npx child', () => {
  it('initializeMCP is fired, not awaited', async () => {
    const source = await read('backend/server-boot.js');
    expect(source).toMatch(/initializeMCP\(\)\.catch\(/);
    expect(source, 'an awaited initializeMCP puts an npx child in front of the listen')
      .not.toMatch(/await initializeMCP\(\)/);
  });

  it('nothing between the boot and the listen awaits the tool surface', async () => {
    const source = await read('backend/server-boot.js');
    const start = source.indexOf('async function startServer()');
    // The bind itself lives in the extracted listen seam (server-listen.js);
    // startServer reaches it through listenServer(...). The ordering law is
    // unchanged: no awaited tool surface between boot start and the listen.
    const listen = source.indexOf('listenServer(', start);
    expect(start).toBeGreaterThan(-1);
    expect(listen).toBeGreaterThan(start);
    expect(source.slice(start, listen)).not.toMatch(/await\s+initializeMCP/);
    // …and the seam must genuinely be the bind, not a rename that lost it.
    const seam = await read('backend/services/server-listen.js');
    expect(seam).toMatch(/server\.listen\(/);
  });

  it('platform.init stays guarded — no boot step may prevent the listen', async () => {
    const source = await read('backend/server-boot.js');
    const at = source.indexOf('await platform.init()');
    expect(at).toBeGreaterThan(-1);
    expect(source.slice(at - 200, at)).toContain('try {');
  });
});

describe('INFRA-009 #211 — the quit takes the whole tree, and says goodbye first', () => {
  it('before-quit kills the TREE, not one pid', async () => {
    const source = await read('electron/main.cjs');
    const at = source.indexOf("app.on('before-quit'");
    expect(at).toBeGreaterThan(-1);
    const handler = source.slice(at, source.indexOf('});', at));
    expect(handler).toContain('killBackendTree()');
    expect(handler, 'a bare backend.kill() leaves the MCP grandchildren standing')
      .not.toMatch(/backend\.kill\(\)/);
  });

  it('Windows gets taskkill /T /F; POSIX walks the real descendant tree', async () => {
    const source = await read('electron/backend-spawn.cjs');
    const fn = source.slice(source.indexOf('const killBackendTree'));
    const body = fn.slice(0, fn.indexOf('\n};'));
    expect(body).toMatch(/process\.platform === 'win32'/);
    expect(body).toMatch(/taskkill/);
    expect(body).toMatch(/'\/T'/);
    expect(body).toMatch(/'\/F'/);
    expect(body).toMatch(/stopPosixBackend\(backend\)/);
    expect(source).toMatch(/if \(!Number\.isInteger\(child\.pid\)\) \{ child\.kill\(\); return; \}/);
    expect(body).not.toMatch(/process\.kill\(-backend\.pid/);
  });

  it('the backend uses utilityProcess without RunAsNode and keeps launch authentication', async () => {
    const source = await read('electron/backend-spawn.cjs');
    expect(source).toMatch(/utilityProcess\.fork\(UTILITY_ENTRY, \[\], \{/);
    expect(source).toMatch(/delete environment\.ELECTRON_RUN_AS_NODE/);
    expect(source).not.toMatch(/ELECTRON_RUN_AS_NODE: '1'/);
    expect(source).not.toMatch(/spawn\(process\.execPath/);
    expect(source).toMatch(/message\.healthToken/);
    expect(source).toMatch(/token: backendHealthToken/);
    expect(source).toMatch(/NEUMA_BACKEND_PROCESS: 'utility'/);
    const entry = await read('electron/backend-utility-entry.cjs');
    expect(entry).toMatch(/installUtilityProcessCompat\(\)/);
    expect(entry).toMatch(/import\('\.\.\/backend\/server\.js'\)/);
    const compat = await read('electron/utility-process-compat.cjs');
    expect(compat).toMatch(/port\.postMessage\(message\)/);
    expect(compat).toMatch(/process\.emit\('message', event\.data\)/);
  });

  it('utility stdio and the parent adapter preserve logs and existing child consumers', async () => {
    const source = await read('electron/backend-spawn.cjs');
    expect(source).toMatch(/asNodeChild\(utilityProcess\.fork/);
    expect(source).toMatch(/captureBackendLog\(backend, backendLog\)/);
    expect(source).toMatch(/backendLog \? \['ignore', 'pipe', 'pipe'\]/);
    const adapter = await read('electron/utility-child.cjs');
    expect(adapter).toMatch(/child\.postMessage\(message\)/);
    expect(adapter).toMatch(/get: \(\) => connected/);
  });

  it('taskkill can never hold the app open, and a failure still kills something', async () => {
    const source = await read('electron/backend-spawn.cjs');
    const fn = source.slice(source.indexOf('const killBackendTree'));
    const body = fn.slice(0, fn.indexOf('\n};'));
    expect(body).toMatch(/stdio: 'ignore'/);
    expect(body).toMatch(/detached: true/);
    expect(body).toMatch(/\.unref\(\)/);
    expect(body).toMatch(/catch\s*\{/); // falls back to the single-pid kill
  });

  it('the backend closes MCP transports deliberately, before the drain', async () => {
    const source = await read('backend/server-boot.js');
    const at = source.indexOf('const shutdown = ');
    expect(at).toBeGreaterThan(-1);
    const body = source.slice(at, source.indexOf('process.on(\'SIGTERM\'', at));
    expect(body).toMatch(/mcpService\.disconnectAll\(\)/);
    // Before gracefulShutdown — a transport told after the drain learns nothing.
    expect(body.indexOf('disconnectAll')).toBeLessThan(body.indexOf('gracefulShutdown'));
    // Fire-and-forget: a transport that will not close must not hold the exit.
    expect(body).toMatch(/disconnectAll\(\)\.catch\(/);
  });

  it('mcpService is imported where shutdown can reach it', async () => {
    const source = await read('backend/server-boot.js');
    expect(source).toMatch(/import \{ mcpService \} from '\.\/services\/mcp\.js'/);
  });
});
