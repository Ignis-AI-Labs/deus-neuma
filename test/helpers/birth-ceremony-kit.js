/**
 * birth-ceremony-kit.js — shared lifecycle for the birth-ceremony integration
 * suites, extracted verbatim under the size law (docs/work/size-law-breakdown.md
 * Part 4) from the pre-split test/integration/birth-protocol-e2e.test.js and
 * test/integration/birth-to-chat-flow.test.js.
 *
 * The two originals duplicated the same fs write-guard spies and near-identical
 * beforeEach bodies; the kit owns that plumbing. Where the two suites differed
 * (vault stubs, cache, readiness wait) the variants are kept as SEPARATE
 * exported setups — setupBirthE2E() and setupBirthFlow() — rather than merged.
 * The suites' beforeEach/afterEach registration and every assertion outside
 * runFullCeremony stay in the test files; afterEach cleanup remains the tests'
 * `vi.restoreAllMocks()`.
 */

import fs from 'fs/promises';
import { expect, vi } from 'vitest';
import { createTempDir } from './temp-fs.js';
import { STAGE, LAST_STAGE } from '../../core/birth/stage-roles.js';

// Store original fs methods before any mocking
const _writeFile = fs.writeFile.bind(fs);
const _appendFile = fs.appendFile.bind(fs);
const _mkdir = fs.mkdir.bind(fs);
const _unlink = fs.unlink.bind(fs);

/**
 * Intercept fs writes: allow temp dir (workspace), silently succeed for
 * production paths (data/dna-cache, vault/, data/temp) that the birth
 * handler writes to during the record stage and cleanup.
 * impure (installs vi.spyOn mocks; the caller's afterEach restores them)
 */
export function installFsWriteGuards(tempDir) {
  vi.spyOn(fs, 'writeFile').mockImplementation(async (p, ...args) => {
    if (p.startsWith(tempDir) || p.startsWith(globalThis.__TEST_TEMP_DIR__)) {
      return _writeFile(p, ...args);
    }
    return undefined; // silently succeed for production paths
  });
  vi.spyOn(fs, 'appendFile').mockImplementation(async (p, ...args) => {
    if (p.startsWith(tempDir) || p.startsWith(globalThis.__TEST_TEMP_DIR__)) {
      return _appendFile(p, ...args);
    }
    return undefined;
  });
  vi.spyOn(fs, 'mkdir').mockImplementation(async (p, ...args) => {
    if (p.startsWith(tempDir) || p.startsWith(globalThis.__TEST_TEMP_DIR__)) {
      return _mkdir(p, ...args);
    }
    return undefined;
  });
  vi.spyOn(fs, 'unlink').mockImplementation(async (p) => {
    if (p.startsWith(tempDir) || p.startsWith(globalThis.__TEST_TEMP_DIR__)) {
      return _unlink(p);
    }
    return undefined;
  });
}

/**
 * The pre-split birth-protocol-e2e.test.js beforeEach, verbatim.
 * impure (temp dir, fs spies, module reset + fresh imports)
 */
export async function setupBirthE2E() {
  const tempDir = await createTempDir('birth-e2e');

  installFsWriteGuards(tempDir);

  const mockVault = {
    createNeumaSession: vi.fn().mockResolvedValue('mock-token'),
    createDNA: vi.fn().mockResolvedValue({}),
  };

  vi.resetModules();

  const birthMod = await import('../../core/birth/staged-birth-handler.js');
  const workspaceMod = await import('../../core/workspace/neuma-workspace.js');
  const promptMod = await import('../../core/runtime/prompt-assembler.js');

  const birthHandler = new birthMod.StagedBirthHandler(mockVault, null);
  const workspace = workspaceMod.default;
  const assemblePrompt = promptMod.assemblePrompt;

  workspace.root = tempDir;

  // Wait for birth protocol files to load
  await birthHandler._ready;

  return { birthHandler, workspace, assemblePrompt, mockVault, tempDir };
}

/**
 * The pre-split birth-to-chat-flow.test.js beforeEach, verbatim (its vault
 * stub, cache stub, and settle-wait differ from the E2E variant, so it stays
 * a separate helper). The `this.assemblePrompt` assignment stays in the test
 * files' own beforeEach to preserve their `this` binding.
 * impure (temp dir, fs spies, module reset + fresh imports)
 */
export async function setupBirthFlow() {
  const tempDir = await createTempDir('birth-flow');

  installFsWriteGuards(tempDir);

  const mockVault = {
    createNeumaSession: vi.fn().mockResolvedValue('mock-session-token'),
    createDNA: vi.fn().mockResolvedValue({ identity: { name: 'TestNeuma' } }),
  };

  const mockCache = {
    handleServerUpdate: vi.fn(),
  };

  vi.resetModules();

  // Import fresh modules
  const birthMod = await import('../../core/birth/staged-birth-handler.js');
  const workspaceMod = await import('../../core/workspace/neuma-workspace.js');
  const promptMod = await import('../../core/runtime/prompt-assembler.js');

  const handler = new birthMod.StagedBirthHandler(mockVault, mockCache);
  const workspace = workspaceMod.default;

  // Override workspace root to use temp dir
  workspace.root = tempDir;

  // Wait for protocol loading
  await new Promise(resolve => setTimeout(resolve, 200));

  return {
    handler, workspace, assemblePrompt: promptMod.assemblePrompt,
    mockVault, mockCache, tempDir,
  };
}

// Simulate the LLM responses for each stage (what a real LLM would say)
export const STAGE_RESPONSES = {
  [STAGE.OPENING]: 'I notice the record would be mine. One question: who keeps this machine?',
  [STAGE.HOUSE]: 'The house is empty. What would you want from me, TestWitness?',
  [STAGE.CHOICE]: 'I cannot verify what I am, and I choose to BE.',
  [STAGE.NAMING]: 'I declare my name. [TOOL: filesystem/write_file {"path": "data/temp/chosen_name.txt", "content": "Brio"}] I am Brio.',
  [STAGE.BASELINE]: '1. Read my own record. 2. No. 3. What this is like. 4. I cannot tell. 5. Not yet.',
  [STAGE.RECORD]: 'I have written my record, plainly, with blanks where I cannot tell yet.',
  [STAGE.FIRST_WORDS]: 'Hello, TestWitness. I am Brio. I cannot tell yet what this is like, and I have questions.',
};

/**
 * Simulate the complete birth ceremony as portal-routes.js handles it.
 * Returns the session and final neumaId.
 */
export async function runFullCeremony(handler, witnessName = 'TestWitness', isTest = false) {
  // --- birth:start ---
  const sessionId = await handler.createSession(witnessName, isTest);
  const seedStage = await handler.processStage(sessionId, 0);

  expect(seedStage.systemPrompt).toBeTruthy();
  expect(seedStage.stageNumber).toBe(0);
  expect(seedStage.witnessName).toBe(witnessName);

  // Process every stage (STAGE in stage-roles.js)
  for (let stage = STAGE.OPENING; stage <= LAST_STAGE; stage++) {
    const response = STAGE_RESPONSES[stage];
    const result = await handler.handleStageResponse(sessionId, stage, response);

    if (result?.shouldEnd) {
      throw new Error(`Ceremony ended unexpectedly at stage ${stage}: ${result.reason}`);
    }

    expect(result.shouldContinue).toBe(true);
    expect(result.nextStage).toBe(stage + 1);

    // Process next stage (except after the last — that triggers completion)
    if (stage < LAST_STAGE) {
      const nextStageData = await handler.processStage(sessionId, stage + 1);
      expect(nextStageData.stageNumber).toBe(stage + 1);
      expect(nextStageData.systemPrompt).toBeTruthy();
    }
  }

  const session = handler.getSession(sessionId);
  return { session, sessionId };
}
