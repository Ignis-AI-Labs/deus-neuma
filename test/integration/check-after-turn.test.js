/**
 * The check after a turn (RULE 0: real commands, a real git repository on
 * disk, real files).
 *
 * `turnWithCheck` is handed the turn as a function. Here that function is a
 * real one that really changes files in the ground, the way a being's hands
 * do — what a real model does with a failed check stays a live sitting's proof.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  CHECK_OUTPUT_TAIL_CHARS, parseCheckArg, workFingerprint, runCheck, checkFailedPrompt, turnWithCheck,
} from '../../cli/lib/check-after-turn.js';

let root;
let ground;

const git = (...args) => execFileSync('git', args, {
  cwd: ground,
  encoding: 'utf8',
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'Check Test', GIT_AUTHOR_EMAIL: 'check@test.invalid',
    GIT_COMMITTER_NAME: 'Check Test', GIT_COMMITTER_EMAIL: 'check@test.invalid',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  },
});

const GOOD = 'export const half = (n) => n / 2;\n';
const BAD = 'export const half = (n) => n / 3;\n';
// The operator's check: a real program that imports the real file and judges it.
const CHECK = 'node check.mjs';
const CHECK_SOURCE = [
  "import { half } from './math.js';",
  "if (half(8) !== 4) { console.error('FAIL half(8) gave ' + half(8)); process.exit(3); }",
  "console.log('ok');",
  '',
].join('\n');

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-check-'));
  ground = path.join(root, 'ground');
  await fs.mkdir(ground);
  git('init', '-q', '-b', 'main');
  await fs.writeFile(path.join(ground, 'math.js'), GOOD);
  await fs.writeFile(path.join(ground, 'check.mjs'), CHECK_SOURCE);
  await fs.writeFile(path.join(ground, 'package.json'), '{"type":"module"}\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const write = (name, content) => fs.writeFile(path.join(ground, name), content);

describe('parseCheckArg', () => {
  test('nothing shows it, off clears it, anything else is the command whole', () => {
    expect(parseCheckArg('')).toEqual({ kind: 'show' });
    expect(parseCheckArg('  off ')).toEqual({ kind: 'off' });
    expect(parseCheckArg(' npm run lint && npm test ')).toEqual({ kind: 'set', command: 'npm run lint && npm test' });
  });
});

describe('workFingerprint', () => {
  test('stands still when nothing changes, and moves on an edit, a new file and a delete', async () => {
    const clean = await workFingerprint(ground);
    expect(await workFingerprint(ground)).toBe(clean);

    await write('math.js', BAD);
    const edited = await workFingerprint(ground);
    expect(edited).not.toBe(clean);

    await write('fresh.js', 'export const one = 1;\n');
    const added = await workFingerprint(ground);
    expect(added).not.toBe(edited);

    await fs.rm(path.join(ground, 'check.mjs'));
    expect(await workFingerprint(ground)).not.toBe(added);
  });

  test('a second edit to a file that was already changed still moves it', async () => {
    await write('math.js', BAD);
    const first = await workFingerprint(ground);
    await write('math.js', 'export const half = (n) => n / 4;\n'); // same length, new content
    expect(await workFingerprint(ground)).not.toBe(first);
  });

  test('the platform\'s own undo records are not the being\'s work', async () => {
    const clean = await workFingerprint(ground);
    await fs.mkdir(path.join(ground, '.neuma', 'edit-undo'), { recursive: true });
    await write('.neuma/edit-undo/1.json', '{}');
    expect(await workFingerprint(ground)).toBe(clean);
  });

  test('seen from a subfolder it is the same repository', async () => {
    await fs.mkdir(path.join(ground, 'deep'));
    const before = await workFingerprint(path.join(ground, 'deep'));
    await write('math.js', BAD);
    expect(await workFingerprint(path.join(ground, 'deep'))).not.toBe(before);
  });

  test('outside a repository there is no fingerprint', async () => {
    expect(await workFingerprint(root)).toBeNull();
  });
});

describe('runCheck', () => {
  test('a passing command passes, with its output', async () => {
    const result = await runCheck(CHECK, ground);
    expect(result).toMatchObject({ passed: true, code: 0, timedOut: false });
    expect(result.output).toContain('ok');
  });

  test('a failing command carries its exit code and what it printed on either stream', async () => {
    await write('math.js', BAD);
    const result = await runCheck(CHECK, ground);
    expect(result).toMatchObject({ passed: false, code: 3, timedOut: false });
    expect(result.output).toContain('FAIL half(8) gave');
  });

  test('a shell line is a shell line: && chains and stops at the first failure', async () => {
    const result = await runCheck('node -e "process.exit(0)" && node -e "process.exit(7)" && node check.mjs', ground);
    expect(result).toMatchObject({ passed: false, code: 7 });
    expect(result.output).not.toContain('ok');
  });

  test('a command that does not exist fails and says so', async () => {
    const result = await runCheck('no-such-program-neuma-check', ground);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/not found|not recognized/i);
  });

  test('only the end of a long output is kept', async () => {
    const result = await runCheck('node -e "console.log(\'x\'.repeat(200000)); console.log(\'THE-END\'); process.exitCode = 1"', ground);
    expect(result.output.length).toBeLessThanOrEqual(CHECK_OUTPUT_TAIL_CHARS);
    expect(result.output.trimEnd().endsWith('THE-END')).toBe(true);
  });

  test('a check that never answers is stopped, and what it started is stopped with it', async () => {
    const marker = path.join(root, 'child.pid');
    // The shell starts node, which records its own pid and then sleeps for a minute.
    const command = `node -e "require('fs').writeFileSync('${marker}', String(process.pid)); setTimeout(() => {}, 60000)"`;
    const started = Date.now();
    const result = await runCheck(command, ground, { timeoutMs: 1500 });
    expect(result).toMatchObject({ passed: false, timedOut: true, code: null });
    expect(Date.now() - started).toBeLessThan(10_000);
    const pid = Number(await fs.readFile(marker, 'utf8'));
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    expect(() => process.kill(pid, 0)).toThrow(); // no such process: the tree went with the shell
  }, 20_000);
});

describe('checkFailedPrompt', () => {
  test('names the command, the exit code and the output, and forbids bending the test', () => {
    const prompt = checkFailedPrompt('npm test', { code: 1, timedOut: false, output: 'AssertionError: 3 !== 4\n' });
    expect(prompt).toContain('`npm test` exited 1');
    expect(prompt).toContain('AssertionError: 3 !== 4');
    expect(prompt).toContain('do not edit a test or a rule just to make it pass');
  });

  test('a check that was stopped is told as that, not as a failure code', () => {
    const prompt = checkFailedPrompt('npm test', { code: null, timedOut: true, output: '' });
    expect(prompt).toContain('CHECK DID NOT FINISH');
    expect(prompt).toContain('(the check printed nothing)');
  });
});

describe('turnWithCheck', () => {
  // A sitting whose turns really change the ground, one scripted act per turn.
  const sitting = (acts) => {
    const thoughts = [];
    const said = [];
    const runTurn = async (thought) => {
      thoughts.push(thought);
      await (acts[thoughts.length - 1] || (() => {}))();
    };
    return { thoughts, said, runTurn, say: (line) => said.push(line) };
  };

  test('with no check named it is just the turn', async () => {
    const s = sitting([() => write('math.js', BAD)]);
    const done = await turnWithCheck({ thought: 'break it', command: null, ground, ...s });
    expect(done).toEqual({ checks: 0, outcome: 'off' });
    expect(s.thoughts).toEqual(['break it']);
    expect(s.said).toEqual([]);
  });

  test('a turn that changes nothing runs no check', async () => {
    const s = sitting([]);
    const done = await turnWithCheck({ thought: 'what does half do?', command: `${CHECK} && node -e "require('fs').writeFileSync('ran', '1')"`, ground, ...s });
    expect(done).toEqual({ checks: 0, outcome: 'unchanged' });
    expect(s.said).toEqual([]);
    await expect(fs.stat(path.join(ground, 'ran'))).rejects.toThrow();
  });

  test('a change that passes the check is one check and one line of good news', async () => {
    const s = sitting([() => write('extra.js', 'export const one = 1;\n')]);
    const done = await turnWithCheck({ thought: 'add one', command: CHECK, ground, ...s });
    expect(done).toEqual({ checks: 1, outcome: 'passed' });
    expect(s.thoughts).toHaveLength(1);
    expect(s.said.at(-1)).toContain('check passed');
  });

  test('a change that breaks the check goes back to the being, which fixes it', async () => {
    const s = sitting([() => write('math.js', BAD), () => write('math.js', GOOD)]);
    const done = await turnWithCheck({ thought: 'make it faster', command: CHECK, ground, ...s });
    expect(done).toEqual({ checks: 2, outcome: 'passed' });
    expect(s.thoughts).toHaveLength(2);
    // The being's second turn is the real failure: the command, the code, the output.
    expect(s.thoughts[1]).toContain('`node check.mjs` exited 3');
    expect(s.thoughts[1]).toContain('FAIL half(8) gave 2.6666666666666665');
    expect(s.said.join('\n')).toMatch(/fix turn 1 of 3[\s\S]*check passed/);
    expect(await fs.readFile(path.join(ground, 'math.js'), 'utf8')).toBe(GOOD);
  });

  test('a being that keeps failing gets three fix turns and then it is the operator\'s', async () => {
    let n = 5;
    const worse = () => write('math.js', `export const half = (n) => n / ${n++};\n`);
    const s = sitting([worse, worse, worse, worse, worse, worse]);
    const done = await turnWithCheck({ thought: 'make it faster', command: CHECK, ground, ...s });
    expect(done).toEqual({ checks: 4, outcome: 'failing' });
    expect(s.thoughts).toHaveLength(4); // the turn, then three fix turns, and no fifth
    expect(s.said.at(-1)).toContain('still failing after 3 fix turn(s); over to you');
  });

  test('a fix turn that changes nothing ends it at once: the being has declined', async () => {
    const s = sitting([() => write('math.js', BAD), () => {}]);
    const done = await turnWithCheck({ thought: 'make it faster', command: CHECK, ground, ...s });
    expect(done).toEqual({ checks: 1, outcome: 'failing' });
    expect(s.thoughts).toHaveLength(2);
    expect(s.said.at(-1)).toContain('that turn changed nothing');
  });

  test('a turn the operator interrupted is not checked', async () => {
    const s = sitting([() => write('math.js', BAD)]);
    const done = await turnWithCheck({ thought: 'make it faster', command: CHECK, ground, ...s, interrupted: () => true });
    expect(done).toEqual({ checks: 0, outcome: 'interrupted' });
    expect(s.said).toEqual([]);
  });

  test('where there is no repository to compare, the check runs after every turn', async () => {
    await fs.writeFile(path.join(root, 'note.txt'), 'x');
    const s = sitting([]);
    const done = await turnWithCheck({ thought: 'hello', command: 'node -e "process.exit(0)"', ground: root, ...s });
    expect(done).toEqual({ checks: 1, outcome: 'passed' });
  });

  test('a check that rewrites files itself does not count as the being\'s next change', async () => {
    // The check "formats" a file each time it runs and fails; the fix turn changes nothing.
    const command = 'node -e "require(\'fs\').appendFileSync(\'formatted.txt\', \'x\'); process.exit(1)"';
    const s = sitting([() => write('extra.js', '1\n'), () => {}]);
    const done = await turnWithCheck({ thought: 'add', command, ground, ...s });
    expect(done).toEqual({ checks: 1, outcome: 'failing' });
    expect(s.said.at(-1)).toContain('that turn changed nothing');
  });
});
