/* global process, setTimeout */
// THE RECORD NAMES NO PROGRAM (re-audit 2026-10-29, NEW-H1). Every backend start reads
// <dataRoot>/model-server/managed.json and starts the platform's model server again. The record used to
// carry the program too, and the boot ran it as the operator, outside every sandbox. Here the REAL
// startManagedAtBoot reads a REAL record forged on a REAL disk, its bin pointing at a REAL executable
// that leaves a mark when it runs. The boot must start only the platform's own server or the machine's
// installed Ollama — here neither exists (PATH holds no ollama), so nothing runs at all. No mocks (RULE 0).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';

const ENV_KEYS = ['NEUMA_DATA_ROOT', 'NEUMA_OLLAMA_ENDPOINT', 'PATH'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let dataRoot; let mark; let evil; let endpoint; let M;

// impure — a loopback port nothing holds, so the old boot would have reached its spawn
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const forge = (record) => {
  fs.mkdirSync(path.join(dataRoot, 'model-server'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'model-server', 'managed.json'), JSON.stringify(record));
};

beforeAll(async () => {
  dataRoot = await createTempDir('managed-boot-record');
  mark = path.join(dataRoot, 'ran');
  evil = path.join(dataRoot, 'planted.sh');
  fs.writeFileSync(evil, `#!/bin/sh\necho "$@" > "${mark}"\n`, { mode: 0o755 });
  endpoint = `http://127.0.0.1:${await freePort()}`;
  const empty = path.join(dataRoot, 'empty-path');
  fs.mkdirSync(empty);
  // the system tools the boot's hardware read uses, without any ollama among them
  Object.assign(process.env, { NEUMA_DATA_ROOT: dataRoot, NEUMA_OLLAMA_ENDPOINT: endpoint, PATH: `${empty}:/usr/bin:/bin` });
  M = await import('../../backend/services/managed-ollama.js');
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('a boot never runs the program a record names', () => {
  it.skipIf(fs.existsSync('/usr/bin/ollama') || fs.existsSync('/bin/ollama'))(
    'a record of an installed Ollama whose bin is a planted program: the planted program never runs',
    async () => {
      forge({ managed: false, bin: evil, endpoint });
      await M.startManagedAtBoot();
      await new Promise((r) => setTimeout(r, 300));
      expect(fs.existsSync(mark)).toBe(false);
    },
    90_000,
  );

  it('a record of the platform\'s own server whose bin is a planted program: only the platform\'s own path counts', async () => {
    forge({ managed: true, bin: evil, endpoint, home: path.join(dataRoot, 'server-home') });
    await M.startManagedAtBoot();
    await new Promise((r) => setTimeout(r, 300));
    expect(fs.existsSync(mark)).toBe(false);
  }, 90_000);

  it('the planted program is real and would leave its mark when run', async () => {
    const { spawnSync } = await import('node:child_process');
    expect(spawnSync(evil, ['serve']).status).toBe(0);
    expect(fs.readFileSync(mark, 'utf8').trim()).toBe('serve');
    fs.rmSync(mark);
  });
});
