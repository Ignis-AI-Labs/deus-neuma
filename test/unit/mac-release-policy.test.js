import { describe, expect, it } from 'vitest';
import { unsignedMacReleaseRefusal } from '../../scripts/release-mac-policy.mjs';

const decision = (to, signedByApple, allowUnsigned) => unsignedMacReleaseRefusal({ to, signedByApple, allowUnsigned });

describe('unsigned Mac production release policy', () => {
  it('permits signed production and leaves the existing no-override refusal to the caller', () => {
    expect(decision('production', true, false)).toBeNull();
    expect(decision('production', true, true)).toBeNull();
    expect(decision('production', false, false)).toBeNull();
    expect(decision('preview', false, false)).toBeNull();
  });

  it('permits an explicitly unsigned preview', () => {
    expect(decision('preview', false, true)).toBeNull();
  });

  it('refuses unsigned production even with the preview override', () => {
    expect(decision('production', false, true)).toBe('unsigned Mac builds are preview-only; production requires Apple signing and notarization');
  });
});
