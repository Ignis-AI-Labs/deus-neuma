// The forge's heartbeat — proven on the REAL exec boundary (RULE 0): a
// genuine child process streamed through runStep. The trainer's checkpoint
// load speaks for minutes ONLY in tqdm-style \r redraw frames on stderr;
// split on \n alone and the desk's terminal freezes on the last stdout line
// for the whole load (witnessed 2026-07-20, Hale's forge — […] standing still while 67GB loaded). \r is a line boundary, chunk
// boundaries buffer, dying words without a newline still land.
import { describe, test, expect } from 'vitest';
import { symlink, writeFile } from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  REFINEMENT_RESOURCE_LIMITS,
  refinementExecutionEnvelope,
} from '../../core/refinement/training-authority-contract.js';
import { runStep } from '../../backend/services/refinement-process-scope.js';
import {
  createRefinementProcessOperation,
  readRefinementJsonFile,
} from '../../backend/services/refinement-process-operation.js';
import { refinementChildEnvironment } from '../../backend/services/refinement-execution-authority.js';
import {
  pushTailLine,
  isRedrawFrame,
} from '../../backend/services/refinement-training-state.js';
const SHA256 = 'a'.repeat(64);
const EXECUTION_ENVELOPE = refinementExecutionEnvelope({
  wrapperExecutableSha256: SHA256,
  controllerExecutableSha256: SHA256,
  resourceLimiterExecutableSha256: SHA256,
  sandboxExecutableSha256: SHA256,
  authorityConsumerPythonSha256: SHA256,
  authorityConsumerScriptSha256: SHA256,
  hostRuntimeIdentitySha256: SHA256,
  runtimeAuthoritySha256: SHA256,
  runtimeManifestSha256: SHA256,
  toolAuthoritySha256: SHA256,
  toolManifestSha256: SHA256,
  resources: REFINEMENT_RESOURCE_LIMITS,
  trainingSeed: 7,
});

describe('runStep streaming (real subprocess)', () => {
  test('\\r frames, chunk-split lines, and unterminated last words all land', async () => {
    const dir = await createTempDir('refine-stream');
    const script = path.join(dir, 'trainer-standin.mjs');
    // stdout line; two stderr redraw frames ending in \r (no \n ever); a
    // stdout line split across two writes; a final line with NO terminator.
    await writeFile(script, [
      "process.stdout.write('corpus samples: 3' + String.fromCharCode(10));",
      "process.stderr.write('Loading shards:  10%|#' + String.fromCharCode(13));",
      "process.stderr.write('Loading shards:  60%|####' + String.fromCharCode(13));",
      "process.stdout.write('step 1/2 ');",
      "process.stdout.write('loss 2.500' + String.fromCharCode(10));",
      "process.stdout.write('SAVED /out/adapter');",
    ].join('\n'));

    const seen = [];
    await runStep(process.execPath, [script], (line) => seen.push(line));

    expect(seen).toContain('corpus samples: 3');
    expect(seen).toContain('Loading shards:  10%|#');   // \r alone ends a line
    expect(seen).toContain('Loading shards:  60%|####');
    expect(seen).toContain('step 1/2 loss 2.500');      // buffered across writes, never two half-lines
    expect(seen).toContain('SAVED /out/adapter');       // flushed at close without a newline
  }, 15000);

  test('a failing step streams stderr privately and returns only a stable public failure', async () => {
    const dir = await createTempDir('refine-stream-fail');
    const script = path.join(dir, 'dying-standin.mjs');
    await writeFile(script, [
      "process.stderr.write('CUDA out of memory' + String.fromCharCode(13));",
      'process.exit(3);',
    ].join('\n'));
    const seen = [];
    await expect(runStep(process.execPath, [script], (l) => seen.push(l)))
      .rejects.toMatchObject({ code: 'TRAINING_PROCESS_FAILED' });
    expect(seen).toContain('CUDA out of memory');
  }, 15000);

  test('output, wall-clock, and callback failures terminate the real child', async () => {
    await expect(runStep(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(4096))'],
      () => {},
      { maxOutputBytes: 1024 },
    )).rejects.toMatchObject({ code: 'TRAINING_OUTPUT_LIMIT' });
    await expect(runStep(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 5000)'],
      () => {},
      { timeoutMs: 30 },
    )).rejects.toMatchObject({ code: 'TRAINING_TIMEOUT' });
    await expect(runStep(
      process.execPath,
      ['-e', 'console.log("one line"); setTimeout(() => {}, 5000)'],
      () => { throw new Error('consumer refused line'); },
    )).rejects.toMatchObject({ code: 'TRAINING_PROCESS_FAILED' });
  }, 15000);

  test('the real child receives only the immutable execution-envelope environment', async () => {
    const seen = [];
    const env = refinementChildEnvironment(EXECUTION_ENVELOPE);
    await runStep(
      process.execPath,
      ['-e', 'console.log(process.env.DNA_ENCRYPTION_KEY || "absent")'],
      (line) => seen.push(line),
      { env },
    );
    expect(seen).toEqual(['absent']);
    expect(env.TMPDIR).toBe('/work');
    expect(env.PYTHONHASHSEED).toBe('7');
  });

  test('structured child facts require a bounded no-follow stable regular-file read', async () => {
    const dir = await createTempDir('refine-facts');
    const facts = path.join(dir, 'facts.json');
    const link = path.join(dir, 'facts-link.json');
    const operation = createRefinementProcessOperation({ timeoutMs: 10_000 });
    await writeFile(facts, '{"tokenBudget":7}', { mode: 0o600 });
    await symlink(facts, link);
    await expect(readRefinementJsonFile({
      filePath: facts, maximumBytes: 1024, operation,
    })).resolves.toEqual({ tokenBudget: 7 });
    await expect(readRefinementJsonFile({
      filePath: facts, maximumBytes: 4, operation,
    })).rejects.toThrow(/bounded regular file/);
    await expect(readRefinementJsonFile({
      filePath: link, maximumBytes: 1024, operation,
    })).rejects.toThrow();
  });
});

describe('pushTailLine (the bounded tail, pure)', () => {
  test('consecutive redraw frames of one bar replace each other', () => {
    const lines = ['corpus samples: 3'];
    pushTailLine(lines, 'Loading shards:  10%|#');
    pushTailLine(lines, 'Loading shards:  60%|####');
    pushTailLine(lines, 'Loading shards: 100%|########');
    expect(lines).toEqual(['corpus samples: 3', 'Loading shards: 100%|########']);
  });

  test('frames of DIFFERENT bars stack; plain lines always stack', () => {
    const lines = [];
    pushTailLine(lines, 'Loading shards:  50%|##');
    pushTailLine(lines, 'Map:  10%|#'); // a different bar — its own line
    pushTailLine(lines, 'step 1/9 loss 2.950');
    pushTailLine(lines, 'step 2/9 loss 2.881');
    expect(lines).toHaveLength(4);
  });

  test('the tail stays bounded', () => {
    const lines = [];
    for (let i = 0; i < 60; i += 1) pushTailLine(lines, `step ${i}/60 loss 2.0`, 40);
    expect(lines).toHaveLength(40);
    expect(lines[39]).toBe('step 59/60 loss 2.0');
  });

  test('isRedrawFrame recognizes tqdm bars and nothing else', () => {
    expect(isRedrawFrame('Loading checkpoint shards:  43%|███')).toBe(true);
    expect(isRedrawFrame('step 5/90 loss 2.7')).toBe(false);
    expect(isRedrawFrame('corpus samples: 90')).toBe(false);
  });
});
