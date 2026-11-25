/**
 * THE DEV REFRESH (electron/dev-refresh.cjs, DevRefreshBar.jsx) — Design note, 2026-11-20: […]. Proven here:
 * - which part of the running app a changed file belongs to;
 * - what a refresh does for what waits;
 * - the real watcher on a real folder: a save is heard with its part, and what nothing running reads is not;
 * - the bar, rendered for real (react-dom/server).
 * The IPC and the in-place restart run in Electron itself.
 */
/* global setTimeout */
import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DevRefreshView, waitingWords } from '../../frontend/app/RelinkShell/DevRefreshBar.jsx';

const require = createRequire(import.meta.url);
const { kindOf, planOf, viewOf, watchSource } = require('../../electron/dev-refresh.cjs');

describe('what a changed file asks for', () => {
  test('server code restarts the server; the desk\'s code rebuilds the desk; the app\'s own code needs the app restarted', () => {
    expect(kindOf('backend/services/chat-line.js')).toBe('server');
    expect(kindOf('core/silo/compile-silo.js')).toBe('server');
    expect(kindOf('voice-engines/engines.json')).toBe('server');
    expect(kindOf('frontend/app/RelinkShell/ChatLineSection.jsx')).toBe('desk');
    expect(kindOf('frontend/app/RelinkShell/UpdateBar.css')).toBe('desk');
    expect(kindOf('index.html')).toBe('desk');
    expect(kindOf('vite.config.js')).toBe('desk');
    expect(kindOf('electron/main.cjs')).toBe('app');
    expect(kindOf('package.json')).toBe('app');
  });

  test('what nothing running reads waits for nothing: tests, docs, data, built output, editor droppings', () => {
    for (const rel of ['test/unit/x.test.js', 'docs/work/a.md', 'changelog.d/x.md', 'data/image-forge/attempts.jsonl', 'dist/index.html',
      'frontend/node_modules/x/index.js', 'backend/services/.chat-line.js.swp', 'backend/services/x.js~', 'backend/README.md', 'voice-engines/whisper/server.py']) {
      expect(kindOf(rel), rel).toBeNull();
    }
  });

  test('a refresh builds only for the desk, restarts only for the server, and cannot load the app\'s own change', () => {
    expect(planOf({ server: 2, desk: 0, app: 0 })).toEqual({ build: false, restartServer: true, reload: true, appRestart: false });
    expect(planOf({ server: 0, desk: 1, app: 0 })).toEqual({ build: true, restartServer: false, reload: true, appRestart: false });
    expect(planOf({ server: 0, desk: 0, app: 1 })).toEqual({ build: false, restartServer: false, reload: false, appRestart: true });
    expect(viewOf({ waiting: { server: 1, desk: 1, app: 0 }, files: ['a'], since: 5, phase: 'idle', error: null }).plan).toMatchObject({ build: true, restartServer: true });
  });
});

describe('the watcher, on a real folder', () => {
  test('a save is heard with its part; a write nothing running reads is not', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir() === '/tmp' ? '/var/tmp' : os.tmpdir(), 'dev-refresh-'));
    const heard = [];
    let stop = () => {};
    try {
      for (const dir of ['backend/services', 'frontend/app', 'electron', 'docs', 'backend/node_modules/x']) await fs.mkdir(path.join(root, dir), { recursive: true });
      stop = watchSource(root, (rel, kind) => heard.push(`${kind}:${rel}`));
      await new Promise((r) => setTimeout(r, 100));
      await fs.writeFile(path.join(root, 'backend/services/a.js'), 'export const a = 1;\n');
      await fs.writeFile(path.join(root, 'frontend/app/B.jsx'), 'export const B = 1;\n');
      await fs.writeFile(path.join(root, 'electron/main.cjs'), '// main\n');
      await fs.writeFile(path.join(root, 'package.json'), '{}\n');
      await fs.writeFile(path.join(root, 'docs/x.md'), '# x\n');
      await fs.writeFile(path.join(root, 'backend/node_modules/x/index.js'), 'x\n');
      const until = Date.now() + 5000;
      while (Date.now() < until && !['server:backend/services/a.js', 'desk:frontend/app/B.jsx', 'app:electron/main.cjs', 'app:package.json'].every((h) => heard.includes(h))) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(new Set(heard)).toEqual(new Set(['server:backend/services/a.js', 'desk:frontend/app/B.jsx', 'app:electron/main.cjs', 'app:package.json']));
    } finally {
      stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('the bar', () => {
  const view = (waiting, extra = {}) => viewOf({ waiting, files: ['backend/services/a.js'], since: 1, phase: 'idle', error: null, ...extra });
  const html = (v) => renderToStaticMarkup(createElement(DevRefreshView, { view: v, pending: false, onAct: () => {} }));

  test('nothing waiting, nothing shown', () => {
    expect(html(view({ server: 0, desk: 0, app: 0 }))).toBe('');
  });

  test('server and desk waiting: what waits, and one REFRESH', () => {
    const out = html(view({ server: 3, desk: 2, app: 0 }));
    expect(waitingWords({ server: 3, desk: 2, app: 0 })).toBe('server 3 · desk 2');
    expect(out).toContain('CHANGES WAITING');
    expect(out).toContain('server 3 · desk 2');
    expect(out).toContain('>REFRESH</button>');
    expect(out).not.toContain('quit and start it again');
  });

  test('only the app changed: no REFRESH, the bar says the app must be restarted', () => {
    const out = html(view({ server: 0, desk: 0, app: 1 }));
    expect(out).not.toContain('REFRESH');
    expect(out).toContain('The app itself changed: quit and start it again to load that part.');
  });

  test('mid-refresh it says what it is doing and holds the buttons; a failed build shows its last lines', () => {
    const building = html(view({ server: 1, desk: 1, app: 0 }, { phase: 'building' }));
    expect(building).toContain('BUILDING THE DESK…');
    expect(building).toMatch(/<button[^>]*disabled=""[^>]*>REFRESH<\/button>/);
    const failed = html(view({ server: 0, desk: 1, app: 0 }, { phase: 'failed', error: 'The desk did not build:\nerror: Unexpected token' }));
    expect(failed).toContain('Unexpected token');
  });
});
