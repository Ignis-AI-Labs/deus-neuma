import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { installLinuxDependencies } from '../../scripts/release/linux-dependencies.mjs';

const dirs = [];
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'pipe' });
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-dependencies-'));
  dirs.push(root);
  const dep = path.join(root, 'dep');
  const work = path.join(root, 'work');
  fs.mkdirSync(dep);
  fs.mkdirSync(work);
  fs.writeFileSync(path.join(dep, 'package.json'), JSON.stringify({ name: 'release-local-dependency', version: '1.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(dep, 'index.js'), 'module.exports = "locked public dependency";\n');
  fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'release-fixture', version: '1.0.0', dependencies: { 'release-local-dependency': 'file:../dep' } }));
  run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], work);
  run('git', ['init', '-q'], work);
  run('git', ['config', 'user.email', 'release-fixture@example.invalid'], work);
  run('git', ['config', 'user.name', 'Release fixture'], work);
  run('git', ['add', 'package.json', 'package-lock.json'], work);
  run('git', ['commit', '-qm', 'locked public fixture'], work);
  return { root, work, source: run('git', ['rev-parse', 'HEAD'], work).toString().trim() };
};
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

describe('the real Linux dependency installation boundary', () => {
  it('removes planted private bytes and installs exactly the public lock', () => {
    const { work, source } = fixture();
    fs.mkdirSync(path.join(work, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(work, 'node_modules', 'private-only.txt'), 'not public');
    installLinuxDependencies({ work, source });
    expect(fs.existsSync(path.join(work, 'node_modules', 'private-only.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(work, 'node_modules', 'release-local-dependency', 'index.js'), 'utf8')).toBe('module.exports = "locked public dependency";\n');
  });

  it('refuses a broken public lock instead of falling back to private dependencies', () => {
    const { work } = fixture();
    fs.writeFileSync(path.join(work, 'package-lock.json'), '{broken lock');
    run('git', ['add', 'package-lock.json'], work);
    run('git', ['commit', '-qm', 'broken lock'], work);
    const source = run('git', ['rev-parse', 'HEAD'], work).toString().trim();
    expect(() => installLinuxDependencies({ work, source })).toThrow();
    expect(fs.existsSync(path.join(work, 'node_modules', 'private-only.txt'))).toBe(false);
  });
});
