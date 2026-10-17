/** Real kernel overlay, real native filesystem hand, actual shared result renderer. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import workspace, { getWitnessesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { ensureWitnessCodingSandbox, runWitnessCommand } from '../../backend/services/witness-coding-sandbox.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { renderCommandResult } from '../../backend/services/coding-result.js';

test.each(['existing', 'absent'])('write-mode exit zero discloses overlay containment: %s target', async target => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-overlay-receipt-'));
  const prior = getWitnessesRoot();
  const source = path.join(root, 'source');
  try {
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'kept.txt'), 'live bytes remain');
    setWitnessesRoot(path.join(root, 'witnesses'));
    await workspace.create('witness-receipt-proof');
    const sandbox = await ensureWitnessCodingSandbox('witness-receipt-proof', source);
    const command = target === 'existing' ? 'rm -rf kept.txt' : 'rm -rf /nonexistent/receipt-proof';
    const result = await runWitnessCommand({ ...sandbox, command, mode: 'write' });
    expect(result.exitCode).toBe(0);
    expect(await fs.readFile(path.join(source, 'kept.txt'), 'utf8')).toBe('live bytes remain');
    await setNativeFilesystemRoots([source]);
    const hand = await nativeFilesystemClient.callTool({ name: 'read_text_file', arguments: { path: path.join(source, 'kept.txt') } });
    expect(hand.isError).not.toBe(true);
    expect(hand.content.map(block => block.text).join('')).toContain('live bytes remain');
    const shellRead = await runWitnessCommand({ ...sandbox, command: 'test -f kept.txt', mode: 'inspect' });
    expect(shellRead.exitCode).toBe(target === 'existing' ? 1 : 0);
    expect(renderCommandResult(shellRead)).not.toContain('[overlay]');
    const rendered = renderCommandResult(result);
    expect(rendered).toContain('[overlay]');
    expect(rendered).toContain('the live folder is unchanged');
    expect(rendered).toContain('Exit 0 alone does not prove a path existed or changed');
    expect(rendered.indexOf('[overlay]')).toBeLessThan(rendered.indexOf('stdout:'));
  } finally {
    setWitnessesRoot(prior);
    await setNativeFilesystemRoots([]);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);

test('inspect and progress output retain the existing format', () => {
  const result = { exitCode: 0, timedOut: false, truncated: false, stdout: 'read', stderr: '' };
  const expected = 'exit_code: 0\ntimed_out: false\noutput_truncated: false\nstdout:\nread\nstderr: (empty)';
  expect(renderCommandResult(result)).toBe(expected);
  expect(renderCommandResult({ ...result, mode: 'inspect' })).toBe(expected);
});
