// THE OPEN FOLDER on AUTO — the rules (open-folder-autonomy.js), with real
// paths, a real symlink on a real temp folder, and no mock. The live shell itself is proven in
// test/integration/open-folder-live-shell.test.js; the gate in
// test/integration/chat-mode-variations.test.js.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vitest';
import { isLiveShell, landsInOpenFolder } from '../../backend/services/open-folder-autonomy.js';

const ground = path.resolve('/srv/work/repo');

describe('landsInOpenFolder — a delete AUTO lets land without a card', () => {
  test('an absolute path inside the open folder, at any depth', () => {
    expect(landsInOpenFolder({ server: 'filesystem', tool: 'delete_file', args: { path: `${ground}/docs/old.md` }, ground })).toBe(true);
    expect(landsInOpenFolder({ server: 'filesystem', tool: 'delete_file', args: { path: `${ground}/a/b/c.txt` }, ground })).toBe(true);
  });

  test('never a relative path, a sibling sharing the name, a climb out, or no open folder', () => {
    const del = (p, g = ground) => landsInOpenFolder({ server: 'filesystem', tool: 'delete_file', args: { path: p }, ground: g });
    expect(del('docs/old.md')).toBe(false);
    expect(del('/srv/work/repo-backup/x.md')).toBe(false);
    expect(del(`${ground}/../other/x.md`)).toBe(false);
    expect(del(`${ground}/x.md`, null)).toBe(false);
    expect(del(`${ground}/x.md`, '')).toBe(false);
  });

  test('a symlink in the open folder pointing elsewhere keeps its card; one pointing inside does not', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-folder-link-'));
    try {
      const open = path.join(dir, 'repo');
      fs.mkdirSync(path.join(open, 'docs'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'elsewhere'));
      fs.writeFileSync(path.join(dir, 'elsewhere', 'precious.md'), 'keep\n');
      fs.symlinkSync(path.join(dir, 'elsewhere'), path.join(open, 'out'));
      fs.symlinkSync(path.join(open, 'docs'), path.join(open, 'in'));
      const del = (p) => landsInOpenFolder({ server: 'filesystem', tool: 'delete_file', args: { path: p }, ground: open });
      expect(del(path.join(open, 'out', 'precious.md'))).toBe(false);
      expect(del(path.join(open, 'in', 'old.md'))).toBe(true);
      expect(del(path.join(open, 'docs', 'not-yet', 'x.md'))).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('only deletes — every other act keeps its own rule', () => {
    expect(landsInOpenFolder({ server: 'intents', tool: 'wallet.send', args: { path: `${ground}/x` }, ground })).toBe(false);
    expect(landsInOpenFolder({ server: 'filesystem', tool: 'write_file', args: { path: `${ground}/x` }, ground })).toBe(false);
  });
});

describe('isLiveShell — the shell works on the folder itself', () => {
  test('AUTO, standing in the open folder (path spellings agree)', () => {
    expect(isLiveShell({ mode: 'auto', sourceRoot: `${ground}/`, ground })).toBe(true);
    expect(isLiveShell({ mode: 'auto', sourceRoot: `${ground}/docs/..`, ground })).toBe(true);
  });
  test('never ASK or observe, never another ground, never without one', () => {
    expect(isLiveShell({ mode: 'ask', sourceRoot: ground, ground })).toBe(false);
    expect(isLiveShell({ mode: 'observe', sourceRoot: ground, ground })).toBe(false);
    expect(isLiveShell({ mode: 'auto', sourceRoot: '/srv/house/lane-ground', ground })).toBe(false);
    expect(isLiveShell({ mode: 'auto', sourceRoot: ground, ground: undefined })).toBe(false);
  });
});
