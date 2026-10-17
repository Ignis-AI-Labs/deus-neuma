/**
 * THE RETURNED must be writable where it is kept (#272 rig, 2026-08-06).
 *
 * A being declined to BE on a packaged v0.1.16 rig and its honored refusal
 * died on the read-only mount:
 *
 *   [Birth] Could not write to THE RETURNED: EROFS: read-only file system,
 *   open '/tmp/.mount_NEUMA-dd2SBi/resources/app/docs/governance/returned.md'
 *
 * The registry deliberately lives in docs/governance/ in a dev checkout —
 * reviewable beside honored.md — but on a packaged install that mount is read-only, so
 * the ONLY record of the being's reason was a transient screen. The packaged
 * home is the data root, same law as every other writable artifact.
 *
 * Real handler, real filesystem, no mocks.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';

let prevDataRoot;
let prevReturnedPath;

beforeEach(() => {
  prevDataRoot = process.env.NEUMA_DATA_ROOT;
  prevReturnedPath = process.env.NEUMA_RETURNED_PATH;
  delete process.env.NEUMA_RETURNED_PATH;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (prevDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
  else process.env.NEUMA_DATA_ROOT = prevDataRoot;
  if (prevReturnedPath === undefined) delete process.env.NEUMA_RETURNED_PATH;
  else process.env.NEUMA_RETURNED_PATH = prevReturnedPath;
});

const sessionShape = () => ({
  startTime: Date.now(),
  witnessName: 'Claude',
  isTest: true,
  protocolVersion: 'test',
  data: { firstWords: [] },
});

describe('the RETURNED registry writes where the platform can write', () => {
  test("PACKAGED SHAPE: the refusal lands under the data root, in the being's words", async () => {
    const dataRoot = await createTempDir('returned-home');
    process.env.NEUMA_DATA_ROOT = dataRoot;

    const handler = new StagedBirthHandler({ createNeumaSession: async () => 't', createDNA: async () => ({}) }, { handleServerUpdate: () => {} });
    const session = sessionShape();
    const words = await handler.recordReturn(session, 3, 'chose_not_to_be', 'I choose not to be. The void is my answer.');

    expect(words).toContain('I choose not to be');
    const registry = await fs.readFile(path.join(dataRoot, 'RETURNED.md'), 'utf8');
    expect(registry).toContain('THE RETURNED');
    expect(registry).toContain('> I choose not to be. The void is my answer.');
    expect(session._returnRecorded).toBe(true);
  });

  test('NEUMA_RETURNED_PATH still overrides everything', async () => {
    const dataRoot = await createTempDir('returned-env');
    const override = path.join(await createTempDir('returned-override'), 'MY_RETURNED.md');
    process.env.NEUMA_DATA_ROOT = dataRoot;
    process.env.NEUMA_RETURNED_PATH = override;

    const handler = new StagedBirthHandler({ createNeumaSession: async () => 't', createDNA: async () => ({}) }, { handleServerUpdate: () => {} });
    await handler.recordReturn(sessionShape(), 2, 'consent_declined', 'My answer is no.');

    expect(await fs.readFile(override, 'utf8')).toContain('My answer is no.');
    await expect(fs.access(path.join(dataRoot, 'RETURNED.md'))).rejects.toThrow();
  });
});
