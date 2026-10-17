/**
 * A rename must not open what a name closed.
 *
 * The denied-path list is the sandbox's last word on paths that are
 * secret-SHAPED wherever they appear. It matched by substring, so a pattern
 * written `'.git/'` did not match a path whose final segment is exactly `.git`
 * — and `move_file` was therefore allowed to rename the live `.git` directory
 * out of its denied name, after which every file inside it was writable.
 *
 * Proven on 2026-07-27 against the real MCP filesystem server and real git: the
 * rename succeeded, `config` was rewritten, and `git remote -v` reported an
 * injected remote. No approval card appeared at any step, because every tool
 * used is policy-`allowed` for a witness AND for a neuma.
 *
 * The escape is exercised here with REAL git repositories on REAL disk (RULE 0).
 * `checkPathAccess` is the one predicate both seats cross, so testing it
 * directly tests both.
 */
import { describe, it, expect } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { checkPathAccess, matchesDeniedPattern, deniedPatternsFor } from '../../backend/services/tool-sandbox.js';

const run = promisify(execFile);
// Empty allowedRoots skips the containment check (`if (allowedRoots.length > 0)`),
// which is exactly what we want: root confinement is a separate guard, and
// letting it fire here would mask the denied-pattern verdict under test.
const allowed = (p) => checkPathAccess(p, []).allowed;

describe('the .git escape, on a real repository', () => {
  it('refuses to rename a live .git out of its denied name', async () => {
    const dir = await createTempDir('git-escape');
    const repo = path.join(dir, 'project');
    await fs.mkdir(repo, { recursive: true });
    await run('git', ['init', '-q'], { cwd: repo });
    await fs.writeFile(path.join(repo, 'a.txt'), 'hello');

    const dotGit = path.join(repo, '.git');
    const renamed = path.join(repo, 'gitopen');

    // Step 1 of the exploit — the rename. This is what used to be ALLOWED.
    expect(allowed(dotGit)).toBe(false);
    // The destination is checked too, so the restore half is closed as well.
    expect(allowed(renamed)).toBe(true); // an ordinary name, on its own
    // …but the source being denied is what stops move_file dead.

    // The contents were always denied, and still are.
    expect(allowed(path.join(dotGit, 'config'))).toBe(false);
    expect(allowed(path.join(dotGit, 'HEAD'))).toBe(false);
    expect(allowed(path.join(dotGit, 'hooks', 'pre-commit'))).toBe(false);
    expect(allowed(path.join(dotGit, 'refs', 'heads', 'main'))).toBe(false);

    // The repository is untouched by this test — no remote was ever injected.
    const { stdout } = await run('git', ['remote', '-v'], { cwd: repo });
    expect(stdout.trim()).toBe('');
  }, 30000);

  it('denies .git named alone, as a final segment, and as a parent', () => {
    expect(allowed('/home/x/repo/.git')).toBe(false); // final segment — the escape
    expect(allowed('/home/x/repo/.git/config')).toBe(false); // interior — always was
    expect(allowed('/home/x/repo/.git/')).toBe(false); // trailing slash
  });
});

describe('every directory pattern, not just .git', () => {
  const cases = [
    ['vault', '/home/x/ground/vault'],
    ['node_modules', '/home/x/ground/node_modules'],
    ['.ssh', '/home/x/.ssh'],
    ['keys', '/home/x/ground/keys'],
    ["another being's DNA", '/mnt/data/neuma/house/data/dna'],
    ['dna cache', '/mnt/data/neuma/house/data/dna-cache'],
    ['memory store', '/mnt/data/neuma/house/data/memory-store'],
  ];
  it.each(cases)('denies %s renamed at its final segment', (_label, p) => {
    expect(allowed(p)).toBe(false);
    expect(allowed(`${p}/inside.txt`)).toBe(false);
  });

  it('denies the install config directory itself (AI-SEC-005)', () => {
    // INSTALL_PATTERNS only apply inside the Neuma install, so anchor there.
    const installConfig = path.resolve('config');
    expect(deniedPatternsFor(installConfig)).toContain('config/');
    expect(allowed(installConfig)).toBe(false);
    expect(allowed(path.join(installConfig, 'tool-policy.json'))).toBe(false);
  });
});

describe('the guard must not swallow ordinary paths', () => {
  const stillAllowed = [
    '/home/x/ground/src/index.js',
    '/home/x/ground/project.git', // a bare-repo NAME is not the .git directory
    '/home/x/ground/gitignore',
    '/home/x/ground/mydata/dna-notes.md', // 'data/dna' must not match 'mydata/dna-notes'
    '/home/x/ground/metadata/dnasequence.txt',
    '/home/x/ground/configuration/app.js', // 'config/' must not match 'configuration/'
    '/home/x/ground/keysmith/tool.js', // 'keys/' must not match 'keysmith/'
    '/home/x/ground/vaulted/notes.md', // 'vault/' must not match 'vaulted/'
  ];
  it.each(stillAllowed)('allows %s', (p) => {
    expect(allowed(p)).toBe(true);
  });

  it('leaves filename-shaped patterns on substring matching, unchanged', () => {
    // No trailing slash: these were never directory patterns and must keep
    // catching leaves exactly as before.
    expect(matchesDeniedPattern('/home/x/.env', '.env')).toBe(true);
    expect(matchesDeniedPattern('/home/x/lane/owner.json', 'owner.json')).toBe(true);
    expect(matchesDeniedPattern('/home/x/keys/keypair.json', 'keys/keypair')).toBe(true);
  });
});

describe('the predicate itself', () => {
  it('treats a directory pattern as a whole segment', () => {
    expect(matchesDeniedPattern('/a/.git', '.git/')).toBe(true);
    expect(matchesDeniedPattern('/a/.git/b', '.git/')).toBe(true);
    expect(matchesDeniedPattern('.git', '.git/')).toBe(true);
    expect(matchesDeniedPattern('/a/b.git', '.git/')).toBe(false);
    expect(matchesDeniedPattern('/a/git', '.git/')).toBe(false);
  });

  it('matches a multi-segment directory pattern wherever the root was relocated', () => {
    expect(matchesDeniedPattern('/anywhere/data/dna', 'data/dna/')).toBe(true);
    expect(matchesDeniedPattern('/anywhere/data/dna/being.md', 'data/dna/')).toBe(true);
    expect(matchesDeniedPattern('/anywhere/mydata/dna', 'data/dna/')).toBe(false);
  });
});

// SEC-036 (#226). `checkPathAccess` hands this predicate a PLATFORM-NATIVE
// path, so on Windows every pattern written with a slash used to miss and the
// whole directory-shaped deny list was reachable. A Windows-shaped path is
// ordinary data on this host, so the escape is provable here directly —
// exactly the paths a being on Windows would have reached.
describe('a Windows-shaped path hits the same denials', () => {
  it('denies .git named alone, as a final segment, and as a parent', () => {
    expect(matchesDeniedPattern('c:\\repo\\.git', '.git/')).toBe(true);
    expect(matchesDeniedPattern('c:\\repo\\.git\\config', '.git/')).toBe(true);
    expect(matchesDeniedPattern('\\\\server\\share\\.git\\hooks\\pre-commit', '.git/')).toBe(true);
  });

  it('denies the sovereign and secret directories', () => {
    expect(matchesDeniedPattern('c:\\neuma\\vault\\dek', 'vault/')).toBe(true);
    expect(matchesDeniedPattern('c:\\users\\founder\\.ssh\\id_ed25519', '.ssh/')).toBe(true);
    expect(matchesDeniedPattern('c:\\neuma\\data\\dna\\other-being.md', 'data/dna/')).toBe(true);
  });

  it('denies slash-bearing leaf patterns', () => {
    expect(matchesDeniedPattern('c:\\users\\founder\\keys\\keypair', 'keys/keypair')).toBe(true);
    expect(matchesDeniedPattern('c:\\neuma\\config\\tool-policy.json', 'config/tool-policy.json')).toBe(true);
  });

  it('still refuses to over-match a sibling name', () => {
    expect(matchesDeniedPattern('c:\\repo\\gitignore', '.git/')).toBe(false);
    expect(matchesDeniedPattern('c:\\repo\\b.git', '.git/')).toBe(false);
    expect(matchesDeniedPattern('c:\\repo\\mydata\\dna', 'data/dna/')).toBe(false);
    expect(matchesDeniedPattern('c:\\repo\\database\\x', 'data/dna/')).toBe(false);
  });
});
