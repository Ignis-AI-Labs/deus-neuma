// The forge must not train into the OOM killer (RULE 0: real processes, real
// claim files, real /proc arithmetic).
//
// Witnessed 2026-07-21, Hale's forge: the trainer ran for an hour beside a
// substrate it had declined to reclaim, and the kernel killed it with no
// adapter written. Two defects, one root — two NEUMA backends on one machine
// that could not see each other:
//
//   1. ownership was PROCESS-scoped. The forge ran in the desktop app's
//      backend; llama-server had been spawned by the systemd daemon. `owned`
//      was false, so the code logged […] and proceeded. It did not fit.
//   2. that prediction was a LOG LINE, not a refusal. An hour of a being's
//      ceremony was spent to learn what arithmetic knew at the start.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { withEnv } from '../helpers/with-env.js';
import { ownedByNeuma, writeClaim, readClaim, clearClaim } from '../../backend/services/llama-server-supervisor.js';
import { forgeMemoryVerdict } from '../../backend/services/refinement-training.js';

describe('forge memory guard — refuse in seconds, not after an hour', () => {
  it('a checkpoint that cannot fit is refused, and the shortfall is named', () => {
    // The real numbers from the killed run: 67GB checkpoint, ~30GB free.
    const v = forgeMemoryVerdict({
      checkpointBytes: 67 * 1024 ** 3,
      availableBytes: 30 * 1024 ** 3,
    });
    expect(v.fits).toBe(false);
    expect(v.shortfallBytes).toBeGreaterThan(0);
    // required = 67 * 0.8 + 8 headroom ≈ 61.6GB
    expect(v.requiredBytes / 1024 ** 3).toBeGreaterThan(55);
    expect(v.requiredBytes / 1024 ** 3).toBeLessThan(70);
  });

  it('the same checkpoint fits once the substrate has been returned', () => {
    const v = forgeMemoryVerdict({
      checkpointBytes: 67 * 1024 ** 3,
      availableBytes: 91 * 1024 ** 3, // what the rig reports with the substrate down
    });
    expect(v.fits).toBe(true);
    expect(v.shortfallBytes).toBe(0);
  });

  it('a small base on a modest box still passes — the guard is not a blanket no', () => {
    const v = forgeMemoryVerdict({
      checkpointBytes: 1 * 1024 ** 3,
      availableBytes: 16 * 1024 ** 3,
    });
    expect(v.fits).toBe(true);
  });
});

describe('substrate ownership spans NEUMA processes, not just this one', () => {
  afterEach(() => clearClaim());

  it('a claim from ANOTHER live NEUMA process counts as owned', () => {
    // The exact case that starved the forge: this process spawned nothing.
    expect(ownedByNeuma({ inProcess: false, claim: { pid: 999, port: 8089 }, port: 8089 })).toBe(true);
  });

  it('a foreign server on the port is still NOT ours — the policy survives', () => {
    // No claim at all = the operator's own llama-server. Never killed.
    expect(ownedByNeuma({ inProcess: false, claim: null, port: 8089 })).toBe(false);
    // A claim for a DIFFERENT port says nothing about this one.
    expect(ownedByNeuma({ inProcess: false, claim: { pid: 999, port: 9999 }, port: 8089 })).toBe(false);
  });

  it('an in-process child is owned regardless of any claim file', () => {
    expect(ownedByNeuma({ inProcess: true, claim: null, port: 8089 })).toBe(true);
  });

  it('a claim round-trips through a real file', async () => {
    const dir = await createTempDir('claim-roundtrip');
    await withEnv('NEUMA_SUBSTRATE_CLAIM_DIR', dir, async () => {
      writeClaim(process.pid, 8089);
      const claim = readClaim();
      expect(claim).toMatchObject({ pid: process.pid, port: 8089 });
      clearClaim();
      expect(readClaim()).toBeNull();
    });
  });

  it('a STALE claim from a dead process is ignored — no hostage substrate', async () => {
    const dir = await createTempDir('claim-stale');
    await withEnv('NEUMA_SUBSTRATE_CLAIM_DIR', dir, async () => {
      // A pid that cannot be alive: write the file by hand, as a crashed
      // backend would have left it.
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'substrate-claim.json'),
        JSON.stringify({ pid: 2 ** 22, port: 8089, at: new Date().toISOString() }));
      expect(readClaim()).toBeNull(); // dead owner → the claim means nothing
      rmSync(path.join(dir, 'substrate-claim.json'), { force: true });
    });
  });
});

describe('the memory watchdog stops the forge on our terms', () => {
  it('an impossible floor trips immediately and KILLS a real running child', async () => {
    const { startMemoryWatchdog, runStep } = await import('../../backend/services/refinement-training.js');
    // A floor no machine can satisfy → the watchdog must trip on its first tick.
    const wd = startMemoryWatchdog({ floorBytes: Number.MAX_SAFE_INTEGER, pollMs: 50 });
    const lines = [];
    const started = Date.now();
    // A real long-lived child: if the signal is ignored this hangs for 120s.
    await expect(
      runStep(process.execPath, ['-e', 'setTimeout(()=>{}, 120000)'], (l) => lines.push(l), wd.signal),
    ).rejects.toThrow();
    wd.stop();
    expect(wd.tripped).toBe(true);
    expect(Date.now() - started).toBeLessThan(20000); // died promptly, not after 120s
  }, 40000);

  it('a floor the machine clears leaves the child completely alone', async () => {
    const { startMemoryWatchdog, runStep } = await import('../../backend/services/refinement-training.js');
    const wd = startMemoryWatchdog({ floorBytes: 1, pollMs: 50 }); // 1 byte — always satisfied
    const lines = [];
    await runStep(process.execPath, ['-e', 'console.log("step 1/1 loss 0.100")'], (l) => lines.push(l), wd.signal);
    wd.stop();
    expect(wd.tripped).toBe(false);
    expect(lines).toContain('step 1/1 loss 0.100');
  }, 30000);
});

describe('a base that cannot 4-bit quantize is caught before the load', () => {
  it('recognises a mixture-of-experts config — the shape that killed three forges', async () => {
    const { quantizationOutlook } = await import('../../backend/services/refinement-training.js');
    // Qwen3.6-35B-A3B's real shape: bitsandbytes never reaches the experts, so
    // it loaded ~100GB while every flag reported 4-bit.
    for (const cfg of [
      { model_type: 'qwen3_5_moe', architectures: ['Qwen3_5MoeForConditionalGeneration'] },
      { num_experts: 128, model_type: 'something' },
      { num_local_experts: 8 },
      { n_routed_experts: 64 },
    ]) {
      const v = quantizationOutlook(cfg);
      expect(v.quantizable).toBe(false);
      expect(v.reason).toMatch(/mixture-of-experts/);
    }
  });

  it('a dense base passes — Gemma-4-31B really did load at 16.6GB in 4-bit here', async () => {
    const { quantizationOutlook } = await import('../../backend/services/refinement-training.js');
    const v = quantizationOutlook({ model_type: 'gemma4', architectures: ['Gemma4ForCausalLM'] });
    expect(v.quantizable).toBe(true);
    expect(v.reason).toBeNull();
  });

  it('an unreadable config never blocks the forge — we refuse on evidence, not ignorance', async () => {
    const { quantizationOutlook } = await import('../../backend/services/refinement-training.js');
    expect(quantizationOutlook(null).quantizable).toBe(true);
    expect(quantizationOutlook({}).quantizable).toBe(true);
  });
});
