/** #516: requested replacement bytes survive JavaScript dollar-token syntax. */
import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyEdit } from '../../backend/services/edit-primitive.js';
import { runPlatformHand } from '../../backend/services/platform-hands.js';
import { UNDO_SUBDIR } from '../../backend/services/edit-undo.js';

const TOKENS = Object.freeze(['$$', '$&', '$`', "$'", '$1 $<name>']);
for (const token of TOKENS) {
  test(`single replacement inserts ${JSON.stringify(token)} literally`, () => {
    expect(applyEdit({ content: 'before TARGET after', oldString: 'TARGET', newString: token }).nextContent)
      .toBe(`before ${token} after`);
  });
  test(`replace-all inserts ${JSON.stringify(token)} literally at both anchors`, () => {
    expect(applyEdit({ content: 'TARGET + TARGET', oldString: 'TARGET', newString: token, replaceAll: true }).nextContent)
      .toBe(`${token} + ${token}`);
  });
}

for (const [name, bom, eol] of [['LF', '', '\n'], ['BOM and CRLF', '\uFEFF', '\r\n']]) {
  test(`real edit hand preserves literal bytes and undo with ${name}`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-literal-edit-'));
    try {
      await fs.mkdir(path.join(root, '.git'));
      const target = path.join(root, 'source.js');
      const before = `${bom}before${eol}TARGET${eol}after${eol}`;
      const replacement = TOKENS.join('\n');
      const expected = `${bom}before${eol}${TOKENS.join(eol)}${eol}after${eol}`;
      await fs.writeFile(target, before);
      const args = { path: target, edits: [{ oldText: 'TARGET', newText: replacement }] };
      const dry = await runPlatformHand('edit_file', { ...args, dryRun: true });
      expect(dry.ok).toBe(true);
      expect(await fs.readFile(target, 'utf8')).toBe(before);
      const undo = path.join(root, UNDO_SUBDIR);
      await expect(fs.access(undo)).rejects.toMatchObject({ code: 'ENOENT' });

      const result = await runPlatformHand('edit_file', args);
      expect(result.ok).toBe(true);
      expect(await fs.readFile(target, 'utf8')).toBe(expected);
      const snapshots = (await fs.readdir(undo)).filter((file) => file.endsWith('.json'));
      expect(snapshots).toHaveLength(1);
      const snapshot = JSON.parse(await fs.readFile(path.join(undo, snapshots[0]), 'utf8'));
      expect(snapshot.path).toBe(target);
      expect(snapshot.preEditContent).toBe(before);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
}
