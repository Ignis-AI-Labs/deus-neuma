import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  REFINEMENT_RESOURCE_LIMITS,
} from '../../core/refinement/training-authority-contract.js';
import {
  refinementSha256,
} from '../../core/refinement/training-contract.js';
import {
  createRefinementProcessOperation,
} from '../../backend/services/refinement-process-operation.js';

const MODEL_ID = 'google/gemma-3-4b-it';
const REVISION = 'a'.repeat(40);
const NODE_LIMIT = REFINEMENT_RESOURCE_LIMITS.maxSnapshotFiles * 2 + 64;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const utf8Compare = (left, right) =>
  Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));

let root;
let modelRoot;
let snapshotRoot;
let previousHfHome;
let previousDataRoot;
let openTargetTrainingSnapshotFileSet;

const safetensors = () => {
  const header = Buffer.from(JSON.stringify({
    'model.layers.0.self_attn.q_proj.weight': {
      dtype: 'F32',
      shape: [1],
      data_offsets: [0, 4],
    },
  }));
  const padded = Buffer.concat([
    header,
    Buffer.alloc((8 - (header.length % 8)) % 8, 0x20),
  ]);
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64LE(BigInt(padded.length));
  return Buffer.concat([prefix, padded, Buffer.alloc(4)]);
};

const fileEntries = (files) => Object.entries(files)
  .map(([relativePath, bytes]) => Object.freeze({
    relativePath,
    sha256: digest(bytes),
    bytes: bytes.length,
  }))
  .sort((left, right) => utf8Compare(left.relativePath, right.relativePath));

const requestFor = (files) => {
  const entries = fileEntries(files);
  return Object.freeze({
    modelId: MODEL_ID,
    revision: REVISION,
    baseArtifactSha256: refinementSha256({
      modelId: MODEL_ID,
      revision: REVISION,
      files: entries,
    }),
    tokenizerSha256: refinementSha256({
      modelId: MODEL_ID,
      revision: REVISION,
      files: entries.filter(({ relativePath }) => relativePath === 'tokenizer.json'),
    }),
  });
};

const writeBlobLink = async (relativePath, blobName, bytes) => {
  const blobPath = path.join(modelRoot, 'blobs', blobName);
  const logicalPath = path.join(snapshotRoot, relativePath);
  await Promise.all([
    fs.mkdir(path.dirname(blobPath), { recursive: true }),
    fs.mkdir(path.dirname(logicalPath), { recursive: true }),
  ]);
  await fs.writeFile(blobPath, bytes);
  await fs.symlink(`../../blobs/${blobName}`, logicalPath);
};

const standardSnapshot = async () => {
  const files = Object.freeze({
    'config.json': Buffer.from('{}'),
    'model.safetensors': safetensors(),
    'tokenizer.json': Buffer.from('{}'),
  });
  await Promise.all(Object.entries(files).map(
    ([relativePath, bytes], index) =>
      writeBlobLink(relativePath, `blob-${index}`, bytes),
  ));
  return files;
};

const openSnapshot = (request) => {
  const operation = createRefinementProcessOperation({ timeoutMs: 30_000 });
  return openTargetTrainingSnapshotFileSet(request, operation)
    .then((acquisition) => ({ acquisition, operation }));
};

beforeAll(async () => {
  previousHfHome = process.env.HF_HOME;
  previousDataRoot = process.env.NEUMA_DATA_ROOT;
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'refinement-target-snapshot-'));
  process.env.HF_HOME = root;
  // Staging pins its parent directory and refuses ANY change to it, so a data
  // root shared with another worker (or the operator's own tree) is not just
  // untidy — a concurrent stager's mkdir trips the tamper guard. Own it here.
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  await fs.mkdir(process.env.NEUMA_DATA_ROOT, { recursive: true });
  ({ openTargetTrainingSnapshotFileSet } = await import(
    '../../backend/services/refinement-training-snapshot-cache.js'
  ));
});

beforeEach(async () => {
  modelRoot = path.join(root, 'hub', 'models--google--gemma-3-4b-it');
  snapshotRoot = path.join(modelRoot, 'snapshots', REVISION);
  await fs.rm(modelRoot, { recursive: true, force: true });
  await fs.mkdir(snapshotRoot, { recursive: true });
});

afterAll(async () => {
  if (previousHfHome === undefined) delete process.env.HF_HOME;
  else process.env.HF_HOME = previousHfHome;
  if (previousDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
  else process.env.NEUMA_DATA_ROOT = previousDataRoot;
  await fs.rm(root, { recursive: true, force: true });
});

describe.sequential('target training snapshot cache authority', () => {
  it('materializes standard Hugging Face blob symlinks under logical names', async () => {
    const files = await standardSnapshot();
    const { acquisition, operation } = await openSnapshot(requestFor(files));
    expect(acquisition.ok).toBe(true);
    const fileSet = acquisition.authority.fileSet;
    try {
      await fileSet.verify(operation);
      expect(fileSet.files.map(({ relativePath }) => relativePath)).toEqual([
        'config.json',
        'model.safetensors',
        'tokenizer.json',
      ]);
      for (const authority of fileSet.files) {
        const expected = files[authority.relativePath];
        const observed = Buffer.alloc(authority.bytes);
        const { bytesRead } = await authority.handle.read(
          observed,
          0,
          observed.length,
          0,
        );
        expect(bytesRead).toBe(observed.length);
        expect(observed).toEqual(expected);
        await authority.verify(operation);
      }
    } finally {
      await fileSet.close();
    }
  });

  it('rejects a parent-directory symlink escape from the model blob tree', async () => {
    const outside = path.join(root, 'outside.safetensors');
    await fs.writeFile(outside, safetensors());
    await Promise.all([
      fs.writeFile(path.join(snapshotRoot, 'config.json'), '{}'),
      fs.writeFile(path.join(snapshotRoot, 'tokenizer.json'), '{}'),
      fs.symlink('../../../../outside.safetensors',
        path.join(snapshotRoot, 'model.safetensors')),
    ]);
    await expect(openSnapshot(Object.freeze({
      modelId: MODEL_ID,
      revision: REVISION,
      baseArtifactSha256: '1'.repeat(64),
      tokenizerSha256: '2'.repeat(64),
    }))).rejects.toThrow(/escapes its model blob tree/);
  });

  it('rejects a non-regular snapshot entry', async () => {
    const socketPath = path.join(snapshotRoot, 'model.safetensors');
    await Promise.all([
      fs.writeFile(path.join(snapshotRoot, 'config.json'), '{}'),
      fs.writeFile(path.join(snapshotRoot, 'tokenizer.json'), '{}'),
    ]);
    // bind(2) caps the socket path at sun_path (107 bytes) and this HF cache
    // layout alone spends 103, so no temp root can fit. Bind short and rename
    // the inode into place — the snapshot entry really is a live socket.
    const boundDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sock-'));
    const bound = path.join(boundDir, 's');
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(bound, resolve);
    });
    await fs.rename(bound, socketPath);
    try {
      await expect(openSnapshot(Object.freeze({
        modelId: MODEL_ID,
        revision: REVISION,
        baseArtifactSha256: '1'.repeat(64),
        tokenizerSha256: '2'.repeat(64),
      }))).rejects.toThrow(/non-file entry/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(boundDir, { recursive: true, force: true });
    }
  });

  it('refuses traversal deeper than the pre-hash depth bound', async () => {
    let directory = snapshotRoot;
    for (let depth = 0; depth <= 32; depth += 1) {
      directory = path.join(directory, `d${depth}`);
      await fs.mkdir(directory);
    }
    await expect(openSnapshot(Object.freeze({
      modelId: MODEL_ID,
      revision: REVISION,
      baseArtifactSha256: '1'.repeat(64),
      tokenizerSha256: '2'.repeat(64),
    }))).rejects.toThrow(/depth limit/);
  });

  it('refuses traversal beyond the pre-hash node bound', async () => {
    await Promise.all(Array.from({ length: NODE_LIMIT + 1 }, (_, index) =>
      fs.mkdir(path.join(snapshotRoot, `node-${index}`))));
    await expect(openSnapshot(Object.freeze({
      modelId: MODEL_ID,
      revision: REVISION,
      baseArtifactSha256: '1'.repeat(64),
      tokenizerSha256: '2'.repeat(64),
    }))).rejects.toThrow(/node limit/);
  });

  it('refuses aggregate bytes before hashing an oversized sparse snapshot', async () => {
    const weightsPath = path.join(snapshotRoot, 'model.safetensors');
    await Promise.all([
      fs.writeFile(path.join(snapshotRoot, 'config.json'), '{}'),
      fs.writeFile(path.join(snapshotRoot, 'tokenizer.json'), '{}'),
      fs.writeFile(weightsPath, ''),
    ]);
    await fs.truncate(weightsPath, REFINEMENT_RESOURCE_LIMITS.trainingSnapshotMaxBytes);
    await expect(openSnapshot(Object.freeze({
      modelId: MODEL_ID,
      revision: REVISION,
      baseArtifactSha256: '1'.repeat(64),
      tokenizerSha256: '2'.repeat(64),
    }))).rejects.toThrow(/aggregate bytes.*byte ceiling/);
  });
});
