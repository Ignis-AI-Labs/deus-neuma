// bench-recovery.test.js — the recovery wave's proofs, split from
// bench-read-models.test.js under the 500-line law: the gpu leg (real
// execFile through a PATH shim, the sibling's window-stall idiom), the
// driver-down judge, and the relight verb's argv + spawn mechanics. All real:
// a shim binary is a real file the probe really executes; spawn mechanics run
// real throwaway children; no mock, stub, fake, or spy anywhere.

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createTempDir } from '../helpers/temp-fs.js';
import { probeGpu, parseGpuLine, pidAlive } from '../../backend/services/bench/bench-status.js';
import { judgeDriverDown } from '../../backend/services/bench/bench-watchdog.js';
import { startViaSpawn } from '../../backend/services/bench/bench-relight.js';
import { buildArgs, VERBS } from '../../backend/services/bench/bench-launch.js';

// The REAL nvidia-smi answer captured on this box (2026-09-23, driver
// 610.57.04) — the gpu leg's fixture.
const NVIDIA_SMI_LINE = readFileSync(path.resolve('test/fixtures/bench/nvidia-smi.txt'), 'utf8').trim();
describe('gpu leg — the driver probe, real execFile through a PATH shim', () => {
  it('parseGpuLine reads the REAL captured line; malformed answers read null', () => {
    expect(parseGpuLine(NVIDIA_SMI_LINE)).toEqual({
      ok: true,
      name: 'NVIDIA RTX PRO 6000 Blackwell Workstation Edition',
      utilizationPercent: 100,
      memoryUsedMiB: 59331,
    });
    expect(parseGpuLine('')).toBeNull();
    expect(parseGpuLine('garbage,not-a-number,x')).toBeNull();
    expect(parseGpuLine(', 50, 1000')).toBeNull();
  });

  it('probeGpu — success through a real shim binary answering the fixture line', async () => {
    const shim = await createTempDir('bench-gpu-shim');
    await fs.writeFile(
      path.join(shim, 'nvidia-smi'),
      `#!/bin/sh\nprintf '%s\\n' '${NVIDIA_SMI_LINE}'\n`,
      { mode: 0o755 },
    );
    const probe = await probeGpu({ PATH: shim });
    expect(probe.ok).toBe(true);
    expect(probe.name).toBe('NVIDIA RTX PRO 6000 Blackwell Workstation Edition');
    expect(probe.utilizationPercent).toBe(100);
    expect(probe.memoryUsedMiB).toBe(59331);
  });

  it('probeGpu — no nvidia-smi on PATH reads {ok:false}, never throws', async () => {
    const bare = await createTempDir('bench-gpu-bare');
    const probe = await probeGpu({ PATH: bare });
    expect(probe.ok).toBe(false);
    expect(typeof probe.error).toBe('string');
  });
});

describe('driver-down leg — the judge, pure', () => {
  const down = { ok: false, error: 'connect ECONNREFUSED 127.0.0.1:8089' };
  const gpuDead = { ok: false, error: 'spawn nvidia-smi ENOENT' };
  const gpuLive = { ok: true, name: 'NVIDIA RTX PRO 6000', utilizationPercent: 100, memoryUsedMiB: 59331 };

  it('serving down AND driver silent → escalated fire naming the truth', () => {
    const fire = judgeDriverDown(down, gpuDead);
    expect(fire.condition).toBe('driver-down');
    expect(fire.severity).toBe('escalated');
    expect(fire.detail).toContain('module reload or clean reboot');
    expect(fire.detail).toContain('relight is pointless into a dead driver');
  });

  it('serving down with a healthy driver is NOT driver-down (the watchdog owns that)', () => {
    expect(judgeDriverDown(down, gpuLive)).toBeNull();
    expect(judgeDriverDown({ ok: true, models: ['qwen3.8-27b'] }, gpuDead)).toBeNull();
    expect(judgeDriverDown({ ok: true, models: [] }, gpuLive)).toBeNull();
  });
});

describe('relight-serving — the recovery verb', () => {
  it('buildArgs — fixed swap argv; unknown or absent model refused', () => {
    expect(buildArgs('relight-serving', { model: 'qwen3.8-27b' }, { modelKeys: ['qwen3.8-27b'] }))
      .toEqual({ ok: true, argv: ['scripts/swap-model.mjs', 'qwen3.8-27b'] });
    expect(buildArgs('relight-serving', { model: 'gpt-5' }, { modelKeys: ['qwen3.8-27b'] }).reason)
      .toContain('unregistered model');
    expect(buildArgs('relight-serving', {}, { modelKeys: ['qwen3.8-27b'] }).ok).toBe(false);
    expect(VERBS).toContain('relight-serving');
  });

  it('startViaSpawn — a real detached child: settles resident, journals, never plane-owned', async () => {
    const dir = await createTempDir('bench-relight-spawn');
    const daemon = { name: 'probe', logRel: 'probe-daemon.log' };
    const outcome = await startViaSpawn(dir, daemon, ['-e', 'setInterval(()=>{},1000)']);
    expect(outcome.ok).toBe(true);
    expect(outcome.via).toBe('spawn');
    expect(Number.isInteger(outcome.pid)).toBe(true);
    try {
      expect(pidAlive(outcome.pid)).toBe(true); // a real resident child on the real process table
      expect(readFileSync(path.join(dir, 'probe-daemon.log'), 'utf8')).toBe('');
    } finally {
      process.kill(outcome.pid, 'SIGTERM'); // ours — reaped for real
    }
  }, 20000);

  it('startViaSpawn — an instantly-dying child reads as a failed relight, not a pid', async () => {
    const dir = await createTempDir('bench-relight-die');
    const outcome = await startViaSpawn(dir, { name: 'probe', logRel: 'probe.log' }, ['-e', 'process.exit(7)']);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('exited immediately (code 7)');
    expect(outcome.error).toContain('probe.log');
  }, 20000);
});
