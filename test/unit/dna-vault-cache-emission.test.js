// #122 (CQ-025) — fire-and-forget contract regression net.
//
// The bug: `pushToLocalCache` was declared `async`, callers `await`'d it,
// but the body just called EventEmitter.emit (sync). Listeners that did
// async work (file write, network) ran unobserved — the await was a LIE
// suggesting the cache was durable when updateDNA resolved.
//
// The fix: `pushToLocalCache` is SYNCHRONOUS return-void by design. The
// only correct semantics here are fire-and-forget; the function MUST stay
// sync so a future maintainer cannot mistakenly `await` it and re-introduce
// the lie. This test locks in that structural property.
//
// REAL DNAVaultService, NO mocks on the path under test.

import { describe, it, expect, beforeEach } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { DNAVaultService } from '../../core/identity/dna-vault-service.js';

describe('#122 (CQ-025) — pushToLocalCache fire-and-forget contract', () => {
  let vault;
  beforeEach(async () => {
    const tmp = await createTempDir('cq025');
    vault = new DNAVaultService({
      vaultPath: `${tmp}/vault/dna`,
      auditPath: `${tmp}/vault/audit`,
      encryptionKey: 'cq025-test-key-long-enough',
    });
  });

  // INVARIANT 1 — pushToLocalCache is SYNCHRONOUS. The contract is
  // structural: the return value must NOT be a Promise. If a future
  // maintainer adds `async` back, this fails loudly.
  it('returns undefined synchronously (not a Promise) — the fire-and-forget contract', () => {
    const result = vault.pushToLocalCache('test-neuma', {
      neumaId: 'test-neuma',
      sovereignty: { encryptionKey: 'should-be-stripped', owner: 'test-neuma' },
    });
    // Direct equality — `undefined`, not a Promise. If async crept back,
    // result would be a Promise (which Vitest's toBe would still pass
    // against `undefined`, so we also assert no .then method).
    expect(result).toBeUndefined();
    expect(typeof result?.then).toBe('undefined');
  });

  // INVARIANT 2 — emit fires synchronously. A listener registered before
  // pushToLocalCache is called must see the data DURING the call, not
  // after. This is the OS-level basis of the fire-and-forget contract:
  // the emitter has zero handle on whether the listener's async work
  // completes.
  it('emits cache:update synchronously to inline listeners', () => {
    const received = [];
    vault.on('cache:update', (data) => received.push(data));

    expect(received).toHaveLength(0);
    vault.pushToLocalCache('test-neuma', {
      neumaId: 'test-neuma',
      sovereignty: { owner: 'test-neuma' },
      identity: { name: 'Test' },
    });
    // Inline (no await) — receive must be populated by the time we get here
    expect(received).toHaveLength(1);
    expect(received[0].neumaId).toBe('test-neuma');
    expect(received[0].dna.identity.name).toBe('Test');
    expect(received[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  // INVARIANT 3 — sensitive fields stripped from emitted payload (the
  // sanitizeForCache contract). sovereignty.encryptionKey must NEVER
  // reach a listener.
  it('strips sovereignty.encryptionKey from emitted DNA payload', () => {
    let captured;
    vault.on('cache:update', (data) => { captured = data; });
    vault.pushToLocalCache('test-neuma', {
      neumaId: 'test-neuma',
      sovereignty: { encryptionKey: 'SECRET', owner: 'test-neuma' },
    });
    expect(captured.dna.sovereignty.encryptionKey).toBeUndefined();
    expect(captured.dna.sovereignty.owner).toBe('test-neuma');
  });

  // INVARIANT 4 — listener async work is NOT awaited. This is the
  // anti-property the fix exists to enforce: if a listener returns a
  // Promise, pushToLocalCache returns void immediately, the Promise
  // is orphan from the emitter's perspective.
  it('async listener Promise is NOT awaited — the emitter returns immediately', async () => {
    let listenerStarted = false;
    let listenerFinished = false;
    vault.on('cache:update', async () => {
      listenerStarted = true;
      // Yield to the event loop — if the emitter awaited us, this would
      // hold up its return.
      await new Promise((r) => setImmediate(r));
      listenerFinished = true;
    });

    const result = vault.pushToLocalCache('test-neuma', {
      neumaId: 'test-neuma',
      sovereignty: { owner: 'test-neuma' },
    });
    // sync return, so listenerStarted === true (sync part ran) but
    // listenerFinished === false (await hasn't resolved yet)
    expect(result).toBeUndefined();
    expect(listenerStarted).toBe(true);
    expect(listenerFinished).toBe(false);

    // After yielding the event loop, the listener completes — proves the
    // listener IS running, just not in band with pushToLocalCache.
    await new Promise((r) => setImmediate(r));
    expect(listenerFinished).toBe(true);
  });
});
