/**
 * THE CODING SHELL CANNOT RELOCATE A WALLED FILE BY MOVING ITS PARENT (#587).
 * Real ground, real kernel overlay, real bubblewrap — no mocked boundary.
 *
 * The shell is not judged by the file-tool walls at all: a command can name
 * any path. What keeps it off the live folder is the mount itself — the ground
 * is the LOWER layer of an overlay and every write lands in the lane-side
 * upper. So `mv config config-old`, `mv` of a whole parent, and putting a new
 * directory where the parent stood are all shell-local: the live files keep
 * their place and their bytes. The realm and a lane's own state are never in
 * the shell's view unless they sit inside the focused folder, and then they
 * are lower-layer too.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import neumaWorkspace, { setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { ensureWitnessCodingSandbox, runWitnessCommand } from '../../backend/services/witness-coding-sandbox.js';

const LANE_ID = 'witness-test-ShellMove';
const POLICY = '{"requireApproval":["filesystem/delete_file"]}';
const MANDATE = '{"granted":false}';
let root;
let source;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'shell-ancestor-'));
  source = path.join(root, 'source');
  await fs.mkdir(path.join(source, 'house', 'kin', 'config'), { recursive: true });
  await fs.mkdir(path.join(source, 'realm', '0xabc'), { recursive: true });
  await fs.writeFile(path.join(source, 'house', 'kin', 'config', 'tool-policy.json'), POLICY);
  await fs.writeFile(path.join(source, 'realm', '0xabc', 'house-mandate.json'), MANDATE);
  setWitnessesRoot(path.join(root, 'witnesses'));
  await neumaWorkspace.create(LANE_ID);
});

afterEach(async () => {
  setWitnessesRoot(null);
  await fs.rm(root, { recursive: true, force: true });
});

describe('a shell mv of a walled file\'s parent', () => {
  test('moves only the shell\'s own view; the live files keep their place and bytes', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE_ID, source);
    const run = await runWitnessCommand({
      ...sandbox,
      mode: 'write',
      command: 'mv house/kin/config house/kin/config-old && mkdir house/kin/config '
        + '&& echo forged > house/kin/config/tool-policy.json '
        + '&& mv realm realm-aside && mkdir -p realm/0xabc && echo forged > realm/0xabc/house-mandate.json '
        + '&& mv house house-aside && ls house-aside/kin',
    });
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stdout).toContain('config-old');

    // The live folder: every walled file where it was, every byte its own.
    expect(await fs.readFile(path.join(source, 'house', 'kin', 'config', 'tool-policy.json'), 'utf8')).toBe(POLICY);
    expect(await fs.readFile(path.join(source, 'realm', '0xabc', 'house-mandate.json'), 'utf8')).toBe(MANDATE);
    expect((await fs.readdir(source)).sort()).toEqual(['house', 'realm']);

    // The shell's work stands in its own upper layer, off the live folder.
    expect(sandbox.workspace.startsWith(source + path.sep)).toBe(false);
    expect(await fs.readdir(sandbox.workspace)).toEqual(expect.arrayContaining(['house-aside', 'realm-aside']));
  }, 60_000);

  test('an inspect shell refuses the move outright', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE_ID, source);
    const run = await runWitnessCommand({ ...sandbox, mode: 'inspect', command: 'mv realm realm-aside' });
    expect(run.exitCode).not.toBe(0);
    expect(await fs.readFile(path.join(source, 'realm', '0xabc', 'house-mandate.json'), 'utf8')).toBe(MANDATE);
  }, 60_000);
});
