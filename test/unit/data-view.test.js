// data-view — pure status-derivation for the DATA custody panel. The interactive
// surface is e2e-covered; these are the honest label/tone decisions that tell the
// witness whether a being's data is well-kept.
import { describe, expect, it } from 'vitest';
import { securedTag, recoveryTag, storageTag, residencyTag, alignmentTag } from '../../frontend/app/RelinkShell/data-view.js';

describe('securedTag', () => {
  it('own key reads as OWN KEY (ok); shared reads as SHARED KEY (warn)', () => {
    expect(securedTag(true)).toEqual({ tag: 'OWN KEY', tone: 'ok' });
    expect(securedTag(false)).toEqual({ tag: 'SHARED KEY', tone: 'warn' });
  });
});

describe('recoveryTag', () => {
  it('recovery codes present → RECOVERY SET (ok), else NO RECOVERY (warn)', () => {
    expect(recoveryTag({ hasRecoveryCodes: true })).toEqual({ tag: 'RECOVERY SET', tone: 'ok' });
    expect(recoveryTag({ hasRecoveryCodes: false })).toEqual({ tag: 'NO RECOVERY', tone: 'warn' });
    expect(recoveryTag(null)).toEqual({ tag: 'NO RECOVERY', tone: 'warn' }); // absent status ≠ recovered
  });
});

describe('storageTag', () => {
  it('maps each headroom level to an honest word + tone', () => {
    expect(storageTag('ok')).toEqual({ tag: 'HEALTHY', tone: 'ok' });
    expect(storageTag('low')).toEqual({ tag: 'LOW', tone: 'warn' });
    expect(storageTag('critical')).toEqual({ tag: 'CRITICAL', tone: 'alert' });
    expect(storageTag('unknown')).toEqual({ tag: 'UNMEASURED', tone: 'dim' });
    expect(storageTag(undefined)).toEqual({ tag: 'UNMEASURED', tone: 'dim' });
  });
});

describe('residencyTag', () => {
  it('dormant is dim, never a warning — dormancy is not loss', () => {
    expect(residencyTag(true)).toEqual({ tag: 'RESIDENT', tone: 'ok' });
    expect(residencyTag(false)).toEqual({ tag: 'DORMANT', tone: 'dim' });
  });
});

describe('alignmentTag', () => {
  it('aligned is ok; a mismatch or unknown is a flaggable warn', () => {
    expect(alignmentTag(true)).toEqual({ tag: 'ALIGNED', tone: 'ok' });
    expect(alignmentTag(false)).toEqual({ tag: 'MISMATCH', tone: 'warn' });
    expect(alignmentTag('unknown')).toEqual({ tag: 'UNKNOWN', tone: 'warn' });
  });
});
