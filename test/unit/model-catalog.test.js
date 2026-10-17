/**
 * Model catalog — pure grouping/naming proven with real inputs; the walk
 * proven against a REAL directory tree on real disk (RULE 0 — no mocks).
 */
import { describe, test, expect } from 'vitest';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  modelIdFor, isPrimaryShard, isProjectorFile, groupModels, modelRoots,
  listCatalog, findCatalogModel, modelFamilyKey, projectorFamilyKey, findProjectorFor,
  lineageEvidenceFor,
} from '../../backend/services/model-catalog.js';

describe('pure naming + grouping', () => {
  test('modelIdFor strips extension and shard suffix, keeps publisher/repo path', () => {
    expect(modelIdFor('lmstudio-community/gpt-oss-120b-GGUF/gpt-oss-120b-MXFP4-00001-of-00002.gguf'))
      .toBe('lmstudio-community/gpt-oss-120b-GGUF/gpt-oss-120b-MXFP4');
    expect(modelIdFor('gemma-4-31b-Q4_K_M.gguf')).toBe('gemma-4-31b-Q4_K_M');
  });

  test('isPrimaryShard: first shard or single file', () => {
    expect(isPrimaryShard('m-00001-of-00002.gguf')).toBe(true);
    expect(isPrimaryShard('m-00002-of-00002.gguf')).toBe(false);
    expect(isPrimaryShard('m.gguf')).toBe(true);
  });

  test('projector files are recognized and never cataloged', () => {
    expect(isProjectorFile('mmproj-model-f16.gguf')).toBe(true);
    const grouped = groupModels([
      { relPath: 'x/mmproj-model-f16.gguf', absPath: '/r/x/mmproj-model-f16.gguf', sizeBytes: 5 },
    ]);
    expect(grouped).toEqual([]);
  });

  test('shards fold into one entry: path is the primary, size is the sum', () => {
    const grouped = groupModels([
      { relPath: 'pub/m/m-00002-of-00002.gguf', absPath: '/r/pub/m/m-00002-of-00002.gguf', sizeBytes: 20 },
      { relPath: 'pub/m/m-00001-of-00002.gguf', absPath: '/r/pub/m/m-00001-of-00002.gguf', sizeBytes: 30 },
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].id).toBe('pub/m/m');
    expect(grouped[0].name).toBe('m');
    expect(grouped[0].path).toBe('/r/pub/m/m-00001-of-00002.gguf');
    expect(grouped[0].sizeBytes).toBe(50);
    expect(grouped[0].shards).toBe(2);
  });

  test('a model whose primary shard is missing is not offered', () => {
    const grouped = groupModels([
      { relPath: 'pub/m/m-00002-of-00002.gguf', absPath: '/r/pub/m/m-00002-of-00002.gguf', sizeBytes: 20 },
    ]);
    expect(grouped).toEqual([]);
  });

  test('modelRoots: declared dirs + the configured model dir, nested roots dropped', () => {
    const env = {
      NEUMA_MODELS_DIRS: '/models, /models/inner ,/other',
      LLAMA_SERVER_MODEL: '/models/pub/repo/w-00001-of-00002.gguf',
    };
    expect(modelRoots(env)).toEqual(['/models', '/other']);
    expect(modelRoots({})).toEqual([]);
  });

  test('modelFamilyKey strips shard, extension, and one quant token', () => {
    expect(modelFamilyKey('/m/neuma/gemma-4-31b-q8/gemma-4-31B-it-Q8_0.gguf')).toBe('gemma-4-31b-it');
    expect(modelFamilyKey('/m/pub/m/m-00001-of-00002.gguf')).toBe('m');
    expect(modelFamilyKey('gemma-3-27B-it-qat-Q4_0.gguf')).toBe('gemma-3-27b-it-qat');
    // The MTP-repack quant name (the rig's uncensored Qwen3.8, 2026-09-15):
    // an unstripped suffix split the model from its beside-projector in the
    // family-exact search, and a blind serving shipped.
    expect(modelFamilyKey('/m/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf'))
      .toBe('qwen3.8-27b-uncensored-hauhaucs-aggressive');
  });

  test('projectorFamilyKey strips the mmproj prefix and precision token', () => {
    expect(projectorFamilyKey('mmproj-gemma-4-31B-it-BF16.gguf')).toBe('gemma-4-31b-it');
    expect(projectorFamilyKey('mmproj-gemma-4-31B-it-QAT-BF16.gguf')).toBe('gemma-4-31b-it-qat');
    expect(projectorFamilyKey('dir/mmproj-Qwen3.5-122B-A10B-BF16.gguf')).toBe('qwen3.5-122b-a10b');
  });
});

describe('against a real directory tree', () => {
  const seed = async () => {
    const root = await createTempDir('model-catalog');
    await mkdir(path.join(root, 'pub/big'), { recursive: true });
    await mkdir(path.join(root, 'pub/small'), { recursive: true });
    await writeFile(path.join(root, 'pub/big/big-00001-of-00002.gguf'), 'a'.repeat(64));
    await writeFile(path.join(root, 'pub/big/big-00002-of-00002.gguf'), 'b'.repeat(32));
    await writeFile(path.join(root, 'pub/small/small.gguf'), 'c'.repeat(16));
    await writeFile(path.join(root, 'pub/small/mmproj-small.gguf'), 'd'.repeat(8));
    await writeFile(path.join(root, 'pub/small/notes.txt'), 'not weights');
    return root;
  };

  test('listCatalog finds real gguf files, folds shards, skips projectors', async () => {
    const root = await seed();
    const catalog = listCatalog({ NEUMA_MODELS_DIRS: root });
    expect(catalog.map((m) => m.id)).toEqual(['pub/big/big', 'pub/small/small']);
    const big = catalog[0];
    expect(big.path).toBe(path.join(root, 'pub/big/big-00001-of-00002.gguf'));
    expect(big.sizeBytes).toBe(96);
    expect(big.shards).toBe(2);
  });

  test('findCatalogModel resolves only ids the catalog produced', async () => {
    const root = await seed();
    const env = { NEUMA_MODELS_DIRS: root };
    expect(findCatalogModel(env, 'pub/small/small')?.path).toBe(path.join(root, 'pub/small/small.gguf'));
    expect(findCatalogModel(env, '../../../etc/passwd')).toBeNull();
    expect(findCatalogModel(env, 'pub/big/big-00001-of-00002.gguf')).toBeNull();
  });

  test('a missing root yields an empty catalog, never a throw', () => {
    expect(listCatalog({ NEUMA_MODELS_DIRS: '/definitely/not/here' })).toEqual([]);
  });

  test('findProjectorFor pairs a projector riding beside the model, roots not needed', async () => {
    const root = await seed(); // pub/small holds small.gguf + mmproj-small.gguf
    const found = findProjectorFor({}, path.join(root, 'pub/small/small.gguf'));
    expect(found).toBe(path.join(root, 'pub/small/mmproj-small.gguf'));
  });

  test('findProjectorFor in a multi-model dir pairs by family, never by sort order', async () => {
    const root = await createTempDir('model-catalog');
    await mkdir(path.join(root, 'shared'), { recursive: true });
    const beta = path.join(root, 'shared', 'beta.gguf');
    await writeFile(path.join(root, 'shared', 'alpha.gguf'), 'a');
    await writeFile(beta, 'b');
    // Sort order puts alpha's projector first — a sort-order pairing would
    // hand beta the WRONG projector and fail the llama-server boot.
    await writeFile(path.join(root, 'shared', 'mmproj-alpha-f16.gguf'), 'pa');
    await writeFile(path.join(root, 'shared', 'mmproj-beta-f16.gguf'), 'pb');
    expect(findProjectorFor({}, beta)).toBe(path.join(root, 'shared', 'mmproj-beta-f16.gguf'));
  });

  test('the rig\'s own uncensored repack pairs its beside-projector (2026-09-15)', async () => {
    // The exact rig filenames: an unstripped -Q8_K_P split the model from its
    // projector in the family-exact search, and a blind serving shipped.
    const root = await createTempDir('model-catalog');
    await mkdir(path.join(root, 'repack'), { recursive: true });
    const model = path.join(root, 'repack', 'Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf');
    const projector = path.join(root, 'repack', 'mmproj-Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-BF16.gguf');
    await writeFile(model, 'm');
    await writeFile(projector, 'p');
    expect(findProjectorFor({}, model)).toBe(projector);
  });

  test('findProjectorFor pairs a terminal-qat model with its projector across dirs (echo round-3)', async () => {
    const root = await createTempDir('model-catalog');
    await mkdir(path.join(root, 'served'), { recursive: true });
    await mkdir(path.join(root, 'pub'), { recursive: true });
    // A basename ENDING in '-qat' carries no quant token to strip — qat must
    // survive as family identity on both sides, or this pairing misses.
    const model = path.join(root, 'served', 'gemma-3-27b-it-qat.gguf');
    const projector = path.join(root, 'pub', 'mmproj-gemma-3-27b-it-qat-bf16.gguf');
    await writeFile(model, 'a');
    await writeFile(projector, 'b');
    expect(findProjectorFor({ NEUMA_MODELS_DIRS: root }, model)).toBe(projector);
  });

  test('findProjectorFor refuses a shared dir when no projector names the family', async () => {
    const root = await createTempDir('model-catalog');
    await mkdir(path.join(root, 'shared'), { recursive: true });
    const model = path.join(root, 'shared', 'm-Q8_0.gguf');
    await writeFile(model, 'a');
    // Family-blind names (the publisher's 'mmproj-model-f16' style), more
    // than one of them — no honest pairing exists beside the model.
    await writeFile(path.join(root, 'shared', 'mmproj-model-f16.gguf'), 'x');
    await writeFile(path.join(root, 'shared', 'mmproj-projector-bf16.gguf'), 'y');
    expect(findProjectorFor({}, model)).toBeNull();
  });

  test('findProjectorFor reaches across roots for a family-exact projector — the live rig layout', async () => {
    // Mirrors the real rig: the served weights sit in a bare dir while their
    // projector lives in the publisher's directory on the same rig.
    const root = await createTempDir('model-catalog');
    await mkdir(path.join(root, 'neuma/gemma-4-31b-q8'), { recursive: true });
    await mkdir(path.join(root, 'lmstudio-community/gemma-4-31B-it-GGUF'), { recursive: true });
    await mkdir(path.join(root, 'lmstudio-community/gemma-4-31B-it-QAT-GGUF'), { recursive: true });
    const model = path.join(root, 'neuma/gemma-4-31b-q8/gemma-4-31B-it-Q8_0.gguf');
    const projector = path.join(root, 'lmstudio-community/gemma-4-31B-it-GGUF/mmproj-gemma-4-31B-it-BF16.gguf');
    await writeFile(model, 'a'.repeat(16));
    await writeFile(projector, 'b'.repeat(8));
    // The QAT projector names a DIFFERENT family — it must not compete.
    await writeFile(path.join(root, 'lmstudio-community/gemma-4-31B-it-QAT-GGUF/mmproj-gemma-4-31B-it-QAT-BF16.gguf'), 'c'.repeat(8));
    expect(findProjectorFor({ NEUMA_MODELS_DIRS: root }, model)).toBe(projector);
  });

  test('findProjectorFor refuses an ambiguous rig and a rig with no projector', async () => {
    const root = await createTempDir('model-catalog');
    await mkdir(path.join(root, 'served'), { recursive: true });
    await mkdir(path.join(root, 'a'), { recursive: true });
    await mkdir(path.join(root, 'b'), { recursive: true });
    const model = path.join(root, 'served/m-Q8_0.gguf');
    await writeFile(model, 'a'.repeat(16));
    // No projector anywhere → null.
    expect(findProjectorFor({ NEUMA_MODELS_DIRS: root }, model)).toBeNull();
    // Two distinct family-exact candidates in other dirs → ambiguity refused,
    // never a guess (a wrong projector fails the llama-server boot).
    await writeFile(path.join(root, 'a', 'mmproj-m-BF16.gguf'), '');
    await writeFile(path.join(root, 'b', 'mmproj-m-F16.gguf'), '');
    expect(findProjectorFor({ NEUMA_MODELS_DIRS: root }, model)).toBeNull();
  });
});

describe('serving lineage evidence + authorization (2026-08-18 gate fix)', () => {
  const seedWithEvidence = async () => {
    const root = await createTempDir('model-catalog-lineage');
    await mkdir(path.join(root, 'neuma/authorized'), { recursive: true });
    await mkdir(path.join(root, 'community/plain'), { recursive: true });
    await writeFile(path.join(root, 'neuma/authorized/authorized-Q8_0.gguf'), 'a'.repeat(32));
    await writeFile(path.join(root, 'community/plain/plain-Q8_0.gguf'), 'b'.repeat(32));
    return root;
  };
  // The real committed lineage document at HEAD authorizes exactly this tuple.
  const COMMITTED = {
    servingModel: 'gemma-4-31b',
    servingArtifactSha256: 'b2c838c7128f7b61858986333d4d8283104102b0cca13acdc2e6422e93292f67',
  };

  test('a model with a valid sidecar carries its serving identity into the catalog', async () => {
    const root = await seedWithEvidence();
    const model = path.join(root, 'neuma/authorized/authorized-Q8_0.gguf');
    await writeFile(`${model}.training.json`, JSON.stringify(COMMITTED));
    const catalog = listCatalog({ NEUMA_MODELS_DIRS: root });
    const authorized = catalog.find((m) => m.id === 'neuma/authorized/authorized-Q8_0');
    expect(authorized.servingModel).toBe('gemma-4-31b');
    expect(authorized.servingArtifactSha256).toBe(COMMITTED.servingArtifactSha256);
    const plain = catalog.find((m) => m.id === 'community/plain/plain-Q8_0');
    expect(plain.servingModel).toBeUndefined();
  });

  test('a malformed sidecar yields no identity, never a guess', async () => {
    const root = await seedWithEvidence();
    const model = path.join(root, 'neuma/authorized/authorized-Q8_0.gguf');
    await writeFile(`${model}.training.json`, '{not json');
    expect(lineageEvidenceFor(model)).toBeNull();
  });

  // (The lineage-based catalog marking retired 2026-08-28 — authorization is
  // the folder law now, proven in test/unit/model-folder-authority.test.js;
  // the lineage gate's own law stays pinned by its refinement-lane tests.)

  test('findCatalogModel resolves a serving identity, not just the catalog id', async () => {
    const root = await seedWithEvidence();
    const model = path.join(root, 'neuma/authorized/authorized-Q8_0.gguf');
    await writeFile(`${model}.training.json`, JSON.stringify(COMMITTED));
    expect(findCatalogModel({ NEUMA_MODELS_DIRS: root }, 'gemma-4-31b')?.id)
      .toBe('neuma/authorized/authorized-Q8_0');
  });
});
