import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { openCdpPipe } from '../../backend/services/browser/cdp-pipe.js';

describe('PR20 F-04: CDP input is bounded', () => {
  test('an oversized unterminated message closes the child and rejects the call', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cdp-limit-'));
    const script = path.join(root, 'flood.cjs');
    await fs.writeFile(script, `const fs = require('node:fs');\nconst out = fs.createWriteStream(null, { fd: 4 });\nout.write('a'.repeat(8 * 1024 * 1024 + 32));\n`);
    const pipe = openCdpPipe(process.execPath, [script], {});
    try {
      const exited = new Promise((resolve) => pipe.events.once('exit', resolve));
      await expect(pipe.send('Runtime.evaluate')).rejects.toThrow(/exceeded|closed/);
      await exited;
      expect(pipe.isClosed()).toBe(true);
    } finally {
      pipe.kill();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 15000);
});
