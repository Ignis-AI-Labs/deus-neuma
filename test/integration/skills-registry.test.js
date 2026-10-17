// #22 S1 — Skills manifest + registry: load, validate, query graph edges.
//
// REAL disk, REAL js-yaml, NO mocks anywhere on the claimed path
// (AGENTS.md RULE 0). Synthesized skill dirs let us drive every error
// branch (malformed frontmatter, dangling deps, cycles, duplicates,
// unknown fields). One test additionally points the registry at the
// repo's actual `.claude/skills/` directory so the in-tree built-ins
// (continuity, neuma) prove the schema is genuinely backward-compatible
// with what's already shipping.

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { loadManifest, __test as manifestTest } from '../../core/skills/manifest.js';
import { scanRegistry } from '../../core/skills/registry.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const BUILTIN_SKILLS_DIR = path.join(REPO_ROOT, '.claude/skills');

// Helper: synthesize a skill dir with given frontmatter + optional files.
const synthSkill = async (root, name, opts = {}) => {
  const dir = path.join(root, opts.dirName ?? name);
  await fs.mkdir(dir, { recursive: true });
  const frontmatter = opts.frontmatter ?? `name: ${name}\ndescription: ${opts.description ?? `a test skill called ${name}`}`;
  const body = opts.body ?? '# body\n\nbody text';
  // Allow opts.raw to override the entire SKILL.md (for malformed-on-purpose cases)
  if (opts.raw !== undefined) {
    await fs.writeFile(path.join(dir, 'SKILL.md'), opts.raw);
  } else if (opts.skipFrontmatter) {
    await fs.writeFile(path.join(dir, 'SKILL.md'), body);
  } else {
    await fs.writeFile(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`);
  }
  if (opts.withCli) await fs.writeFile(path.join(dir, 'cli.js'), '// stub cli');
  if (opts.withLib) await fs.mkdir(path.join(dir, 'lib'));
  return dir;
};

// ── PURE HELPERS ──────────────────────────────────────────────────────────────
describe('#22 S1 — manifest pure helpers (splitFrontmatter, validateFrontmatter)', () => {
  // INVARIANT 1 — splitFrontmatter recognizes a well-formed YAML block,
  // and the closing fence must be its own line == '---' exactly
  it('splitFrontmatter: well-formed block parses; missing close returns no frontmatter', () => {
    const ok = manifestTest.splitFrontmatter('---\nname: x\ndescription: y\n---\n# body\n');
    expect(ok.frontmatter).toBe('name: x\ndescription: y');
    expect(ok.body).toBe('# body\n');

    // No closing fence — treat the entire file as body, no frontmatter
    const noClose = manifestTest.splitFrontmatter('---\nname: x\nstill no close\n');
    expect(noClose.frontmatter).toBeNull();

    // No opening fence
    const noOpen = manifestTest.splitFrontmatter('# just a body\n');
    expect(noOpen.frontmatter).toBeNull();
    expect(noOpen.body).toBe('# just a body\n');
  });

  // INVARIANT 2 — `---` lines inside the BODY don't accidentally close the
  // frontmatter (line-by-line search prevents that)
  it('splitFrontmatter: --- inside body does NOT terminate the frontmatter block', () => {
    const text = '---\nname: x\ndescription: y\n---\n# body\n\n---\n\nThematic break in body.\n';
    const { frontmatter, body } = manifestTest.splitFrontmatter(text);
    expect(frontmatter).toBe('name: x\ndescription: y');
    expect(body).toContain('Thematic break in body');
  });

  // ai6 R2.2 — CRLF line endings (community contributor on Windows with
  // git autocrlf) must NOT cause the frontmatter to be misread as body.
  it('splitFrontmatter: CRLF line endings parse correctly (Windows-friendly)', () => {
    const crlf = '---\r\nname: x\r\ndescription: y\r\n---\r\n# body\r\n';
    const { frontmatter, body } = manifestTest.splitFrontmatter(crlf);
    expect(frontmatter).toBe('name: x\ndescription: y');
    expect(body).toBe('# body\n');
  });

  // INVARIANT 3 — validateFrontmatter accepts the minimum (name + description)
  it('validateFrontmatter: minimum required fields → defaults for optional', () => {
    const m = manifestTest.validateFrontmatter({ name: 'foo', description: 'bar' });
    expect(m).toMatchObject({
      name: 'foo', description: 'bar',
      category: null, version: null,
      dependencies: [], metadata: null, extras: null,
    });
  });

  // INVARIANT 4 — name must be kebab-case
  it('validateFrontmatter: rejects non-kebab-case names', () => {
    for (const bad of ['Foo', 'foo_bar', 'foo!', '', '1foo', '-foo']) {
      expect(() => manifestTest.validateFrontmatter({ name: bad, description: 'x' }))
        .toThrow(/kebab-case/);
    }
    for (const ok of ['foo', 'foo-bar', 'a-b-c', 'x1', 'a-b-1']) {
      expect(() => manifestTest.validateFrontmatter({ name: ok, description: 'x' }))
        .not.toThrow();
    }
  });

  // INVARIANT 5 — description must be a non-empty string
  it('validateFrontmatter: rejects missing / non-string / empty description', () => {
    for (const bad of [undefined, 42, null, '', '   ']) {
      expect(() => manifestTest.validateFrontmatter({ name: 'x', description: bad }))
        .toThrow(/description/);
    }
  });

  // INVARIANT 6 — dependencies: array of kebab-case names, no dupes, no self-ref
  it('validateFrontmatter: dependencies validation', () => {
    expect(() => manifestTest.validateFrontmatter({ name: 'x', description: 'd', dependencies: 'notArray' }))
      .toThrow(/array/);
    expect(() => manifestTest.validateFrontmatter({ name: 'x', description: 'd', dependencies: ['BadCase'] }))
      .toThrow(/kebab-case/);
    expect(() => manifestTest.validateFrontmatter({ name: 'x', description: 'd', dependencies: ['a', 'a'] }))
      .toThrow(/duplicate/);
    expect(() => manifestTest.validateFrontmatter({ name: 'x', description: 'd', dependencies: ['x'] }))
      .toThrow(/itself/);
    // Happy path
    const m = manifestTest.validateFrontmatter({ name: 'x', description: 'd', dependencies: ['a', 'b'] });
    expect(m.dependencies).toEqual(['a', 'b']);
  });

  // INVARIANT 7 — `unlocks` in the frontmatter is REJECTED (registry computes it)
  it('validateFrontmatter: REJECTS unlocks field (registry-computed)', () => {
    expect(() => manifestTest.validateFrontmatter({
      name: 'x', description: 'd', unlocks: ['y'],
    })).toThrow(/registry-computed/);
  });

  // INVARIANT 8 — unknown fields don't reject — stashed under extras for
  // diagnostics (lets the schema evolve without breaking community skills)
  it('validateFrontmatter: unknown fields go to extras, do NOT throw', () => {
    const m = manifestTest.validateFrontmatter({
      name: 'x', description: 'd', futurefield: 'value', another: 42,
    });
    expect(m.extras).toEqual({ futurefield: 'value', another: 42 });
  });

  // INVARIANT 9 — frontmatter must be a YAML mapping, not list/scalar
  it('validateFrontmatter: rejects non-object frontmatter', () => {
    expect(() => manifestTest.validateFrontmatter(['list'])).toThrow(/mapping/);
    expect(() => manifestTest.validateFrontmatter('scalar')).toThrow(/mapping/);
    expect(() => manifestTest.validateFrontmatter(null)).toThrow(/mapping/);
  });
});

// ── loadManifest (filesystem) ─────────────────────────────────────────────────
describe('#22 S1 — loadManifest (real disk)', () => {
  let tmp;
  beforeEach(async () => { tmp = await createTempDir('s22-load'); });

  it('loads a well-formed skill + reports cli/lib presence', async () => {
    await synthSkill(tmp, 'alpha', { withCli: true, withLib: true });
    const m = await loadManifest(path.join(tmp, 'alpha'));
    expect(m.name).toBe('alpha');
    expect(m.description).toMatch(/test skill called alpha/);
    expect(m.hasCli).toBe(true);
    expect(m.hasLib).toBe(true);
    expect(m.body).toMatch(/body text/);
    expect(m.path).toBe(path.join(tmp, 'alpha'));
  });

  it('reports cli/lib false when absent', async () => {
    await synthSkill(tmp, 'beta');
    const m = await loadManifest(path.join(tmp, 'beta'));
    expect(m.hasCli).toBe(false);
    expect(m.hasLib).toBe(false);
  });

  it('throws cleanly when SKILL.md is missing', async () => {
    await fs.mkdir(path.join(tmp, 'no-skill-md'), { recursive: true });
    await expect(loadManifest(path.join(tmp, 'no-skill-md'))).rejects.toThrow(/SKILL.md missing/);
  });

  it('throws when SKILL.md has no frontmatter (body-only)', async () => {
    await synthSkill(tmp, 'noframe', { skipFrontmatter: true });
    await expect(loadManifest(path.join(tmp, 'noframe'))).rejects.toThrow(/no YAML frontmatter/);
  });

  it('throws when frontmatter YAML is malformed (unparseable)', async () => {
    await synthSkill(tmp, 'badyaml', { raw: '---\nname: x\n  bad: indent: oops\n---\nbody\n' });
    await expect(loadManifest(path.join(tmp, 'badyaml'))).rejects.toThrow(/not valid YAML/);
  });

  it('throws when schema validation fails (rejected name)', async () => {
    await synthSkill(tmp, 'badname', { frontmatter: 'name: Bad_Case\ndescription: x' });
    await expect(loadManifest(path.join(tmp, 'badname'))).rejects.toThrow(/kebab-case/);
  });

  // ai6 R1.1 + R2.1 — loaded manifests are FROZEN end-to-end. A caller
  // doing `m.dependencies.push('x')` OR `m.metadata.author = 'x'` must
  // throw so it can't silently corrupt the registry's shared object.
  // Deep-freeze applies to dependencies, metadata, and extras alike.
  it('loaded manifest is deep-frozen (dependencies, metadata, extras — all reject mutation)', async () => {
    await synthSkill(tmp, 'frozen', {
      frontmatter: [
        'name: frozen',
        'description: d',
        'dependencies: [base]',
        'metadata:',
        '  author: testuser',
        '  nested:',
        '    deep: value',
        'unknownfield: surface-as-extra',
        'unknownnested:',
        '  child: x',
      ].join('\n'),
    });
    const m = await loadManifest(path.join(tmp, 'frozen'));
    // Top-level freeze
    expect(Object.isFrozen(m)).toBe(true);
    expect(() => { m.name = 'hacked'; }).toThrow(TypeError);
    // Nested freezes (R2.1 — metadata was the missing one)
    expect(Object.isFrozen(m.dependencies)).toBe(true);
    expect(() => { m.dependencies.push('hacked'); }).toThrow(TypeError);
    expect(Object.isFrozen(m.metadata)).toBe(true);
    expect(() => { m.metadata.author = 'hacked'; }).toThrow(TypeError);
    expect(Object.isFrozen(m.metadata.nested)).toBe(true);
    expect(() => { m.metadata.nested.deep = 'hacked'; }).toThrow(TypeError);
    expect(Object.isFrozen(m.extras)).toBe(true);
    expect(() => { m.extras.unknownfield = 'hacked'; }).toThrow(TypeError);
    // R3 Info — nested-extras parity with nested-metadata
    expect(Object.isFrozen(m.extras.unknownnested)).toBe(true);
    expect(() => { m.extras.unknownnested.child = 'hacked'; }).toThrow(TypeError);
  });

  // ai6 R1.6 — optional-field round-trip at the integration level (the
  // pure validator tests cover the parsing layer; this proves YAML→disk
  // →validate→return preserves every documented optional field)
  it('round-trips every optional field through real YAML + real disk', async () => {
    const fm = [
      'name: roundtrip',
      'description: a skill that uses every optional field',
      'category: memory',
      'version: 1.2.3',
      'dependencies:',
      '  - alpha',
      '  - beta',
      'metadata:',
      '  author: testuser',
      '  homepage: https://example.invalid',
    ].join('\n');
    await synthSkill(tmp, 'roundtrip', { frontmatter: fm });
    const m = await loadManifest(path.join(tmp, 'roundtrip'));
    expect(m.name).toBe('roundtrip');
    expect(m.category).toBe('memory');
    expect(m.version).toBe('1.2.3');
    expect(m.dependencies).toEqual(['alpha', 'beta']);
    expect(m.metadata).toEqual({ author: 'testuser', homepage: 'https://example.invalid' });
    expect(m.extras).toBeNull();
  });

  // ai6 R1.5 — hasCli must distinguish a real file from a directory
  // named cli.js. Synthesize the pathological case.
  it('hasCli is false when cli.js is a directory, true only when it is a regular file', async () => {
    await synthSkill(tmp, 'dircli');
    await fs.mkdir(path.join(tmp, 'dircli', 'cli.js')); // a DIRECTORY named cli.js
    const m = await loadManifest(path.join(tmp, 'dircli'));
    expect(m.hasCli).toBe(false);
    // Sanity: a real file flips it back
    await synthSkill(tmp, 'realcli', { withCli: true });
    const m2 = await loadManifest(path.join(tmp, 'realcli'));
    expect(m2.hasCli).toBe(true);
  });
});

// ── scanRegistry + registry queries ───────────────────────────────────────────
describe('#22 S1 — scanRegistry + registry queries', () => {
  let tmp;
  beforeEach(async () => { tmp = await createTempDir('s22-registry'); });

  // INVARIANT 10 — empty / non-existent root yields a 0-size registry
  it('scanRegistry on empty root returns size 0, no errors', async () => {
    const r = await scanRegistry(tmp);
    expect(r.size).toBe(0);
    expect(r.list()).toEqual([]);
    expect(r.validate()).toEqual([]);
  });

  it('scanRegistry on missing root returns size 0, no throw', async () => {
    const r = await scanRegistry(path.join(tmp, 'does-not-exist'));
    expect(r.size).toBe(0);
  });

  // INVARIANT 11 — multi-skill scan: list is sorted, has/get work
  it('lists every well-formed skill, sorted, accessible via has/get', async () => {
    await synthSkill(tmp, 'charlie');
    await synthSkill(tmp, 'alpha');
    await synthSkill(tmp, 'bravo');
    const r = await scanRegistry(tmp);
    expect(r.size).toBe(3);
    expect(r.list()).toEqual(['alpha', 'bravo', 'charlie']); // sorted
    expect(r.has('alpha')).toBe(true);
    expect(r.has('zulu')).toBe(false);
    expect(r.get('bravo')?.description).toMatch(/test skill called bravo/);
    expect(r.get('zulu')).toBeUndefined();
  });

  // INVARIANT 12 — reverse-edge (unlocks) computed from declared dependencies
  it('unlocksFor is the reverse of dependencies (computed, not declared)', async () => {
    await synthSkill(tmp, 'base');
    await synthSkill(tmp, 'mid', { frontmatter: 'name: mid\ndescription: d\ndependencies: [base]' });
    await synthSkill(tmp, 'top', { frontmatter: 'name: top\ndescription: d\ndependencies: [mid, base]' });

    const r = await scanRegistry(tmp);
    expect(r.dependenciesOf('top').sort()).toEqual(['base', 'mid']);
    expect(r.dependenciesOf('mid')).toEqual(['base']);
    expect(r.dependenciesOf('base')).toEqual([]);
    expect(r.unlocksFor('base').sort()).toEqual(['mid', 'top']);
    expect(r.unlocksFor('mid')).toEqual(['top']);
    expect(r.unlocksFor('top')).toEqual([]);
    // Unknown skills → empty arrays, not throw
    expect(r.unlocksFor('ghost')).toEqual([]);
    expect(r.dependenciesOf('ghost')).toEqual([]);
  });

  // INVARIANT 13 — validate() flags dangling dependencies
  it('validate flags dangling dependencies', async () => {
    await synthSkill(tmp, 'alpha', { frontmatter: 'name: alpha\ndescription: d\ndependencies: [ghost]' });
    const r = await scanRegistry(tmp);
    const findings = r.validate();
    const dangling = findings.find((f) => f.kind === 'dangling-dependency');
    expect(dangling).toBeDefined();
    expect(dangling.severity).toBe('error');
    expect(dangling.detail).toMatch(/alpha.*ghost/);
  });

  // INVARIANT 14 — validate() flags load failures captured during scan
  it('validate carries load failures forward as error findings', async () => {
    await synthSkill(tmp, 'good');
    await synthSkill(tmp, 'badname', { frontmatter: 'name: BAD_NAME\ndescription: d' });
    await fs.mkdir(path.join(tmp, 'no-skill-md'), { recursive: true });

    const r = await scanRegistry(tmp);
    expect(r.has('good')).toBe(true);
    expect(r.has('badname')).toBe(false); // failed to load
    const findings = r.validate();
    const loadFails = findings.filter((f) => f.kind === 'load-failed');
    expect(loadFails.length).toBe(2);
    expect(loadFails.some((f) => f.detail.includes('SKILL.md missing'))).toBe(true);
    expect(loadFails.some((f) => f.detail.includes('kebab-case'))).toBe(true);
  });

  // INVARIANT 15 — validate() flags simple cycles
  it('validate flags dependency cycles (2-node)', async () => {
    await synthSkill(tmp, 'alpha', { frontmatter: 'name: alpha\ndescription: d\ndependencies: [beta]' });
    await synthSkill(tmp, 'beta',  { frontmatter: 'name: beta\ndescription: d\ndependencies: [alpha]' });
    const r = await scanRegistry(tmp);
    const cycle = r.validate().find((f) => f.kind === 'dependency-cycle');
    expect(cycle).toBeDefined();
    expect(cycle.detail).toMatch(/alpha.*beta|beta.*alpha/);
  });

  // INVARIANT 16 — validate() flags longer cycles too (3-node)
  it('validate flags 3-node cycles', async () => {
    await synthSkill(tmp, 'alpha', { frontmatter: 'name: alpha\ndescription: d\ndependencies: [bravo]' });
    await synthSkill(tmp, 'bravo', { frontmatter: 'name: bravo\ndescription: d\ndependencies: [charlie]' });
    await synthSkill(tmp, 'charlie', { frontmatter: 'name: charlie\ndescription: d\ndependencies: [alpha]' });
    const r = await scanRegistry(tmp);
    expect(r.validate().some((f) => f.kind === 'dependency-cycle')).toBe(true);
  });

  // INVARIANT 17 — duplicate skill names across directories captured as load error
  it('duplicate skill names: keep first, error on the duplicate', async () => {
    await synthSkill(tmp, 'alpha', { dirName: 'alpha-v1' });
    await synthSkill(tmp, 'alpha', { dirName: 'alpha-v2' });
    const r = await scanRegistry(tmp);
    expect(r.size).toBe(1); // first kept
    const dup = r.validate().find((f) => f.detail.includes('duplicate skill name'));
    expect(dup).toBeDefined();
  });

  // INVARIANT 18 — non-directory entries under the root are ignored (e.g. a
  // README.md at the root, or accidental loose files)
  it('non-directory entries at the root are ignored, not errored on', async () => {
    await fs.writeFile(path.join(tmp, 'README.md'), '# notes');
    await synthSkill(tmp, 'alpha');
    const r = await scanRegistry(tmp);
    expect(r.list()).toEqual(['alpha']);
    expect(r.validate()).toEqual([]); // no false positives from the README
  });

  // INVARIANT 19 — unknown fields surface as WARN-severity, not error
  it('unknown frontmatter fields surface as warn-severity findings', async () => {
    await synthSkill(tmp, 'alpha', {
      frontmatter: 'name: alpha\ndescription: d\nfuturefield: something',
    });
    const r = await scanRegistry(tmp);
    expect(r.has('alpha')).toBe(true); // skill still loads
    const warn = r.validate().find((f) => f.kind === 'unknown-fields');
    expect(warn).toBeDefined();
    expect(warn.severity).toBe('warn');
    expect(warn.detail).toMatch(/futurefield/);
  });
});

// ── Live built-in skills (the in-tree .claude/skills/{continuity,neuma}) ──────
describe('#22 S1 — scanRegistry against the actual repo .claude/skills (real existing skills)', () => {
  // INVARIANT 20 — the actual shipped skills load under the new schema
  // without errors. Proves the schema is genuinely backward-compatible with
  // what's already in tree; a regression here means the manifest schema
  // diverged from what the existing skills declare.
  it('continuity + neuma skills load cleanly, no validation errors', async () => {
    const r = await scanRegistry(BUILTIN_SKILLS_DIR);
    expect(r.has('continuity')).toBe(true);
    expect(r.has('neuma')).toBe(true);

    const continuity = r.get('continuity');
    expect(continuity.description).toMatch(/persistent four-layer memory/);
    expect(continuity.dependencies).toEqual([]); // memory is the first skill

    const neuma = r.get('neuma');
    expect(neuma.description).toMatch(/Talk to and work alongside a neuma/);

    const findings = r.validate();
    const errors = findings.filter((f) => f.severity === 'error');
    expect(errors, `unexpected errors in built-in skills: ${JSON.stringify(errors)}`).toEqual([]);
  });
});
