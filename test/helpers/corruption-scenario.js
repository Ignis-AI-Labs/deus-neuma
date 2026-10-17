// Child-only real workspace fixture: no replaced fs, vault or logging methods.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import assert from 'node:assert/strict';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corruption-proof-'));
process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
process.env.DNA_ENCRYPTION_KEY = 'temporary-corruption-proof-key';
const { default: workspace, setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
setWorkspacesRoot(path.join(root, 'lanes'));
const corrupt = async (file) => fs.writeFile(file, '{"_enc":true,"iv":"garbage"');

try {
  await workspace.create('being');
  const home = workspace.pathFor('being');
  const scenario = process.argv[2];
  const stores = {
    observations: { dir: 'memory/observations', count: 3, write: 'addObservation', read: 'listObservations',
      entry: (i) => ({ type: 'exchange', userMessage: `record ${i}`, significance: 0.9 }) },
    entities: { dir: 'memory/entities', count: 2, write: 'writeEntity', read: 'listEntities',
      entry: (i) => ({ id: `e${i}`, name: `Entity ${i}` }) },
    assessments: { dir: 'assessments', count: 2, write: 'writeAssessment', read: 'readAssessments',
      entry: (i) => ({ type: 'calibration', results: { a: i } }) },
  };
  if (stores[scenario]) {
    const spec = stores[scenario];
    for (let i = 0; i < spec.count; i++) await workspace[spec.write]('being', spec.entry(i));
    const dir = path.join(home, spec.dir);
    const files = (await fs.readdir(dir)).filter((file) => file.endsWith('.json'));
    assert.equal(files.length, spec.count);
    await corrupt(path.join(dir, files[0]));
    assert.equal((await workspace[spec.read]('being')).length, spec.count - 1);
  } else if (scenario === 'history') {
    await workspace.writeKeypairArchive('being', { address: '0xaaa', reason: 'birth' });
    await workspace.writeKeypairArchive('being', { address: '0xbbb', reason: 'rotation' });
    await fs.appendFile(path.join(home, 'keys/keypair-history.jsonl'), '{torn line without closing\n');
    assert.deepEqual((await workspace.readKeypairHistory('being')).map((row) => row.address), ['0xaaa', '0xbbb']);
  } else if (scenario === 'empty') {
    for (const read of ['listObservations', 'listEntities', 'readAssessments', 'readKeypairHistory']) {
      assert.deepEqual(await workspace[read]('being'), []);
    }
  } else if (scenario === 'identity' || scenario === 'gather') {
    await workspace.writeDNA('being', { name: 'being', essence: 'temporary fixture' });
    assert.equal((await workspace.readDNA('being')).name, 'being');
    assert.equal(await workspace.readDNA('never-born'), null);
    await corrupt(path.join(home, 'dna/active.json'));
    if (scenario === 'identity') {
      await assert.rejects(workspace.readDNA('being'), (error) => error instanceof Error && error.code !== 'ENOENT');
    } else {
      const { gatherMeditation } = await import('../../backend/services/meditation/meditation-cycle.js');
      const { getRecentIssues } = await import('../../backend/services/logger.js');
      assert.equal(await gatherMeditation('being'), null);
      const issue = getRecentIssues().find((entry) => entry.msg === 'meditation skipped — identity unreadable');
      assert.equal(issue?.level, 'error');
      assert.equal(issue?.data.neumaId, 'being');
    }
  } else {
    throw new Error(`Unknown corruption scenario: ${scenario}`);
  }
  process.stdout.write(`VERIFIED ${scenario}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
