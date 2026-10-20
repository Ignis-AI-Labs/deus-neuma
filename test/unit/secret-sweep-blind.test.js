/**
 * A BLIND SWEEP IS NEVER A WHOLE SCOPE (security-seat recheck, 2026-10-20).
 *
 * The sweep used to read the working tree, so a tracked file deleted from
 * disk, chmod 000, given a leading NUL or grown past the size cap read as
 * clean — and the watch verified a CSO's "mitigated" claim and closed the open
 * finding while the secret still sat in HEAD. Proven here the way the probe
 * found it (/tmp/sec-seat/recheck/bypass/s45/blind-whole.mjs), on the real
 * path, no double (RULE 0): the real `sweepRepo` over a real tmp git repo,
 * the real `scannedScopes`, `verifyVanishedClaims` and `settleVanished`.
 *
 * Each trick must leave the claim unverified and the finding open; a real,
 * committed fix must still verify and close; a blob the sweep cannot read
 * must make the scope not whole.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Buffer } from 'buffer';
import { createTempDir } from '../helpers/temp-fs.js';
import { sweepRepo, sweepFindingsAsThreats } from '../../backend/services/security/secret-sweep.js';
import { scannedScopes } from '../../backend/services/security/security-scheduler.js';
import { verifyVanishedClaims, settleVanished, scopeKey } from '../../backend/services/security/threat-lifecycle.js';

const execFileP = promisify(execFile);
// A fake GitHub-token SHAPE built at runtime — never a real value.
const FAKE = ['ghp', 'Q'.repeat(40)].join('_');
const keyOf = (e) => `${e.source}::${e.repo}::${e.externalId}`;

describe('the watch reads what git holds, not what the working tree shows', () => {
  let dir;
  let repo;
  const git = (...args) => execFileP('git', args, { cwd: dir });
  const notes = () => path.join(dir, 'notes.md');

  beforeEach(async () => {
    dir = await createTempDir('secret-sweep-blind');
    repo = { id: 'r', path: dir };
    await git('init', '-q');
    await git('config', 'user.email', 'probe@example.invalid');
    await git('config', 'user.name', 'probe');
    await fs.writeFile(notes(), `token: ${FAKE}\n`);
    await git('add', '.');
    await git('commit', '-q', '-m', 'notes');
  });

  // The real decision a watch pass makes on the rescan: is the scope whole,
  // and does it verify the claim / close the open row?
  const judge = async () => {
    const first = await sweepRepo(repo);
    expect(first.findings).toHaveLength(1);
    const threats = sweepFindingsAsThreats(repo, first.findings);
    const claimed = threats.map((t) => ({ ...t, id: 'a1', status: 'mitigated', assessedBy: 'cso-lane', assessedAt: '2026-10-20T00:00:00.000Z', history: [{ status: 'mitigated' }] }));
    const open = threats.map((t) => ({ ...t, id: 'b1', status: 'confirmed', history: [] }));
    return async () => {
      const sweep = await sweepRepo(repo);
      const history = { findings: [], error: null };
      const scanned = new Set(scannedScopes({ repoLegs: [{ repo: 'r', advisories: { ok: false }, sweep, history }] }).map(scopeKey));
      const seenKeys = new Set(sweepFindingsAsThreats(repo, sweep.findings).map(keyOf));
      const at = new Date().toISOString();
      return {
        sweep,
        whole: scanned.has('secret-sweep::r'),
        verified: verifyVanishedClaims(claimed, { scanned, seenKeys, keyOf, at }).length,
        closed: settleVanished(open, { scanned, seenKeys, keyOf, at }).length,
      };
    };
  };

  const TRICKS = Object.freeze({
    'the file deleted from the working tree only': () => fs.rm(notes()),
    'the file made unreadable (chmod 000)': () => fs.chmod(notes(), 0),
    'a leading NUL written to the working copy': async () => fs.writeFile(notes(), Buffer.concat([Buffer.from([0]), await fs.readFile(notes())])),
    'the working copy grown past the size cap': () => fs.appendFile(notes(), 'x'.repeat(17 * 1024 * 1024)),
    'the file removed from the index alone (git rm --cached)': () => git('rm', '-q', '--cached', 'notes.md'),
  });

  test.each(Object.entries(TRICKS))('%s: still seen, the claim stays unverified, the finding stays open', async (_, trick) => {
    const rescan = await judge();
    await trick();
    const { sweep, whole, verified, closed } = await rescan();
    expect(sweep.error).toBeNull();
    expect(sweep.findings.map((f) => `${f.file}:${f.patternId}`)).toEqual(['notes.md:github-token']);
    expect(whole).toBe(true);
    expect(verified).toBe(0);
    expect(closed).toBe(0);
    expect(JSON.stringify(sweep)).not.toContain(FAKE);
  });

  test('the real fix, committed: verified and closed (the watch is not stuck shut)', async () => {
    const rescan = await judge();
    await fs.writeFile(notes(), 'token: read it from the vault\n');
    await git('commit', '-q', '-am', 'fix');
    const { sweep, whole, verified, closed } = await rescan();
    expect(sweep).toMatchObject({ error: null, findings: [] });
    expect(whole).toBe(true);
    expect(verified).toBe(1);
    expect(closed).toBe(1);
  });

  test('a committed blob past the cap makes the sweep say it is blind — the scope is not whole', async () => {
    const rescan = await judge();
    await fs.writeFile(notes(), 'token: read it from the vault\n');
    await fs.writeFile(path.join(dir, 'dump.sql'), `${'x'.repeat(17 * 1024 * 1024)}\n`);
    await git('add', '.');
    await git('commit', '-q', '-m', 'fix, and a big dump');
    const { sweep, whole, verified, closed } = await rescan();
    expect(sweep.error).toMatch(/^1 tracked file\(s\) could not be read, so this sweep is not whole: dump\.sql \(\d+ bytes, over the \d+-byte cap\)$/);
    expect(whole).toBe(false);
    expect(verified).toBe(0);
    expect(closed).toBe(0);
  });

  test('a committed file with a NUL in it is read as text — a key in a binary is still found', async () => {
    await fs.writeFile(path.join(dir, 'blob.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(`\nAWS=${['AKIA', 'Z'.repeat(16)].join('')}\n`)]));
    await git('add', 'blob.bin');
    await git('commit', '-q', '-m', 'binary');
    const sweep = await sweepRepo(repo);
    expect(sweep.error).toBeNull();
    expect(sweep.findings.map((f) => `${f.file}:${f.line}:${f.patternId}`).sort()).toEqual(['blob.bin:2:aws-access-key', 'notes.md:1:github-token']);
  });

  test('a path whose staged and committed copies differ is reported once, at the staged line', async () => {
    await fs.writeFile(notes(), `# moved down\n\ntoken: ${FAKE}\n`);
    await git('add', 'notes.md');
    const sweep = await sweepRepo(repo);
    expect(sweep.scanned).toBe(1);
    expect(sweep.findings.map((f) => `${f.file}:${f.line}`)).toEqual(['notes.md:3']);
  });
});
