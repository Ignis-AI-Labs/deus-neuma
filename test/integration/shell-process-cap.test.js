// Real kernel thread creation through the production bwrap runner; no test pool.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from 'vitest';
import workspace, { getWitnessesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { ensureWitnessCodingSandbox, runWitnessCommand } from '../../backend/services/witness-coding-sandbox.js';

const THREADS = 320;
const program = `
import threading
threading.stack_size(256 * 1024)
release = threading.Event()
threads = []
try:
    for _ in range(${THREADS}):
        thread = threading.Thread(target=release.wait)
        thread.start()
        threads.append(thread)
    assert all(thread.is_alive() for thread in threads)
    print("threads=" + str(len(threads)))
finally:
    release.set()
    for thread in threads:
        thread.join(5)
    assert all(not thread.is_alive() for thread in threads)
`;

test('the production shell can create more than 256 concurrent threads under a bounded limit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-process-cap-'));
  const previous = getWitnessesRoot();
  const lane = 'witness-test-ProcessCap';
  try {
    setWitnessesRoot(path.join(root, 'witnesses'));
    await workspace.create(lane);
    const ground = path.join(root, 'ground');
    await fs.mkdir(ground);
    await fs.writeFile(path.join(ground, 'threads.py'), program);
    const sandbox = await ensureWitnessCodingSandbox(lane, ground);
    const result = await runWitnessCommand({ ...sandbox, mode: 'inspect',
      command: 'MALLOC_ARENA_MAX=2 python3 threads.py', timeoutMs: 15000 });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(`threads=${THREADS}`);
    const limits = await runWitnessCommand({ ...sandbox, mode: 'inspect',
      command: 'printf "%s %s" "$(ulimit -Su)" "$(ulimit -Hu)"' });
    expect(limits.exitCode, limits.stderr).toBe(0);
    expect(limits.stdout).toBe('4096 4096');
  } finally {
    setWitnessesRoot(previous);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
