/**
 * The folder law — the folder the operator chose IS the authorization
 * (Design note, 2026-08-28. Pure law with real inputs; the store on real fs via its
 * own isolation door (NEUMA_MODEL_FOLDERS_PATH). No mock anywhere (RULE 0).
 */
import { describe, expect, test } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  FOLDER_SERVERS, normalizeFolders, defaultFolders, authorizingFolder,
  igniteFolderRefusal, withFolderAuthorization, readModelFolders, setModelFolders,
  resolveAuthorizedIgnition,
} from '../../backend/services/model-folder-authority.js';

const F = (p, servers = [...FOLDER_SERVERS]) => ({ path: p, servers });

describe('the law, pure', () => {
  test('a model under a chosen folder is authorized; outside every folder it is not', () => {
    const folders = normalizeFolders([F('/mnt/models')]);
    expect(authorizingFolder(folders, '/mnt/models/a/b.gguf')).toBeTruthy();
    expect(authorizingFolder(folders, '/mnt/models-other/b.gguf')).toBeNull();
    expect(authorizingFolder(folders, '/elsewhere/b.gguf')).toBeNull();
  });

  test('marking follows the folder, never a lineage sidecar', () => {
    const folders = normalizeFolders([F('/mnt/models')]);
    const marked = withFolderAuthorization([
      { id: 'in', path: '/mnt/models/in.gguf' },
      { id: 'out', path: '/opt/out.gguf', servingModel: 'x', servingArtifactSha256: 'y' },
    ], folders);
    expect(marked.find((m) => m.id === 'in').authorized).toBe(true);
    expect(marked.find((m) => m.id === 'out').authorized).toBe(false);
  });

  test('the ignite gate refuses outside folders, and inside ones for a disallowed engine', () => {
    const folders = normalizeFolders([F('/mnt/models', ['llama-server'])]);
    expect(igniteFolderRefusal({ path: '/other/m.gguf' }, folders, 'llama-server')).toMatch(/not under an authorized/);
    expect(igniteFolderRefusal({ path: '/mnt/models/m.gguf' }, folders, 'lm-studio')).toMatch(/does not allow lm-studio/);
    expect(igniteFolderRefusal({ path: '/mnt/models/m.gguf' }, folders, 'llama-server')).toBeNull();
  });

  test('normalize refuses relative paths, duplicates, and an engine-less folder', () => {
    expect(() => normalizeFolders([{ path: 'relative/models' }])).toThrow(/absolute/);
    expect(() => normalizeFolders([F('/a'), F('/a/')])).toThrow(/unique/);
    expect(() => normalizeFolders([{ path: '/a', servers: ['not-an-engine'] }])).toThrow(/at least one engine/);
    expect(normalizeFolders([{ path: '/a/' }])[0]).toEqual({ path: '/a', servers: [...FOLDER_SERVERS] });
  });

  test('unset, the wall answers the env roots on every engine — the rig unchanged', () => {
    const env = { NEUMA_MODELS_DIRS: '/models', LLAMA_SERVER_MODEL: '/mnt/data/base/m.gguf' };
    const folders = defaultFolders(env);
    expect(folders.map((f) => f.path).sort()).toEqual(['/mnt/data/base', '/models']);
    expect(folders.every((f) => f.servers.length === FOLDER_SERVERS.length)).toBe(true);
  });
});

describe('the store, real fs', () => {
  const isolated = async () => ({
    NEUMA_MODEL_FOLDERS_PATH: path.join(await createTempDir(`mf-${Math.random().toString(36).slice(2)}`), 'model-folders.json'),
    NEUMA_MODELS_DIRS: '/models',
  });

  test('never-set reads the env-root default; set → read round-trips', async () => {
    const env = await isolated();
    expect((await readModelFolders(env)).map((f) => f.path)).toEqual(['/models']);
    await setModelFolders([F('/home/op/my-models', ['llama-server'])], env);
    const read = await readModelFolders(env);
    expect(read).toEqual([{ path: '/home/op/my-models', servers: ['llama-server'] }]);
  });

  test('a malformed write is refused and the standing store is untouched', async () => {
    const env = await isolated();
    await setModelFolders([F('/home/op/models')], env);
    await expect(setModelFolders([{ path: 'nope' }], env)).rejects.toThrow(/absolute/);
    expect((await readModelFolders(env)).map((f) => f.path)).toEqual(['/home/op/models']);
  });
});

describe('the ignite gate, end to end on a real catalog', () => {
  test('admits an authorized folder+engine, refuses the rest, 400s the unknown', async () => {
    const root = await createTempDir(`mf-gate-${Math.random().toString(36).slice(2)}`);
    const fs = await import('fs/promises');
    await fs.mkdir(path.join(root, 'fam'), { recursive: true });
    await fs.writeFile(path.join(root, 'fam/model-Q8_0.gguf'), 'gguf-bytes');
    const env = {
      NEUMA_MODELS_DIRS: '', LLAMA_SERVER_MODEL: '',
      NEUMA_MODEL_FOLDERS_PATH: path.join(root, 'store.json'),
    };
    await setModelFolders([{ path: root, servers: ['llama-server'] }], env);

    const ok = await resolveAuthorizedIgnition(env, 'fam/model-Q8_0', 'llama-server');
    expect(ok.entry?.path).toBe(path.join(root, 'fam/model-Q8_0.gguf'));

    const wrongEngine = await resolveAuthorizedIgnition(env, 'fam/model-Q8_0', 'lm-studio');
    expect(wrongEngine.status).toBe(403);
    expect(wrongEngine.error).toMatch(/does not allow lm-studio/);

    const unknown = await resolveAuthorizedIgnition(env, 'no-such-model', 'llama-server');
    expect(unknown.status).toBe(400);
  });
});
