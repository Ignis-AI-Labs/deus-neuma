// The neutral-request law (2026-07-15 token-soup RCA): llama-server adapter
// scales are GLOBAL, so a request that omits `lora` on a conduit carrying
// adapters speaks through whatever scales are live — a fresh boot applies
// EVERYONE at 1.0. Every unbound request must carry explicit zeros.

import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { neutralLoraRequest, loraRequestForBinding } from '../../core/refinement/binding.js';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const GALEN = sha256('galen-refinement-1');

// A binding resolves by artifact DIGEST, never by path: the supervised
// projection is deliberately path-free, because a staged artifact is reached
// through a /proc/self/fd handle whose path is not a stable identity.
const LOADED = Object.freeze({
  adapters: Object.freeze([
    { serverAdapterId: 0, artifactSha256: sha256('keir-refinement-1') },
    { serverAdapterId: 1, artifactSha256: GALEN },
    { serverAdapterId: 2, artifactSha256: sha256('signal-refinement-1') },
  ]),
});
// The same conduit as GET /lora-adapters reports it — the projection the
// supervisor actually hands neutralLoraRequest.
const SERVER = LOADED.adapters.map(({ serverAdapterId }) => ({ id: serverAdapterId }));

describe('neutralLoraRequest — the silent resting state', () => {
  it('zeroes EVERY loaded adapter explicitly', () => {
    expect(neutralLoraRequest(SERVER)).toEqual([
      { id: 0, scale: 0.0 },
      { id: 1, scale: 0.0 },
      { id: 2, scale: 0.0 },
    ]);
  });

  it('is null only when the conduit carries nothing — the one case a naked request is safe', () => {
    expect(neutralLoraRequest([])).toBe(null);
    expect(neutralLoraRequest(null)).toBe(null);
    expect(neutralLoraRequest(undefined)).toBe(null);
  });
});

describe('bound and neutral requests agree on shape', () => {
  it('a bound request is the neutral request with exactly ONE dial turned', () => {
    const bound = loraRequestForBinding(LOADED, { sha256: GALEN, scale: 1 });
    const neutral = neutralLoraRequest(SERVER);
    expect(bound.filter((x, i) => x.scale === neutral[i].scale)).toHaveLength(2);
    expect(bound.find((x) => x.scale === 1.0)).toEqual({ id: 1, scale: 1.0 });
  });

  // The sibling law in refinement-ceremony-flow.test.js: scale 0 is explicit
  // neutralization and every other adapter stays at 0.0. So a binding dialled
  // to zero must collapse exactly onto the resting state — no dial turned.
  it('scale 0 IS the neutral request — explicit neutralization turns nothing', () => {
    expect(loraRequestForBinding(LOADED, { sha256: GALEN, scale: 0 }))
      .toEqual(neutralLoraRequest(SERVER));
  });
});
