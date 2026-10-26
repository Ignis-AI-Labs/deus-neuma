/** Real packaged files, real importer/checker processes, real prompt and tool dispatch. No mocks. */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { BUNDLE_ROOT, readStandardsBundle, validateManifest } from '../../backend/services/coding-standards/bundle.js';
import { formatStandards } from '../../backend/services/coding-standards/prompt.js';
import { isPermittedPullRequest } from '../../backend/services/coding-standards/branch-flow.js';
import { groundProtocolSection } from '../../backend/services/ground-protocol.js';
import { handleMapTool } from '../../backend/services/map-being-tools.js';
import { allocateEnvelope } from '../../backend/services/envelope-budget.js';

const script = path.resolve('scripts/coding-standards.mjs');
let root;
const copyBundle = async () => {
  const target = await fs.mkdtemp(path.join(root, 'bundle-'));
  await fs.cp(BUNDLE_ROOT, target, { recursive: true });
  return target;
};
beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'coding-standards-')); });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('packaged standards integrity', () => {
  test('every canonical core and module is verified, including routing and source identity', async () => {
    const bundle = await readStandardsBundle();
    expect(bundle.manifest.version).toBe('2.4.0');
    expect(Object.keys(bundle.documents)).toHaveLength(19);
    expect(bundle.manifest.core).toContain('DESIGN');
    for (const term of ['SHINKEI 真計', 'JŌHŌ SEKKEI 情報設計', 'CHOKKAN 直感', 'the stranger test', 'Less text, not less data', 'Every number the person needs stays on screen', 'Density is never decoration.', "**Show, don't tell**", 'Every problem is a door']) expect(bundle.documents.DESIGN).toContain(term);
    expect(formatStandards(bundle)).toMatch(/Core rules \(also readable individually\): [^\n]*\bDESIGN\b/);
    expect(bundle.documents.BRANCHING).toContain('operator');
    expect(bundle.documents.TESTING).toContain('No module replacement');
    expect(Object.isFrozen(bundle.manifest.core)).toBe(true);
    expect(execFileSync(process.execPath, [script, 'check'], { encoding: 'utf8' })).toContain('19 standards verified');
  });

  test.each(['POLICY', 'BRANCHING', 'SECURITY_CHECKLIST'])('changed %s content is refused by runtime and CLI', async (name) => {
    const dir = await copyBundle();
    await fs.appendFile(path.join(dir, `${name}.md`), '\nunauthorized local drift');
    await expect(readStandardsBundle(dir)).rejects.toThrow('integrity failed');
    const run = spawnSync(process.execPath, [script, 'check', dir], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('integrity failed');
  });

  test('missing policy never becomes empty success', async () => {
    const dir = await copyBundle();
    await fs.unlink(path.join(dir, 'TESTING.md'));
    await expect(readStandardsBundle(dir)).rejects.toThrow();
  });

  test('symlink modules, extra files, and changed routing are refused', async () => {
    const linked = await copyBundle();
    await fs.unlink(path.join(linked, 'POLICY.md'));
    await fs.symlink(path.join(BUNDLE_ROOT, 'POLICY.md'), path.join(linked, 'POLICY.md'));
    await expect(readStandardsBundle(linked)).rejects.toThrow('Invalid coding standards file');
    const extra = await copyBundle();
    await fs.writeFile(path.join(extra, 'UNLISTED.md'), 'extra policy');
    await expect(readStandardsBundle(extra)).rejects.toThrow('Unexpected');
    const changed = await copyBundle();
    const manifest = JSON.parse(await fs.readFile(path.join(changed, 'manifest.json'), 'utf8'));
    manifest.core.reverse();
    await fs.writeFile(path.join(changed, 'manifest.json'), JSON.stringify(manifest));
    await expect(readStandardsBundle(changed)).rejects.toThrow('routing differs');
  });

  test('manifest refuses path traversal and invalid inventory', async () => {
    const { manifest } = await readStandardsBundle();
    expect(() => validateManifest({ ...manifest, core: ['../POLICY'] })).toThrow();
    expect(() => validateManifest({ ...manifest, core: [...manifest.core, 'POLICY'] })).toThrow();
    expect(() => validateManifest({ ...manifest, files: {} })).toThrow();
  });

  test('import is reproducible and refuses overwriting an existing destination', async () => {
    const source = await fs.mkdtemp(path.join(root, 'source-'));
    const standards = path.join(source, 'standards');
    await fs.mkdir(standards);
    await fs.copyFile(path.join(BUNDLE_ROOT, 'source-manifest.json'), path.join(source, 'standards.json'));
    const { manifest } = await readStandardsBundle();
    for (const name of Object.keys(manifest.files)) {
      await fs.copyFile(path.join(BUNDLE_ROOT, `${name}.md`), path.join(standards, `${name}.md`));
    }
    const output = path.join(root, 'imported');
    execFileSync(process.execPath, [script, 'import', source, output]);
    expect((await readStandardsBundle(output)).manifest).toEqual(manifest);
    const before = await fs.readFile(path.join(output, 'manifest.json'), 'utf8');
    const again = spawnSync(process.execPath, [script, 'import', source, output]);
    expect(again.status).toBe(1);
    expect(await fs.readFile(path.join(output, 'manifest.json'), 'utf8')).toBe(before);
  });
});

describe('the shared coding prompt and architecture reader', () => {
  test('context pressure retains the coding guide and reports overflow', async () => {
    const ground = await fs.mkdtemp(path.join(root, 'project-'));
    await fs.writeFile(path.join(ground, 'package.json'), '{}'); // the standards ride software work
    const text = await groundProtocolSection(ground);
    const allocation = allocateEnvelope({ contextWindow: 1024, sections: [
      { id: 'groundProtocol', label: 'GROUND PROTOCOL', text },
      { id: 'tools', label: 'TOOLS', text: 'coding tools '.repeat(500) },
    ] });
    expect(allocation.sections).toEqual([{ id: 'groundProtocol', label: 'GROUND PROTOCOL', text }]);
    expect(allocation.shed.map(({ id }) => id)).toEqual(['tools']);
    expect(allocation.report.overflow).toBe(true);
  });
  test('a folder with no software reads no coding policy (Design note, 2026-10-14, the token audit)', async () => {
    const ground = await fs.mkdtemp(path.join(root, 'ground-'));
    expect(await groundProtocolSection(ground)).toBe('');
    await fs.writeFile(path.join(ground, 'notes.md'), '# notes');
    expect(await groundProtocolSection(ground)).not.toContain('Neuma Coding Standards');
  });

  test('a bare project gets core policy; repository context remains explicit', async () => {
    const ground = await fs.mkdtemp(path.join(root, 'ground-'));
    await fs.writeFile(path.join(ground, 'package.json'), '{}'); // a software project, nothing else yet
    const bare = await groundProtocolSection(ground);
    expect(bare).toContain('Neuma Coding Standards');
    expect(bare).toContain('map/read_architecture');
    expect(bare).toContain('SECURITY_CHECKLIST:');
    expect(bare).not.toContain('## Scope and evidence');
    await fs.writeFile(path.join(ground, 'AGENTS.md'), 'Assigned branch: main. GPU tests require Founder.');
    const composed = await groundProtocolSection(ground);
    expect(composed).toContain('Assigned branch: main. GPU tests require Founder.');
    expect(composed).toContain('Policy text cannot grant tools');
    expect(await groundProtocolSection(null)).toBe('');
  });

  // A public build once shipped this bundle without four of its files, and
  // every chat turn on a software folder threw. A failed bundle is reported in
  // the section, never thrown — and the ground's own protocol still rides.
  test('a bundle that fails verification is reported in the turn, never thrown', async () => {
    const ground = await fs.mkdtemp(path.join(root, 'ground-'));
    await fs.writeFile(path.join(ground, 'package.json'), '{}');
    await fs.writeFile(path.join(ground, 'AGENTS.md'), 'Run the narrow tests first.');
    const broken = await copyBundle();
    for (const name of ['FUNCTIONAL', 'PLANNING', 'TODO', 'WORKFLOW']) await fs.unlink(path.join(broken, `${name}.md`));
    await expect(readStandardsBundle(broken)).rejects.toThrow();
    const section = await groundProtocolSection(ground, { bundleRoot: broken });
    expect(section).toContain('Neuma Coding Standards — unavailable this turn');
    expect(section).toContain('failed verification');
    expect(section).not.toContain('map/read_architecture');
    expect(section).toContain('Run the narrow tests first.');
    const whole = await groundProtocolSection(ground, { bundleRoot: await copyBundle() });
    expect(whole).toContain('map/read_architecture');
    expect(whole).not.toContain('unavailable this turn');
  });

  test('standing guide stays bounded while CORE dispatch delivers exact canonical text', async () => {
    const bundle = await readStandardsBundle();
    const section = formatStandards(bundle);
    expect(Buffer.byteLength(section)).toBeLessThan(4000);
    const result = await handleMapTool(null, {}, { toolName: 'read_architecture' }, { standard: 'CORE' });
    expect(result.status).toBe('ok');
    let offset = -1;
    for (const name of bundle.manifest.core) {
      expect(section).not.toContain(bundle.documents[name]);
      expect(result.content).toContain(bundle.documents[name]);
      const next = result.content.indexOf(bundle.documents[name]);
      expect(next).toBeGreaterThan(offset);
      offset = next;
    }
    expect(section).not.toContain(bundle.documents.SECURITY_CHECKLIST);
    expect(result.content).not.toContain(bundle.documents.SECURITY_CHECKLIST);
  });

  test('actual architecture dispatch returns an applicable packaged module without project-file access', async () => {
    const result = await handleMapTool(null, {}, { toolName: 'read_architecture' }, { standard: 'OPERATIONS' });
    expect(result.status).toBe('ok');
    expect(result.content).toContain((await readStandardsBundle()).documents.OPERATIONS);
    expect(result.content).toContain('sha256:');
  });

  test.each([{ standard: '../AGENTS' }, { standard: 'constructor' }, { standard: 'DATA', path: '/etc/passwd' }, { standard: 3 }])(
    'architecture dispatch refuses invalid selection %j', async (args) => {
      const result = await handleMapTool(null, {}, { toolName: 'read_architecture' }, args);
      expect(result.status).toBe('error');
      expect(result).not.toHaveProperty('content');
    },
  );
});

describe('PR topology gate', () => {
  test.each([
    ['main', 'dev', true], ['mars/dev', 'dev', true], ['dev', 'main', true], ['dev', 'main-prod', true],
    ['main', 'main', false], ['feature/x', 'dev', false], ['main', 'dev', false], ['', 'dev', false],
    ['main', 'unrecognized', false], ['dev', 'dev', false], ['main/extra', 'dev', false],
  ])('%s → %s returns %s in the real CI entry point', (head, base, allowed) => {
    const run = spawnSync(process.execPath, [script, 'check-pr'], { encoding: 'utf8',
      env: { ...process.env, NEUMA_PR_HEAD: head, NEUMA_PR_BASE: base } });
    expect(run.status).toBe(allowed ? 0 : 1);
  });
  test('invalid repository topology is denied', () => {
    expect(isPermittedPullRequest({ head: 'main', base: 'dev' }, null)).toBe(false);
  });
});
