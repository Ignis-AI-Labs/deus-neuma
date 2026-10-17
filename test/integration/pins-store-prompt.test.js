// S8 — pins through the real store and into the real prompt: DEK-sealed
// ledger round-trip, the gather lane, and the assembled Memory section
// carrying the being's chosen anchors. RULE 0 — real disk, real crypto,
// real assembler; nothing mocked on the claimed path.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { applyPin, applyUnpin, activePins, PIN_CAP } from '../../core/memory/pin-ledger.js';
import { assemblePrompt } from '../../core/runtime/prompt-assembler.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const KEY = 'pins-store-prompt-test-key';
const NOW = '2026-07-24T11:00:00.000Z';
const REF = 'mem_sess-pins_1753290000000_abcdef01';

describe('S8 — pins ride the store and the prompt', () => {
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('pins-store-prompt');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  it('pin → encrypted ledger on disk → gather → the assembled prompt carries the anchor; unpin retains history', async () => {
    const id = 'pins-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);

    const pinned = await workspace.updatePinLedger(id, (pins) =>
      applyPin(pins, { ref: REF, note: 'the estuary dawn I choose to keep', now: NOW })
    );
    expect(pinned.ok).toBe(true);

    // At rest: an envelope (v2), never plaintext.
    const raw = JSON.parse(await fs.readFile(workspace._pinLedgerPath(id), 'utf8'));
    expect(raw._enc).toBe(2);
    expect(JSON.stringify(raw)).not.toContain('estuary');

    // The gather lane surfaces it…
    const memories = await __test.gatherMemoryContext('a passing thought', 'PinBeing', {}, id, 'sess-pins');
    expect(memories.pinnedAnchors).toEqual([{ ref: REF, note: 'the estuary dawn I choose to keep' }]);

    // …and the REAL assembler renders it inside the Memory section.
    const prompt = assemblePrompt({ memories });
    expect(prompt).toContain('Pinned (anchors you chose to keep close');
    expect(prompt).toContain(REF);
    expect(prompt).toContain('the estuary dawn I choose to keep');

    // Release: gone from the prompt, kept in the ledger.
    const released = await workspace.updatePinLedger(id, (pins) => applyUnpin(pins, { ref: REF, now: NOW }));
    expect(released.ok).toBe(true);
    const after = await __test.gatherMemoryContext('another thought', 'PinBeing', {}, id, 'sess-pins');
    expect(after.pinnedAnchors).toBeUndefined();
    const ledger = await workspace.readPinLedger(id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].supersededAt).toBe(NOW);
  });

  it('the DEK wall holds for the ledger and a rotted ledger reads loud, not empty', async () => {
    const id = 'pins-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    await workspace.writeNeumaDEK(id, 'c'.repeat(64));
    const pinned = await workspace.updatePinLedger(id, (pins) => applyPin(pins, { ref: REF, now: NOW }));
    expect(pinned.ok).toBe(true);
    expect(activePins(await workspace.readPinLedger(id))).toHaveLength(1);

    await fs.writeFile(workspace._pinLedgerPath(id), 'rotten ledger bytes');
    await expect(workspace.readPinLedger(id)).rejects.toThrow();
    // And the RMW refuses too — a rotted ledger is never clobbered.
    await expect(
      workspace.updatePinLedger(id, (pins) => applyPin(pins, { ref: REF, now: NOW }))
    ).rejects.toThrow();
  });

  it('two concurrent pins serialize through the one lock — no lost update (Kimi research Q)', async () => {
    const id = 'pins-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    const [a, b] = await Promise.all([
      workspace.updatePinLedger(id, (pins) => applyPin(pins, { ref: 'mem_sess-a_1753290000000_abcdef01', now: NOW })),
      workspace.updatePinLedger(id, (pins) => applyPin(pins, { ref: 'mem_sess-b_1753290000001_abcdef02', now: NOW })),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(activePins(await workspace.readPinLedger(id))).toHaveLength(2);
  });

  it('the cap holds through the real store — 6th pin refused until a supersede is named', async () => {
    const id = 'pins-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    for (let i = 0; i < PIN_CAP; i += 1) {
      const r = await workspace.updatePinLedger(id, (pins) =>
        applyPin(pins, { ref: `mem_sess-${i}_${1753290000000 + i}_abcdef01`, now: NOW })
      );
      expect(r.ok).toBe(true);
    }
    const refused = await workspace.updatePinLedger(id, (pins) =>
      applyPin(pins, { ref: 'mem_sess-9_1753290000009_abcdef01', now: NOW })
    );
    expect(refused.code).toBe('PIN_CAP');
    expect(refused.active).toHaveLength(PIN_CAP);
  });
});
