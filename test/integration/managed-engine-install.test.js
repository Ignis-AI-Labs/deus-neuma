/* global Buffer, process */
// The fast engine lands whole, and the supervisor runs it (managed-engine.js, managed-engine-record.js,
// supervisor-launch-config.js). Real tar.gz archives, built here with the system's tar in the
// layout the llama.cpp release ships (the server, and its CUDA runtime in a second archive), served
// by a REAL HTTP server on loopback. The real download, SHA-256 check, unpack, record and launch
// resolution run in every case. No mocks (RULE 0).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createTempDir } from '../helpers/temp-fs.js';

let root; let server; let requests = [];
const served = new Map();
const archives = {};

// a release-shaped tar.gz: one top folder; modes as the archive carries them
const tarball = (name, top, files) => {
  const src = path.join(root, 'src', name);
  fs.mkdirSync(path.join(src, top), { recursive: true });
  for (const [file, body, mode] of files) {
    const at = path.join(src, top, file);
    if (typeof body === 'object') fs.symlinkSync(body.link, at); else { fs.writeFileSync(at, body); fs.chmodSync(at, mode); }
  }
  const out = path.join(root, 'served', name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('tar', ['-czf', out, '-C', src, top]);
  const bytes = fs.readFileSync(out);
  served.set(`/${name}`, bytes);
  return { label: name.startsWith('cudart') ? 'CUDA runtime' : 'llama.cpp', name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), format: 'tar.gz', url: '' };
};

beforeAll(async () => {
  root = await createTempDir('managed-engine-install');
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR = path.join(root, 'claims');
  server = http.createServer((req, res) => {
    requests.push(req.url);
    const bytes = served.get(req.url);
    if (!bytes) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Length': bytes.length, 'Content-Type': 'application/gzip' });
    return res.end(bytes);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // the server group-writable in the archive: the install must make it the owner's alone
  archives.engine = tarball('llama-b1-bin-ubuntu-cuda-13.5-x64.tar.gz', 'llama-b1', [
    ['llama-server', '#!/bin/sh\necho server\n', 0o775],
    ['libllama.so.0.9.0', 'libllama LLAMA_RS_REPLAY', 0o644],
    ['libllama.so.0', { link: 'libllama.so.0.9.0' }],
  ]);
  archives.runtime = tarball('cudart-llama-b1-bin-ubuntu-cuda-13.5-x64.tar.gz', 'cudart-llama-b1-bin-ubuntu-cuda-13.5-x64', [
    ['libcudart.so.13', 'cudart', 0o644],
    ['libcublas.so.13', 'cublas', 0o644],
  ]);
  for (const a of Object.values(archives)) a.url = `${base}/${a.name}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

describe('installEngine — one folder the server finds its libraries in', () => {
  it('fetches both archives, unpacks them together, and keeps nothing else', async () => {
    const { installEngine } = await import('../../backend/services/managed-engine.js');
    const dir = path.join(root, 'home', 'llama.cpp', 'b12212-cuda-13.5');
    requests = [];
    expect(await installEngine(archives, dir)).toBe(dir);
    expect(requests).toEqual([`/${archives.engine.name}`, `/${archives.runtime.name}`]);
    expect(fs.readdirSync(dir).sort()).toEqual(['libcublas.so.13', 'libcudart.so.13', 'libllama.so.0', 'libllama.so.0.9.0', 'llama-server']);
    expect(fs.statSync(path.join(dir, 'llama-server')).mode & 0o777).toBe(0o755);
    expect(fs.readlinkSync(path.join(dir, 'libllama.so.0'))).toBe('libllama.so.0.9.0');
    // the archives and the unpacking folder are gone; only the engine stays
    expect(fs.readdirSync(path.dirname(dir))).toEqual(['b12212-cuda-13.5']);
    // installed is installed: a second call asks the network for nothing
    requests = [];
    await installEngine(archives, dir);
    expect(requests).toEqual([]);
  });

  it('an archive that does not hash to its pin is never unpacked', async () => {
    const { installEngine } = await import('../../backend/services/managed-engine.js');
    const dir = path.join(root, 'bad-home', 'llama.cpp', 'b12212-cuda-13.5');
    const wrong = { ...archives.engine, sha256: '0'.repeat(64) };
    await expect(installEngine({ engine: wrong, runtime: archives.runtime }, dir)).rejects.toMatchObject({ code: 'DOWNLOAD_DAMAGED' });
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(`${dir}.unpacking`)).toBe(false);
  });
});

describe('the supervisor runs the installed engine unless LLAMA_SERVER_BIN names another', () => {
  it('reads the record, rebuilds the path, and lets the env win', async () => {
    const { writeEngineRecord, managedEngineBin } = await import('../../backend/services/managed-engine-record.js');
    const { activeLaunchConfig } = await import('../../backend/services/supervisor-launch-config.js');
    const { engineSupportsReplay } = await import('../../backend/services/serving-drafter.js');
    const home = path.join(root, 'home');
    expect(managedEngineBin()).toBeNull();
    expect(activeLaunchConfig({}).bin).toBe('');
    await writeEngineRecord({ build: 'b12212', variant: 'cuda-13.5', home, installedAt: 'now' });
    const bin = fs.realpathSync(path.join(home, 'llama.cpp', 'b12212-cuda-13.5', 'llama-server'));
    expect(managedEngineBin()).toBe(bin);
    expect(activeLaunchConfig({}).bin).toBe(bin);
    expect(activeLaunchConfig({ LLAMA_SERVER_BIN: '/usr/bin/true' }).bin).toBe('/usr/bin/true');
    // the replay probe reads the installed layout: the libllama beside the server
    expect(await engineSupportsReplay(bin)).toBe(true);
  });

  it('a record naming anything but a build and a CUDA variant names no engine', async () => {
    const { writeEngineRecord, managedEngineBin } = await import('../../backend/services/managed-engine-record.js');
    const home = path.join(root, 'home');
    for (const bad of [{ build: '../../bin', variant: 'cuda-13.5' }, { build: 'b12212', variant: '../x' }, { build: 'b12212', variant: 'cuda-13.5', home: 'relative' }]) {
      await writeEngineRecord({ home, ...bad });
      expect(managedEngineBin()).toBeNull();
    }
    await writeEngineRecord({ build: 'b12212', variant: 'cuda-13.5', home });
    expect(managedEngineBin()).not.toBeNull();
  });
});

const hasNvidia = (() => { try { execFileSync('nvidia-smi', ['-L'], { stdio: 'ignore' }); return process.platform === 'linux'; } catch { return false; } })();

describe('the setup this machine takes (model-server-setup.js)', () => {
  it.skipIf(!hasNvidia)('a Linux PC with an NVIDIA card is offered the engine, with its model and files', async () => {
    const { planView } = await import('../../backend/services/model-server-setup.js');
    const { plan, job, home } = await planView();
    expect(plan).toMatchObject({ supported: true, engine: 'llama.cpp', managed: true });
    expect(plan.steps.map((s) => s.id)).toContain('pull');
    expect(plan.notes[0]).toMatch(/llama\.cpp/);
    expect(job.state).toBe('idle');
    expect(home).toContain(path.join(root, 'home'));
    expect(Buffer.byteLength(plan.model.ref)).toBeGreaterThan(5);
  });
});
