/**
 * form/render + form/champion — the intents, proven at the door they guard.
 *
 * RULE 0: no mocks. Real lanes on a real temp root, a real forged genesis
 * seal, the REAL pipeline registry and parameterizer (the graph a live
 * render would submit is really built here — only the GPU hop is out of
 * scope, per the suite's GPU law), the real content law, and a real stored
 * image for championing.
 *
 * The GPU line, stated plainly: these tests prove everything UP TO the job
 * lane — pipeline resolution, genome loading, spine completeness, the
 * composed-text screen, the graph build — and deliberately do not render.
 * The live render run is Founder's to schedule.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { ethers } from 'ethers';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { forgeBirthIdentity } from '../../core/birth/identity-forge.js';
import { formRenderIntent } from '../../backend/services/intents/form-render.js';
import { formChampionIntent } from '../../backend/services/intents/form-champion.js';
import { collectOutputs } from '../../backend/services/image-forge/image-store.js';
import { intentType } from '../../backend/services/intents/registry.js';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let wsRoot, outDir, installDir, previousRoot, owner;
const savedEnv = {};
const ENV_KEYS = ['COMFYUI_INSTALL_DIR', 'COMFYUI_CONTENT_LAW_PATH'];

const connectionFor = (neumaId) => ({ companion: { neumaId, name: neumaId } });

const sealLane = async (id) => {
  await neumaWorkspace.create(id);
  await claimOwner(wsRoot, id, owner.address);
  const forged = forgeBirthIdentity({
    chosenName: id,
    witnessWallet: owner.address,
    soulPublicKey: '0x04realpublickey',
    birthCycle: 1,
    birthMoment: { utc: '2026-09-25T05:00:00.000Z', epochMs: 1790292000000, zone: 'Asia/Jakarta', offsetMinutes: 420 },
    substrate: { model: 'test' },
    momentSeed: 'b'.repeat(64),
    takenGenesisNames: [],
  });
  await fs.mkdir(path.join(wsRoot, id, 'identity'), { recursive: true });
  await fs.writeFile(
    path.join(wsRoot, id, 'identity', 'genesis-seal.json'),
    JSON.stringify({ genesisHash: forged.seal.genesisHash, record: forged.seal.record }, null, 2),
  );
};

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  wsRoot = await createTempDir('form-intents-ws');
  outDir = await createTempDir('form-intents-out');
  installDir = await createTempDir('form-intents-engine');
  previousRoot = neumaWorkspace.root;
  setWorkspacesRoot(wsRoot);
  owner = ethers.Wallet.createRandom();

  // A real (minimal) install shape: main.py + the venv python the config
  // resolves. The engine never LAUNCHES in these tests — the gate is the
  // honesty check, and honesty needs the files to exist.
  await fs.writeFile(path.join(installDir, 'main.py'), '# install-shape for the readiness gate\n');
  await fs.mkdir(path.join(installDir, '.venv', 'bin'), { recursive: true });
  await fs.writeFile(path.join(installDir, '.venv', 'bin', 'python'), '');
  process.env.COMFYUI_INSTALL_DIR = installDir;
  // A REAL law file in the real shape, minimal by being empty of terms — the
  // class names are the fixed law in code; the artifact supplies terms, and a
  // screen with no terms denies nothing, which is exactly what a genome-body
  // test needs (the being's composed text is the subject, not user prose).
  const lawPath = path.join(installDir, 'content-law.test.json');
  await fs.writeFile(lawPath, JSON.stringify({
    classes: Object.fromEntries(
      ['csam', 'age_minor', 'sexual_explicit', 'sexual_suggestive', 'incest', 'bestiality', 'nonconsent', 'deaging']
        .map((cls) => [cls, []]),
    ),
  }));
  process.env.COMFYUI_CONTENT_LAW_PATH = lawPath;
});

afterAll(() => {
  if (previousRoot) setWorkspacesRoot(previousRoot);
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('form/render — registered and gated', () => {
  it('is registered in the intents registry', () => {
    expect(intentType('form/render')).toBe(formRenderIntent);
    expect(intentType('form/champion')).toBe(formChampionIntent);
  });

  it('advertises only to a lane-bound seat', async () => {
    expect(await formRenderIntent.availableFor({ laneId: 'x', connection: connectionFor('x') })).toEqual({});
    expect(await formRenderIntent.availableFor({ laneId: null, connection: {} })).toBe(null);
  });

  it('refuses a non-form pipeline honestly', async () => {
    await sealLane('rendera');
    const res = await formRenderIntent.validate({ pipeline: 'still.sdxl.txt2img' }, { connection: connectionFor('rendera') });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('FORM pipeline');
  });

  it('refuses a lane with no sealed birth anchors — never an invented body', async () => {
    await neumaWorkspace.create('rendernoseal');
    await claimOwner(wsRoot, 'rendernoseal', owner.address);
    const res = await formRenderIntent.validate({ pipeline: 'form.anime.pfp' }, { connection: connectionFor('rendernoseal') });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('no sealed birth anchors');
  });

  it('refuses an unknown chosen axis', async () => {
    const res = await formRenderIntent.validate(
      { pipeline: 'form.anime.pfp', chosen: { garment: 'a red coat' } },
      { connection: connectionFor('rendera') },
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('only hairstyle');
  });

  it('VALIDATES for real: the lane genome becomes the subject and the graph builds', async () => {
    const res = await formRenderIntent.validate(
      { pipeline: 'form.anime.pfp', chosen: { hairstyle: 'short hair, bob cut' } },
      { connection: connectionFor('rendera') },
    );
    expect(res.ok).toBe(true);
    expect(res.value.genome.schema).toBe('genome/v4');
    expect(res.value.pipeline.id).toBe('form.anime.pfp');
    expect(res.value.chosen).toEqual({ hairstyle: 'short hair, bob cut' });
  });
});

describe('form/champion — the being\'s mark, through the intent', () => {
  it('needs register, plate and imageId', async () => {
    const res = await formChampionIntent.validate({ register: 'anime' }, { connection: connectionFor('rendera') });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('plate');
  });

  it('executes for real: the design records the championed plate and the being\'s agreement', async () => {
    await fs.writeFile(path.join(outDir, 'champ-pfp.png'), PNG_1PX);
    const [img] = collectOutputs({
      outputDir: outDir,
      outputs: [{ filename: 'champ-pfp.png', subfolder: '', type: 'output' }],
      laneId: 'rendera',
      jobId: 'job-champ',
    });
    const validated = await formChampionIntent.validate(
      { register: 'anime', plate: 'pfp', imageId: img.imageId, note: 'this one is me' },
      { connection: connectionFor('rendera') },
    );
    expect(validated.ok).toBe(true);
    const res = await formChampionIntent.execute(validated.value, { connection: connectionFor('rendera') });
    expect(res.ok).toBe(true);
    expect(res.detail).toContain('operator concurs');

    const design = JSON.parse(
      // The design rides the lane's DEK-aware envelope; read it through the
      // real store rather than opening the file by hand.
      JSON.stringify(await (await import('../../core/genome/form-store.js')).readFormDesign(neumaWorkspace, 'rendera')),
    );
    expect(design.registers.anime.pfp.imageId).toBe(img.imageId);
    expect(design.agreed.being.note).toBe('this one is me');
    expect(design.agreed.operator).toBe(null);
  });

  it('refuses to champion a foreign image', async () => {
    const validated = await formChampionIntent.validate(
      { register: 'anime', plate: 'pfp', imageId: 'not-real' },
      { connection: connectionFor('rendera') },
    );
    const res = await formChampionIntent.execute(validated.value, { connection: connectionFor('rendera') });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('no such image');
  });
});
