import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unsealDirectories } from '../helpers/temp-fs.js';
import { loraRequestForBinding } from '../../core/refinement/binding.js';
import {
  adapterBoardsOntoLaunch,
  releaseStagedArtifactHandle,
  stageArtifactFile,
  verifyStagedArtifactHandle,
} from '../../backend/services/refinement-artifact-staging.js';
import { createRefinementProcessOperation } from '../../backend/services/refinement-process-operation.js';
import {
  activateServingLoadedAdapterAuthority,
  createServingLoadedAdapterAuthority,
  projectActiveServingLoadedAdapters,
  releaseServingLoadedAdapterAuthority,
} from '../../backend/services/serving-loaded-adapter-authority.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const MAXIMUM_BYTES = 1024;

let root;
let stagingRoot;
let operation;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'artifact-staging-'));
  stagingRoot = path.join(root, 'private');
  operation = createRefinementProcessOperation({ timeoutMs: 30_000 });
});

afterEach(async () => {
  // A published CAS object directory is sealed to 0o500 — it locks even the
  // owning uid out of unlinking the bytes inside it, so a suite that builds a
  // REAL store must unseal before removing its own temp root.
  await unsealDirectories(root);
  rmSync(root, { recursive: true, force: true });
});

describe('stageArtifactFile', () => {
  it('retains exact immutable bytes after the mutable source path is replaced', async () => {
    const source = path.join(root, 'adapter.gguf');
    const original = Buffer.from('approved adapter bytes');
    writeFileSync(source, original, { mode: 0o600 });

    const staged = await stageArtifactFile({
      sourcePath: source,
      sha256: sha256(original),
      label: 'adapter',
      maximumBytes: MAXIMUM_BYTES,
      root: stagingRoot,
      operation,
    });
    try {
      const replacement = path.join(root, 'replacement.gguf');
      writeFileSync(replacement, 'substituted adapter bytes', { mode: 0o600 });
      renameSync(replacement, source);

      await expect(verifyStagedArtifactHandle(staged, operation)).resolves.toEqual({
        sha256: sha256(original),
        bytes: original.length,
      });
      expect(staged).not.toHaveProperty('path');
      expect(staged).not.toHaveProperty('handle');
      expect(staged).not.toHaveProperty('fd');
    } finally {
      await releaseStagedArtifactHandle(staged, operation);
    }
  });

  it('rejects bytes that differ from the declared content authority', async () => {
    const source = path.join(root, 'model.gguf');
    writeFileSync(source, 'different serving bytes', { mode: 0o600 });

    await expect(stageArtifactFile({
      sourcePath: source,
      sha256: sha256('approved serving bytes'),
      label: 'serving model',
      maximumBytes: MAXIMUM_BYTES,
      root: stagingRoot,
      operation,
    })).rejects.toThrow(/digest|authority|differs/u);
  });

  it('rejects symlink sources and unsafe source permissions', async () => {
    const target = path.join(root, 'target.gguf');
    const link = path.join(root, 'link.gguf');
    writeFileSync(target, 'real bytes', { mode: 0o600 });
    symlinkSync(target, link);

    await expect(stageArtifactFile({
      sourcePath: link,
      sha256: sha256('real bytes'),
      maximumBytes: MAXIMUM_BYTES,
      root: stagingRoot,
      operation,
    })).rejects.toThrow();

    chmodSync(target, 0o622);
    await expect(stageArtifactFile({
      sourcePath: target,
      sha256: sha256('real bytes'),
      maximumBytes: MAXIMUM_BYTES,
      root: stagingRoot,
      operation,
    })).rejects.toThrow(/protected|permissions|unsafe/u);
  });

  it('holds two independently closable authorities for one verified CAS object', async () => {
    const source = path.join(root, 'shared.gguf');
    const bytes = Buffer.from('one immutable object');
    writeFileSync(source, bytes, { mode: 0o600 });
    const request = {
      sourcePath: source,
      sha256: sha256(bytes),
      root: stagingRoot,
      maximumBytes: MAXIMUM_BYTES,
      operation,
    };

    const first = await stageArtifactFile(request);
    const second = await stageArtifactFile(request);
    try {
      await expect(verifyStagedArtifactHandle(first, operation)).resolves.toEqual({
        sha256: sha256(bytes),
        bytes: bytes.length,
      });
      await expect(verifyStagedArtifactHandle(second, operation)).resolves.toEqual({
        sha256: sha256(bytes),
        bytes: bytes.length,
      });
    } finally {
      await Promise.all([
        releaseStagedArtifactHandle(first, operation),
        releaseStagedArtifactHandle(second, operation),
      ]);
    }
  });
});

describe('adapterBoardsOntoLaunch — the forge-base law at launch', () => {
  const gemmaLaunch = Object.freeze({
    model: '/models/neuma/gemma-4-31b-q8/gemma-4-31B-it-Q8_0.gguf',
    servingModel: 'gemma-4-31b',
  });
  const qwenLaunch = Object.freeze({
    model: '/models/neuma/qwen3.8-27b-q8/Qwen3.8-27B-Q8_0.gguf',
    servingModel: 'qwen3.8-27b',
  });

  it('boards an adapter recorded in filename form onto its own base', () => {
    expect(adapterBoardsOntoLaunch('gemma-4-31B-it-Q8_0.gguf', gemmaLaunch)).toBe(true);
  });

  it('boards an adapter recorded in serving-key form onto its own base', () => {
    expect(adapterBoardsOntoLaunch('gemma-4-31b', gemmaLaunch)).toBe(true);
  });

  it('refuses a gemma-forged adapter onto a qwen base in both recorded forms', () => {
    expect(adapterBoardsOntoLaunch('gemma-4-31B-it-Q8_0.gguf', qwenLaunch)).toBe(false);
    expect(adapterBoardsOntoLaunch('gemma-4-31b', qwenLaunch)).toBe(false);
  });

  it('refuses a same-arch adapter from a different artifact (different quant)', () => {
    expect(adapterBoardsOntoLaunch('gemma-4-31B-it-Q4_K_M.gguf', gemmaLaunch)).toBe(false);
  });

  it('refuses empty and non-string base records', () => {
    expect(adapterBoardsOntoLaunch('', gemmaLaunch)).toBe(false);
    expect(adapterBoardsOntoLaunch(null, gemmaLaunch)).toBe(false);
    expect(adapterBoardsOntoLaunch(undefined, gemmaLaunch)).toBe(false);
  });

  it('refuses when the launch declares no model identity at all', () => {
    expect(adapterBoardsOntoLaunch('gemma-4-31b', {})).toBe(false);
    expect(adapterBoardsOntoLaunch('gemma-4-31b', { model: '', servingModel: null })).toBe(false);
  });
});

describe('loaded adapter authority', () => {
  it('binds by exact digest through a path-free supervised projection', () => {
    const selectedSha256 = sha256('selected adapter');
    const otherSha256 = sha256('other adapter');
    const authority = createServingLoadedAdapterAuthority({
      launchInstanceSha256: sha256('launch instance'),
      adapters: [
        { artifactSha256: selectedSha256 },
        { artifactSha256: otherSha256 },
      ],
      childFds: [4, 5],
    });
    activateServingLoadedAdapterAuthority(authority);
    try {
      const loaded = projectActiveServingLoadedAdapters([
        { id: 7, path: '/proc/self/fd/4' },
        { id: 8, path: '/proc/self/fd/5' },
      ]);
      expect(loaded.adapters).toEqual([
        { artifactSha256: selectedSha256, serverAdapterId: 7 },
        { artifactSha256: otherSha256, serverAdapterId: 8 },
      ]);
      expect(JSON.stringify(loaded)).not.toContain('/proc/');
      expect(loraRequestForBinding(loaded, { sha256: selectedSha256, scale: 1 })).toEqual([
        { id: 7, scale: 1 },
        { id: 8, scale: 0 },
      ]);
      expect(loraRequestForBinding(loaded, {
        sha256: sha256('not loaded'),
        scale: 1,
      })).toBeNull();
    } finally {
      releaseServingLoadedAdapterAuthority(authority);
    }
  });
});
