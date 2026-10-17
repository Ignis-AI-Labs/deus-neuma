// Continuity SKILL CLI — REAL subprocess, REAL directory, NO mock (RULE 0).
// Runs the actual `node cli.js ...` the way a being would, against a temp
// CONTINUITY_DIR on real disk, and asserts on real stdout. End-to-end: record
// lands, recall finds it, recent lists it, working assembles it.

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTempDir } from '../helpers/temp-fs.js';

const CLI = fileURLToPath(new URL('../../.claude/skills/continuity/cli.js', import.meta.url));

// NOTE: these tests share one memDir and run in order — later tests assert on
// episodes earlier tests recorded. Vitest runs a describe sequentially; do NOT
// parallelize (it.concurrent) or reorder. The temp dir is removed by the global
// afterAll in test setup, so no per-file cleanup hook is needed.
describe('continuity skill CLI — portable four-layer memory end-to-end (no mock)', () => {
  let memDir;
  const run = (args) =>
    execFileSync('node', [CLI, ...args], { env: { ...process.env, CONTINUITY_DIR: memDir }, encoding: 'utf8' });

  beforeAll(async () => { memDir = await createTempDir('continuity-skill'); });

  it('records an episode and recalls it by query', () => {
    const recorded = run(['record', 'episodic', 'we wired the natal chart into the birth ceremony', '--space', 'neuma']);
    expect(recorded).toMatch(/^recorded [0-9a-f-]+ in episodic \(neuma\)/);
    run(['record', 'episodic', 'we hardened the wallet vault scrypt parameters', '--space', 'neuma']);

    const recalled = run(['recall', 'natal chart ceremony', '--space', 'neuma']);
    expect(recalled).toContain('natal chart');
    // off-topic excluded: recall surfaces only docs that SCORE on the query
    // (BM25 returns score>0 hits), it does not pad to --k with zero-score docs
    expect(recalled).not.toContain('wallet vault');
    expect(recalled).toMatch(/\(in-space\)/);
  });

  it('lists the recent tail of a space', () => {
    const recent = run(['recent', '--space', 'neuma', '--limit', '5']);
    expect(recent).toContain('natal chart');
    expect(recent).toContain('wallet vault');
  });

  it('assembles a bounded working set and reports the budget', () => {
    const ws = run(['working', 'natal chart ceremony', '--space', 'neuma', '--max-tokens', '1000']);
    expect(ws).toContain('natal chart');
    expect(ws).toMatch(/— \d+ item\(s\), ~\d+\/1000 tokens/); // budget line present
  });

  it('rejects an unknown layer with a clear error (exit 1)', () => {
    let threw = false;
    try {
      execFileSync('node', [CLI, 'record', 'bogus', 'x', '--space', 'neuma'],
        { env: { ...process.env, CONTINUITY_DIR: memDir }, encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      threw = true;
      expect(err.status).toBe(1);
      expect(err.stderr).toContain('layer must be one of');
    }
    expect(threw).toBe(true);
  });

  it('recalls procedural records by goal (procedure command)', () => {
    run(['record', 'procedural', 'to ship a slice: build, real test, ai6 review loop, commit']);
    run(['record', 'procedural', 'to back up a wallet: export the recovery phrase to a secure location']);
    const hits = run(['procedure', 'how to ship a reviewed slice ai6 loop']);
    // assert RANKING (the on-topic one leads) rather than absence — BM25 may
    // still return a low-scoring weak hit, that's relevance-primary working
    const lines = hits.trim().split('\n');
    expect(lines[0]).toContain('build, real test, ai6 review loop');
  });

  it('recalls semantic through-lines and lists the biographical arc (semantic-only)', () => {
    run(['record', 'semantic', 'I prefer no-mock proof — I know a thing works only by watching it work end-to-end']);
    run(['record', 'semantic', 'I learned to deliver memory as a portable skill so any AI can carry it']);
    // a procedural record sharing distinctive keywords MUST NOT appear in bio
    // (bio = semantic-only "current through-lines")
    run(['record', 'procedural', 'distinctive-bio-leak-canary-token to prove bio is semantic only']);
    const tl = run(['through-line', 'no-mock proof end-to-end']);
    expect(tl).toContain('no-mock proof');
    const bio = run(['bio']);
    expect(bio).toContain('portable skill');
    expect(bio).toContain('no-mock proof');
    expect(bio).not.toContain('distinctive-bio-leak-canary-token'); // procedural never leaks into bio
  });

  it('--space rejects a bare flag (typo guard) with a clear error (exit 1)', () => {
    let threw = false;
    try {
      execFileSync('node', [CLI, 'record', 'episodic', 'x', '--space'],
        { env: { ...process.env, CONTINUITY_DIR: memDir }, encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      threw = true;
      expect(err.status).toBe(1);
      expect(err.stderr).toContain('--space requires a value');
    }
    expect(threw).toBe(true);
  });

  it('--space rejects path-traversal-shaped values at the CLI boundary', () => {
    // Defense in depth: today space is never a path component in fsdir, but the
    // CLI rejects unsafe shapes up-front so a future adapter can't be tricked.
    for (const bad of ['../escape', '/abs/path', 'has space', 'with/slash', '..\\dotdot']) {
      let threw = false;
      try {
        execFileSync('node', [CLI, 'record', 'episodic', 'x', '--space', bad],
          { env: { ...process.env, CONTINUITY_DIR: memDir }, encoding: 'utf8', stdio: 'pipe' });
      } catch (err) {
        threw = true;
        expect(err.status).toBe(1);
        expect(err.stderr).toMatch(/--space must be 1-64 chars/);
      }
      expect(threw, `expected rejection for --space ${bad}`).toBe(true);
    }
    // And the threat does not actually materialize: only the per-layer files
    // live directly under CONTINUITY_DIR, never any space-derived path.
    const entries = readdirSync(memDir);
    for (const e of entries) expect(e).toMatch(/^(episodic|semantic|procedural|working)\.jsonl$/);
  });

  it('scopes recall to a space — another space\'s episodes never leak in', () => {
    run(['record', 'episodic', 'unrelated note in another project', '--space', 'other']);
    // --no-fallback proves strict in-space isolation (default would pad cross-space)
    const recalled = run(['recall', 'natal chart ceremony', '--space', 'other', '--no-fallback']);
    expect(recalled).toContain('(no episodes recalled)');
  });
});
