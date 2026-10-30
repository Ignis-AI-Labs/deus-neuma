// What the app fetches and runs at runtime is pinned: every Hugging Face model snapshot to a commit,
// every voice engine's Python environment to its shipped uv.lock, every MCP package npx starts to
// the version the app ships. Reads the real manifest, runs the real uv on a real project, and calls
// the routes' own argv builder (no mocks).
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { uvRunArgs, uvSyncArgs } from '../../backend/services/voice/engine-process.js';
import { PINNED_MCP_PACKAGES, pinnedMcpArgs, validateMcpSpawn } from '../../backend/routes/mcp-routes.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));
const { engines } = readJson('voice-engines/engines.json');
const COMMIT = /^[0-9a-f]{40}$/;

describe('voice engine downloads are pinned to a commit', () => {
  const snapshots = Object.values(engines).filter((e) => e.download?.method === 'huggingface_snapshot');

  test('every Hugging Face snapshot, and every extra repo it pulls, names a commit', () => {
    expect(snapshots.map((e) => e.id)).toEqual(expect.arrayContaining(['zonos', 'kokoro', 'parler', 'f5-tts']));
    for (const engine of snapshots) {
      for (const block of [engine.download, ...(engine.download.extraRepos ?? [])]) {
        expect(block.revision, `${engine.id} ${block.repo}`).toMatch(COMMIT);
      }
    }
  });

  test('no snapshot takes Python files from a model repo (zonos loads none)', () => {
    expect(engines.zonos.download.allowPatterns).not.toContain('*.py');
    for (const engine of snapshots) {
      for (const block of [engine.download, ...(engine.download.extraRepos ?? [])]) {
        expect((block.allowPatterns ?? []).filter((p) => p.endsWith('.py')), engine.id).toEqual([]);
      }
    }
  });
});

describe('voice engine environments install from their lock', () => {
  test('uv sync and uv run both carry --locked', () => {
    expect(uvSyncArgs('/e')).toEqual(['sync', '--locked', '--project', '/e']);
    expect(uvRunArgs('/e', '/e/server.py')).toEqual(['run', '--locked', '--project', '/e', 'python', '/e/server.py']);
  });

  const uv = spawnSync('uv', ['--version']).status === 0;
  test.skipIf(!uv)('a project whose lock no longer matches is refused, and its lock is left as it was', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uv-locked-'));
    const env = { ...process.env, UV_OFFLINE: '1', UV_PYTHON_DOWNLOADS: 'never' };
    fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname = "probe"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = []\n');
    expect(spawnSync('uv', ['lock', '--project', dir], { env }).status).toBe(0);
    const lock = fs.readFileSync(path.join(dir, 'uv.lock'), 'utf8');
    fs.writeFileSync(path.join(dir, 'pyproject.toml'), fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8').replace('0.1.0', '0.2.0'));
    const run = spawnSync('uv', uvSyncArgs(dir), { env, encoding: 'utf8' });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/--locked/);
    expect(fs.readFileSync(path.join(dir, 'uv.lock'), 'utf8')).toBe(lock);
  });
});

describe('MCP packages run at the version the app ships', () => {
  const { dependencies } = readJson('package.json');
  const lock = readJson('package-lock.json');

  test('each pinned version is the dependency the app installs', () => {
    for (const [name, version] of Object.entries(PINNED_MCP_PACKAGES)) {
      expect(dependencies[name], name).toBe(version);
      expect(lock.packages[`node_modules/${name}`].version, name).toBe(version);
    }
  });

  test('a validated spawn names the package with its version; every other token is untouched', () => {
    const fsArgs = ['-y', '@modelcontextprotocol/server-filesystem', REPO];
    expect(validateMcpSpawn('npx', fsArgs).ok).toBe(true);
    expect(pinnedMcpArgs(fsArgs)).toEqual(['-y', `@modelcontextprotocol/server-filesystem@${PINNED_MCP_PACKAGES['@modelcontextprotocol/server-filesystem']}`, REPO]);
    expect(pinnedMcpArgs(['@modelcontextprotocol/server-memory'])).toEqual([`@modelcontextprotocol/server-memory@${PINNED_MCP_PACKAGES['@modelcontextprotocol/server-memory']}`]);
  });

  test('a client still cannot choose the version itself', () => {
    expect(validateMcpSpawn('npx', ['-y', '@modelcontextprotocol/server-memory@latest']).ok).toBe(false);
  });
});
