// capacity-view.test.js — the TEAMS banner speaks for the substrate AS
// CONFIGURED (loaded model + loaded ctx), never for "the rig" in the abstract.
import { describe, it, expect } from 'vitest';
import { fmtCtx, capacityBanner } from '../../frontend/app/RelinkShell/capacity-view.js';

const latestOn = (model, ceiling = 4) => ({ ceiling, substrate: { model } });

describe('fmtCtx (pure)', () => {
  it('renders loaded context for humans', () => {
    expect(fmtCtx(131072)).toBe('128K CTX');
    expect(fmtCtx(65536)).toBe('64K CTX');
    expect(fmtCtx(512)).toBe('512 CTX');
  });

  it('refuses to invent a context it was not given', () => {
    expect(fmtCtx(null)).toBeNull();
    expect(fmtCtx(0)).toBeNull();
    expect(fmtCtx(undefined)).toBeNull();
  });
});

describe('capacityBanner (pure)', () => {
  it('a matching scan names the loaded model, its context, and the measured width', () => {
    const b = capacityBanner({
      latest: latestOn('qwen3.5-122b-a10b', 3),
      current: { model: 'qwen3.5-122b-a10b', contextWindow: 131072 },
      measurable: true,
    });
    expect(b.line).toBe('QWEN3.5-122B-A10B · 128K CTX — RUNS UP TO 3 IN PARALLEL (MEASURED)');
    expect(b.stale).toBe(false);
  });

  it('a scan taken on a DIFFERENT model is presented as stale, never as truth', () => {
    const b = capacityBanner({
      latest: latestOn('qwen3.5-122b-a10b', 3),
      current: { model: 'gemma-4-31b-qat', contextWindow: 65536 },
      measurable: true,
    });
    expect(b.line).toBe('GEMMA-4-31B-QAT · 64K CTX — CEILING 3 WAS MEASURED ON QWEN3.5-122B-A10B · RE-SCAN IN RECORD');
    expect(b.stale).toBe(true);
  });

  it('a scan CARRIED from another model (never scanned on this one) stands, named — no re-scan asked', () => {
    const b = capacityBanner({
      latest: { ...latestOn('qwen3.5-122b-a10b', 3), carriedFrom: 'qwen3.5-122b-a10b' },
      current: { model: 'gemma-4-31b-qat', contextWindow: 65536 },
      measurable: true,
    });
    expect(b.line).toBe('GEMMA-4-31B-QAT · 64K CTX — RUNS UP TO 3 IN PARALLEL (MEASURED WITH QWEN3.5-122B-A10B)');
    expect(b.stale).toBe(false);
  });

  it('no scan yet: the loaded model is still named, and the gap is honest', () => {
    const b = capacityBanner({
      latest: null,
      current: { model: 'gemma-4-31b-qat', contextWindow: null },
      measurable: true,
    });
    expect(b.line).toBe('GEMMA-4-31B-QAT — CAPACITY NOT MEASURED · RUN A SCAN IN RECORD');
    expect(b.stale).toBe(false);
  });

  it('nothing known at all: the original honest fallback', () => {
    expect(capacityBanner({ latest: null, current: null, measurable: true }).line)
      .toBe('CAPACITY NOT MEASURED — RUN A SCAN IN RECORD');
  });

  it('a quiet provider cannot prove staleness: the ceiling stands, tied to the model that earned it', () => {
    const b = capacityBanner({ latest: latestOn('qwen3.5-122b-a10b', 3), current: null, measurable: true });
    expect(b.line).toBe('QWEN3.5-122B-A10B — RUNS UP TO 3 IN PARALLEL (MEASURED)');
    expect(b.stale).toBe(false);
  });

  it('a remote provider is named as not measurable, never given a fake width', () => {
    const b = capacityBanner({ latest: null, current: { model: 'gpt-4o-mini' }, measurable: false });
    expect(b.line).toBe('GPT-4O-MINI — REMOTE PROVIDER · CAPACITY NOT MEASURABLE');
  });

  it('a failed capacity read is an unknown, not a guess', () => {
    expect(capacityBanner(null).line).toBe('CAPACITY UNKNOWN — THE PLATFORM DID NOT ANSWER');
  });
});
