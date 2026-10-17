// Trainer readiness against REAL interpreters (RULE 0) — a real python that
// really lacks a module, and a real path that is not an interpreter at all.
//
// Why (2026-07-20): a forge on the GB10 ran fine and slowly, announcing it in
// one scrollable line — […] — because flash-linear-attention and
// causal-conv1d were absent. On a Qwen3.5/3.6-class base that is ~3 of every 4
// layers on a torch fallback, for the whole run. Nothing declared those
// packages and nothing checked for them.
import { describe, it, expect } from 'vitest';
import { writeFile, chmod } from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  TRAINER_PACKAGES, probeSource, probeInterpreter, readinessFrom, installCommandFor,
} from '../../backend/services/trainer-readiness.js';

describe('trainer readiness — asked of a real interpreter', () => {
  it('probes the running interpreter and reports what it actually has', async () => {
    // node's own python is not guaranteed; use the system python3 and assert on
    // the SHAPE of its honest answer, not on a particular rig's packages.
    const probe = await probeInterpreter('python3');
    if (!probe.ran) {
      expect(probe.error).toBeTruthy(); // no python3 here — still an honest answer
      return;
    }
    for (const p of TRAINER_PACKAGES) expect(p.module in probe.found).toBe(true);
    // json/importlib exist everywhere, so a ran-probe must have real values
    expect(Object.values(probe.found).some((v) => v === null || typeof v === 'string')).toBe(true);
  }, 60000);

  it('a path that is not an interpreter fails honestly, and names every package', async () => {
    const dir = await createTempDir('trainer-noninterp');
    const notPython = path.join(dir, 'not-python');
    await writeFile(notPython, '#!/bin/sh\nexit 127\n');
    await chmod(notPython, 0o755);

    const probe = await probeInterpreter(notPython);
    expect(probe.ran).toBe(false);

    const verdict = readinessFrom(probe, notPython);
    expect(verdict.ready).toBe(false);
    expect(verdict.interpreterOk).toBe(false);
    expect(verdict.error).toMatch(/could not be run/);
    expect(verdict.missing.length).toBe(TRAINER_PACKAGES.length);
    expect(verdict.installCommand).toBeTruthy();
  }, 60000);

  it('separates CANNOT-RUN from RUNS-SLOWLY — the quiet failure gets its own tier', () => {
    // torch present, the linear-attention kernels absent: the forge works and
    // silently crawls. That must not read as "ready" with nothing said.
    const probe = {
      ran: true,
      found: {
        torch: '2.13.0', transformers: '5.14.1', peft: '0.19.1', accelerate: '1.14.0',
        safetensors: '0.8.0', bitsandbytes: '0.49.2',
        einops: null, fla: null, causal_conv1d: null,
      },
      error: null,
    };
    const v = readinessFrom(probe, '/venv/bin/python');
    expect(v.ready).toBe(true);              // it CAN forge
    expect(v.missing).toEqual([]);           // nothing hard is absent
    expect(v.degraded.map((d) => d.pip).sort())
      .toEqual(['causal-conv1d', 'einops', 'flash-linear-attention']);
    expect(v.installCommand).toContain('flash-linear-attention');
    // causal-conv1d compiles — it must not be folded into a command that would
    // fail as a whole, so it gets its own line with its build env
    expect(v.installCommand).toContain('CAUSAL_CONV1D_FORCE_BUILD=TRUE');
  });

  it('a missing hard package blocks the forge and says which', () => {
    const probe = {
      ran: true,
      found: {
        torch: null, transformers: '5.14.1', peft: null, accelerate: '1.14.0',
        safetensors: '0.8.0', bitsandbytes: null, einops: '0.8.2', fla: '0.5.1', causal_conv1d: 'present',
      },
      error: null,
    };
    const v = readinessFrom(probe, '/venv/bin/python');
    expect(v.ready).toBe(false);
    expect(v.missing.map((m) => m.pip).sort()).toEqual(['bitsandbytes', 'peft', 'torch']);
    expect(v.degraded).toEqual([]);
    // every refusal carries WHY, so the operator is never left guessing
    for (const m of v.missing) expect(m.why.length).toBeGreaterThan(10);
  });

  it('a fully equipped rig is ready with nothing degraded', () => {
    const found = Object.fromEntries(TRAINER_PACKAGES.map((p) => [p.module, '1.0.0']));
    const v = readinessFrom({ ran: true, found, error: null }, '/venv/bin/python');
    expect(v.ready).toBe(true);
    expect(v.degraded).toEqual([]);
    expect(v.installCommand).toBeNull();
  });

  it('the probe source imports every declared package and never throws out', () => {
    const src = probeSource(['torch', 'fla']);
    expect(src).toContain('importlib.import_module');
    expect(src).toContain('except Exception');
    expect(src).toContain('json.dumps');
  });

  it('installCommandFor keeps compiled packages on their own line', () => {
    const cmd = installCommandFor(TRAINER_PACKAGES);
    const lines = cmd.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain('python3 -m pip install');
    expect(lines.some((l) => l.includes('causal-conv1d') && l.includes('--no-build-isolation'))).toBe(true);
  });

  it('installCommandFor names the interpreter the forge runs, never a venv it may not have', () => {
    const cmd = installCommandFor(TRAINER_PACKAGES.filter((p) => p.severity === 'speed'), '/usr/bin/python3');
    expect(cmd).not.toContain('trainer-venv');
    expect(cmd).toContain('/usr/bin/python3 -m pip install einops flash-linear-attention');
    // a no-isolation build needs its build tools in that same interpreter first
    expect(cmd).toContain('/usr/bin/python3 -m pip install wheel ninja && CAUSAL_CONV1D_FORCE_BUILD=TRUE MAX_JOBS=8 /usr/bin/python3 -m pip install causal-conv1d --no-build-isolation');
  });
});
