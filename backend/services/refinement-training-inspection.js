import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertCorpusByteBudget,
  trainerFacts,
} from './refinement-trainer-facts.js';
import { stageVerifiedBootstrapHandle } from './refinement-immutable-staging-internal/file-set.js';
import {
  assertRefinementProcessOperation,
  readRefinementJsonFile,
} from './refinement-process-operation.js';
import { runRefinementInspectionStep } from './refinement-training-process-resource.js';

const INSPECTION_TIMEOUT_MS = 5 * 60 * 1000;
const INSPECTION_OUTPUT_BYTES = 64 * 1024;
const FACTS_BYTES_MAX = 64 * 1024;

const cleanupAll = async (items) => {
  const settled = await Promise.allSettled(items.map((close) => close()));
  return settled.filter(({ status }) => status === 'rejected').map(({ reason }) => reason);
};

/** Run tokenizer/model preflight through the same held CPU-only scope as production. Impure. */
export const inspectTrainingInputs = async ({
  executionAuthority,
  snapshotAuthority,
  renderedCorpus,
  config,
  targetModules,
  executionEnvelope,
  operation: suppliedOperation,
}) => {
  const corpus = renderedCorpus?.text;
  const budget = assertCorpusByteBudget(corpus, config?.budget?.sampleCount);
  if (renderedCorpus.bytes !== budget.totalBytes || renderedCorpus.sha256 == null) {
    throw new Error('rendered inspection corpus authority is invalid');
  }
  const operation = assertRefinementProcessOperation(suppliedOperation);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-refinement-inspect-'));
  let corpusAuthority = null;
  let result;
  let failure = null;
  try {
    const corpusBytes = Buffer.from(corpus, 'utf8');
    corpusAuthority = await stageVerifiedBootstrapHandle({
      content: corpusBytes,
      sha256: renderedCorpus.sha256,
      maximumBytes: budget.totalBytes,
      label: 'inspection corpus',
      mode: 0o400,
      operation,
    });
    await runRefinementInspectionStep({
      executionAuthority,
      executionEnvelope,
      snapshotAuthority,
      corpusAuthority,
      tempDir,
      operation,
      timeoutMs: INSPECTION_TIMEOUT_MS,
      maxOutputBytes: INSPECTION_OUTPUT_BYTES,
      config: Object.freeze({
        ...config,
        geometry: Object.freeze({
          ...config.geometry,
          targetPolicyId: 'exact-module-list-v1',
          targetModules,
        }),
      }),
    });
    result = trainerFacts(await readRefinementJsonFile({
      filePath: path.join(tempDir, 'facts.json'),
      maximumBytes: FACTS_BYTES_MAX,
      label: 'inspection facts',
      operation,
    }), {
      inspection: true,
      sampleCount: config.budget.sampleCount,
      minimumCompletionTokens: config.budget.minimumCompletionTokens,
      snapshotManifestSha256: snapshotAuthority.manifestSha256,
    });
  } catch (error) {
    failure = error;
  }
  const cleanupFailures = await cleanupAll([
    async () => corpusAuthority?.close(operation),
    async () => fs.rm(tempDir, { recursive: true, force: true }),
  ]);
  const failures = [...(failure ? [failure] : []), ...cleanupFailures];
  if (failures.length > 1) throw new AggregateError(failures, 'inspection and cleanup failed');
  if (failures.length === 1) throw failures[0];
  return result;
};
