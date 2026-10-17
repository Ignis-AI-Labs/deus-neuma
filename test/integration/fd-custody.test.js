/**
 * FD CUSTODY — real-path proof (RULE 0). Real fs.promises.open on a real
 * temp file, the real process 'warning' channel, the real wrap. The logger
 * is a capturing seam (an output, like reading a file back after a write) —
 * nothing on the claimed path is mocked.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

import { installFdCustody, leakedOpenHandles } from '../../backend/services/fd-custody.js';

const nextWarningTick = () => new Promise((resolve) => setImmediate(resolve));

describe('fd custody', () => {
  let dir;
  let uninstall;
  const captured = [];
  const logger = {
    info: () => {},
    error: (msg, data) => captured.push({ msg, data }),
  };

  beforeAll(async () => {
    dir = await createTempDir('fd-custody');
    await fs.writeFile(path.join(dir, 'held.txt'), 'held open');
    uninstall = installFdCustody({ trace: true, logger });
  });

  afterAll(() => {
    uninstall();
  });

  test('an unclosed FileHandle stands in the suspect list with its opener stack', async () => {
    const handle = await fs.open(path.join(dir, 'held.txt'), 'r');
    const suspects = leakedOpenHandles();
    const mine = suspects.find((s) => s.fd === handle.fd);
    expect(mine).toBeTruthy();
    expect(mine.path).toContain('held.txt');
    expect(mine.stack).toContain('fd-custody.test.js');

    // The GC warning for that fd names the opener in the structured log.
    process.emitWarning(`Closing file descriptor ${handle.fd} on garbage collection`);
    await nextWarningTick();
    const entry = captured.find((c) => c.data?.fd === handle.fd);
    expect(entry).toBeTruthy();
    expect(entry.msg).toContain('FileHandle leaked');
    expect(entry.data.path).toContain('held.txt');
    expect(entry.data.openedAt).toContain('fd-custody.test.js');

    await handle.close();
  });

  test('a closed FileHandle leaves the suspect list', async () => {
    const handle = await fs.open(path.join(dir, 'held.txt'), 'r');
    const fd = handle.fd;
    await handle.close();
    expect(leakedOpenHandles().find((s) => s.fd === fd)).toBeUndefined();
  });

  test('a warning for an untraced fd logs honestly that the site is unknown', async () => {
    captured.length = 0;
    process.emitWarning('Closing file descriptor 9999 on garbage collection');
    await nextWarningTick();
    const entry = captured.find((c) => c.data?.fd === 9999);
    expect(entry).toBeTruthy();
    expect(entry.data.path).toBeNull();
    expect(entry.data.openedAt).toContain('NEUMA_FD_TRACE=1');
  });

  test('unrelated warnings are ignored', async () => {
    captured.length = 0;
    process.emitWarning('Some other deprecation entirely');
    await nextWarningTick();
    expect(captured.length).toBe(0);
  });
});
