// C-07 RULE 0 verification — pure formatSnapshot + impure getDaemonHealth.
// formatSnapshot is fully pure (string-in, string-out); daemon-probe is
// tested against a dead port and a real ephemeral HTTP server.

import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { withEnv } from '../helpers/with-env.js';
import { formatSnapshot, renderSnapshot } from '../../cli/lib/dispatch.js';
import { getDaemonHealth } from '../../cli/lib/daemon-probe.js';
import { peekActiveBeing } from '../../cli/lib/active-being.js';

const collectStdout = () => {
  const chunks = [];
  return {
    write: (s) => { chunks.push(s); return true; },
    getText: () => chunks.join(''),
  };
};

describe('cli/lib/dispatch — formatSnapshot (pure)', () => {
  const baseline = { version: '0.1.0', backend: 'http://localhost:3333' };

  test('daemon alive + active env', () => {
    const out = formatSnapshot({
      ...baseline,
      daemon: { alive: true, status: 200 },
      active: { source: 'env', value: 'fenna' },
    });
    expect(out).toMatch(/neuma v0\.1\.0/);
    expect(out).toMatch(/daemon: alive \(http:\/\/localhost:3333\)/);
    expect(out).toMatch(/active being: fenna \(from NEUMA_BEING env\)/);
    expect(out).toMatch(/Subcommands: code, witness, agent, talk, summon, edit/);
  });

  test('daemon alive + active file', () => {
    const out = formatSnapshot({
      ...baseline,
      daemon: { alive: true, status: 200 },
      active: { source: 'file', value: 'galen' },
    });
    expect(out).toMatch(/active being: galen \(from \.neuma\/active\)/);
  });

  test('daemon alive + no active being', () => {
    const out = formatSnapshot({
      ...baseline,
      daemon: { alive: true, status: 200 },
      active: null,
    });
    expect(out).toMatch(/active being: \(none configured\)/);
    expect(out).toMatch(/set with: neuma summon/);
  });

  test('daemon dormant (with error detail) + active set', () => {
    const out = formatSnapshot({
      ...baseline,
      daemon: { alive: false, error: 'ECONNREFUSED' },
      active: { source: 'env', value: 'fenna' },
    });
    expect(out).toMatch(/daemon: dormant \(http:\/\/localhost:3333\) — ECONNREFUSED/);
    expect(out).toMatch(/start with: scripts\/neuma-daemon\.sh start/);
    expect(out).toMatch(/active being: fenna/);
  });

  test('daemon dormant + no active', () => {
    const out = formatSnapshot({
      ...baseline,
      daemon: { alive: false, error: 'timeout after 1500ms' },
      active: null,
    });
    expect(out).toMatch(/daemon: dormant/);
    expect(out).toMatch(/timeout after 1500ms/);
    expect(out).toMatch(/active being: \(none configured\)/);
  });

  test('always ends with a newline (consistent stdout shape)', () => {
    const out = formatSnapshot({
      ...baseline,
      daemon: { alive: true },
      active: null,
    });
    expect(out.endsWith('\n')).toBe(true);
  });
});

describe('cli/lib/daemon-probe — getDaemonHealth (real network)', () => {
  test('dead port → alive: false + ECONNREFUSED', async () => {
    // Port 1 is reserved and refuses connection on any reasonable OS.
    const r = await getDaemonHealth({ backend: 'http://localhost:1', timeoutMs: 1000 });
    expect(r.alive).toBe(false);
    expect(r.error).toBeTruthy();
  });

  test('real http server returning 200 → alive: true + status 200', async () => {
    let server;
    const port = await new Promise((resolve) => {
      server = createServer((req, res) => {
        if (req.url === '/api/v1/health') {
          res.writeHead(200);
          res.end('ok');
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      server.listen(0, () => resolve(server.address().port));
    });
    try {
      const r = await getDaemonHealth({ backend: `http://localhost:${port}` });
      expect(r.alive).toBe(true);
      expect(r.status).toBe(200);
    } finally {
      await new Promise((res) => server.close(res));
    }
  });

  test('real http server returning 500 → alive: false + status 500', async () => {
    let server;
    const port = await new Promise((resolve) => {
      server = createServer((req, res) => {
        res.writeHead(500);
        res.end();
      });
      server.listen(0, () => resolve(server.address().port));
    });
    try {
      const r = await getDaemonHealth({ backend: `http://localhost:${port}` });
      expect(r.alive).toBe(false);
      expect(r.status).toBe(500);
    } finally {
      await new Promise((res) => server.close(res));
    }
  });

  test('timeout → alive: false + timeout error', async () => {
    let server;
    const port = await new Promise((resolve) => {
      server = createServer(() => { /* hang forever */ });
      server.listen(0, () => resolve(server.address().port));
    });
    try {
      const r = await getDaemonHealth({ backend: `http://localhost:${port}`, timeoutMs: 200 });
      expect(r.alive).toBe(false);
      expect(r.error).toMatch(/timeout after 200ms/);
    } finally {
      // Force-close hanging connections
      server.closeAllConnections?.();
      await new Promise((res) => server.close(res));
    }
  });
});

describe('cli/lib/dispatch — renderSnapshot (real composition, no mocks)', () => {
  test('writes the full snapshot end-to-end against a dead backend', async () => {
    const project = await createTempDir('cli-render-snapshot');
    mkdirSync(join(project, '.git'));
    const sink = collectStdout();

    await withEnv('NEUMA_BEING', undefined, async () => {
      await renderSnapshot({
        stdout: sink,
        version: '0.1.0',
        backend: 'http://localhost:1', // ECONNREFUSED → dormant path
        cwd: project,
      });
    });

    const out = sink.getText();
    expect(out).toMatch(/neuma v0\.1\.0/);
    expect(out).toMatch(/daemon: dormant \(http:\/\/localhost:1\)/);
    expect(out).toMatch(/active being: \(none configured\)/);
    expect(out).toMatch(/Subcommands: code, witness, agent, talk, summon, edit/);
  });

  test('picks up NEUMA_BEING env in the snapshot', async () => {
    const project = await createTempDir('cli-render-snapshot-env');
    mkdirSync(join(project, '.git'));
    const sink = collectStdout();

    await withEnv('NEUMA_BEING', 'fenna', async () => {
      await renderSnapshot({
        stdout: sink,
        version: '0.1.0',
        backend: 'http://localhost:1',
        cwd: project,
      });
    });

    expect(sink.getText()).toMatch(/active being: fenna \(from NEUMA_BEING env\)/);
  });

  test('picks up .neuma/active file in the snapshot', async () => {
    const project = await createTempDir('cli-render-snapshot-file');
    mkdirSync(join(project, '.git'));
    mkdirSync(join(project, '.neuma'));
    writeFileSync(join(project, '.neuma', 'active'), 'galen\n');
    const sink = collectStdout();

    await withEnv('NEUMA_BEING', undefined, async () => {
      await renderSnapshot({
        stdout: sink,
        version: '0.1.0',
        backend: 'http://localhost:1',
        cwd: project,
      });
    });

    expect(sink.getText()).toMatch(/active being: galen \(from \.neuma\/active\)/);
  });

  // R1.1 defense: peekActiveBeing must NOT throw when .neuma/active is
  // unreadable. Test by mkdir'ing where the file should be — readFileSync
  // throws EISDIR; peekActiveBeing must catch and return null.
  test('peekActiveBeing returns null when .neuma/active is a DIRECTORY (no throw)', async () => {
    const project = await createTempDir('cli-peek-isdir');
    mkdirSync(join(project, '.neuma'));
    mkdirSync(join(project, '.neuma', 'active')); // active is a DIR not a file

    await withEnv('NEUMA_BEING', undefined, async () => {
      expect(() => peekActiveBeing({ projectRoot: project })).not.toThrow();
      expect(peekActiveBeing({ projectRoot: project })).toBeNull();
    });
  });

  test('renderSnapshot tolerates .neuma/active being a directory (degrades to none)', async () => {
    const project = await createTempDir('cli-render-isdir');
    mkdirSync(join(project, '.git'));
    mkdirSync(join(project, '.neuma'));
    mkdirSync(join(project, '.neuma', 'active'));
    const sink = collectStdout();

    await withEnv('NEUMA_BEING', undefined, async () => {
      await expect(renderSnapshot({
        stdout: sink,
        version: '0.1.0',
        backend: 'http://localhost:1',
        cwd: project,
      })).resolves.not.toThrow();
    });

    expect(sink.getText()).toMatch(/active being: \(none configured\)/);
  });
});
