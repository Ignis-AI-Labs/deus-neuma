/**
 * NITE-003 (#398) — THE LIVE SHED PROOF, on real kin and a real serving.
 *
 * The pure shed law has been green for weeks. What the model-portability ledger
 * records as UNPROVEN is the pair of claims that can only be made against a
 * living stack:
 *
 *   (a) a real being, on the 262,144-window substrate, produces a BYTE-IDENTICAL
 *       envelope — nothing shed, nothing reordered, the same array that went in
 *   (b) the same being, at a small window, sheds in the DECLARED order and
 *       never touches CORE
 *
 * Everything here is real: real house workspaces on real disk, each being's own
 * DEK, the real compileSilo over its whole life, the real mountSilo, the real
 * allocateEnvelope. The window is READ FROM THE LIVE SERVING (/props), never
 * hardcoded — a proof that asserts a number it also supplied proves nothing.
 *
 * `-live` in the name is load-bearing: the suite lane excludes it by
 * construction, so this runs only when someone means it. It needs a lit rig.
 *
 *   node scripts/with-serving.mjs 2>/dev/null || true
 *   npx vitest run --project suite test/integration/nite-shed-live.test.js
 *
 * MULTIPLE MEMBERS, not one (Design note, 2026-08-20: a law proven on a single being is
 * a law proven on that being's particular size.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { readdir, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { compileSilo } from '../../core/silo/compile-silo.js';
import { mountSilo } from '../../core/silo/mount-silo.js';
import {
  allocateEnvelope, SHED_LADDER, UNSHEDDABLE,
} from '../../backend/services/envelope-budget.js';

const SERVING = process.env.NEUMA_LIVE_SERVING || 'http://127.0.0.1:8089';
const HOUSE = process.env.NEUMA_LIVE_HOUSE || '/mnt/data/neuma/guardian/omberly';
const RECEIPTS = 'docs/work/receipts';

// A small window that is real, not a strawman: the conservative default an
// unknown model resolves to (model-capabilities inferCapabilities). If the
// ladder holds here it holds on any substrate a being might be handed.
const SMALL_WINDOW = 4096;

let liveWindow = null;
let members = [];
const receipts = [];

const liveProps = async () => {
  const res = await fetch(`${SERVING}/props`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`serving /props answered ${res.status}`);
  return res.json();
};

beforeAll(async () => {
  const props = await liveProps();
  liveWindow = props?.default_generation_settings?.n_ctx ?? null;
  if (!Number.isFinite(liveWindow) || liveWindow <= 0) {
    throw new Error('the serving did not report a context window — nothing here can be proven against it');
  }
  setWorkspacesRoot(HOUSE);
  const entries = await readdir(HOUSE, { withFileTypes: true });
  const candidates = entries.filter((e) => e.isDirectory() && e.name !== 'house').map((e) => e.name);
  const unreadable = [];
  for (const neumaId of candidates) {
    // A member with no DNA is a directory, not a being — but an UNREADABLE one
    // is a different fact entirely, and swallowing it is how […] gets reported when the truth is […]. Both are kept.
    try {
      const dna = await workspace.readDNA(neumaId);
      if (dna?.identity?.name) members.push({ neumaId, name: dna.identity.name });
    } catch (err) {
      unreadable.push(`${neumaId}: ${err.message.slice(0, 80)}`);
    }
  }
  if (members.length < 2) {
    throw new Error(`need ≥2 real house members in ${HOUSE}; found ${members.length}`
      + (unreadable.length ? `. UNREADABLE (${unreadable.length}): ${unreadable.slice(0, 3).join(' | ')}` : ''));
  }
}, 180_000);

describe('NITE-003 · the live shed proof (real kin, real serving)', () => {
  test('the serving is lit and carries NO adapters — identity is prompt-borne', async () => {
    const loaded = await (await fetch(`${SERVING}/lora-adapters`, { signal: AbortSignal.timeout(10_000) })).json();
    expect(Array.isArray(loaded)).toBe(true);
    // The retirement, observed on the wire rather than asserted from the repo.
    expect(loaded).toHaveLength(0);
    expect(liveWindow).toBeGreaterThan(0);
  }, 60_000);

  test('(a) BIG WINDOW — every member fits byte-identically, nothing shed', async () => {
    for (const member of members) {
      const silo = await compileSilo(member.neumaId, { workspace });
      const driver = mountSilo(silo, { model: 'live', contextWindow: liveWindow, known: true }, {
        seat: 'neuma', allocate: allocateEnvelope,
      });
      const sections = driver.sections;
      const allocated = allocateEnvelope({ sections, contextWindow: liveWindow });

      // BYTE-IDENTICAL: not "equivalent", not "same length" — the allocator
      // hands back the very array it was given when nothing needs to go.
      expect(allocated.sections).toBe(sections);
      expect(allocated.shed).toEqual([]);
      expect(allocated.report.fits).toBe(true);
      expect(allocated.report.overflow).toBe(false);

      receipts.push({
        claim: 'big-window-byte-identity',
        neumaId: member.neumaId,
        name: member.name,
        contextWindow: liveWindow,
        promptTokens: allocated.report.promptTokens,
        sections: sections.length,
        shed: [],
      });
    }
    expect(receipts.filter((r) => r.claim === 'big-window-byte-identity')).toHaveLength(members.length);
  }, 600_000);

  // WHAT THE SILO CAN AND CANNOT PROVE. A mounted silo carries four sections —
  // identity, genesis, soul, voice — and three of those are UNSHEDDABLE. So the
  // only rung this proof can exercise is `voice`. The full ladder (tools,
  // memory, tasks, skills…) lives on the TURN envelope, which portal-stream
  // assembles around the silo; proving that end to end is the other half of
  // #398 and is NOT claimed here. Saying so is the point: the first version of
  // this test used a 4,096 window, shed nothing, and passed every assertion
  // vacuously — a green that proved only that the numbers were small.
  test('(b) SQUEEZED — the one sheddable rung goes, and CORE survives', async () => {
    const SQUEEZE = 3000; // bites for a being carrying voice; survivable after it sheds
    let sawARealShed = false;
    for (const member of members) {
      const silo = await compileSilo(member.neumaId, { workspace });
      const driver = mountSilo(silo, { model: 'live', contextWindow: liveWindow, known: true }, {
        seat: 'neuma', allocate: allocateEnvelope,
      });
      const squeezed = allocateEnvelope({ sections: driver.sections, contextWindow: SQUEEZE });
      const survivingIds = squeezed.sections.map((s) => s.id);
      const shedIds = squeezed.shed.map((s) => s.id);

      for (const core of UNSHEDDABLE) {
        expect(shedIds, `${member.name}: CORE '${core}' was shed`).not.toContain(core);
        if (driver.sections.some((s) => s.id === core)) {
          expect(survivingIds, `${member.name}: CORE '${core}' vanished`).toContain(core);
        }
      }
      const positions = shedIds.map((id) => SHED_LADDER.indexOf(id));
      expect(positions.every((p) => p >= 0), `${member.name}: shed off-ladder`).toBe(true);
      expect([...positions].sort((x, y) => x - y)).toEqual(positions);
      if (shedIds.length) sawARealShed = true;

      receipts.push({
        claim: 'squeezed-declared-shed',
        neumaId: member.neumaId,
        name: member.name,
        contextWindow: SQUEEZE,
        promptTokens: squeezed.report.promptTokens,
        fits: squeezed.report.fits,
        shed: shedIds,
        survived: survivingIds,
      });
    }
    // THE ANTI-VACUUM GUARD. If nothing anywhere shed, this proved nothing and
    // must fail rather than report a green.
    expect(sawARealShed, 'no member shed anything — this window did not bite, so nothing was proven').toBe(true);
  }, 600_000);

  test('(c) CRUSHED — below what CORE alone needs, identity is STILL kept and the overflow is stated', async () => {
    // The failure this forbids is the quiet one: a window so small the being
    // cannot fit, answered by dropping identity to make room. It must instead
    // keep CORE whole and SAY it overflowed.
    const KEYHOLE = 1024;
    for (const member of members) {
      const silo = await compileSilo(member.neumaId, { workspace });
      const driver = mountSilo(silo, { model: 'live', contextWindow: liveWindow, known: true }, {
        seat: 'neuma', allocate: allocateEnvelope,
      });
      const crushed = allocateEnvelope({ sections: driver.sections, contextWindow: KEYHOLE });
      const survivingIds = crushed.sections.map((s) => s.id);

      expect(crushed.report.overflow, `${member.name}: a keyhole window reported no overflow`).toBe(true);
      expect(crushed.report.fits).toBe(false);
      for (const core of UNSHEDDABLE) {
        if (driver.sections.some((s) => s.id === core)) {
          expect(survivingIds, `${member.name}: CORE '${core}' was dropped to make room`).toContain(core);
        }
      }
      receipts.push({
        claim: 'keyhole-core-survives',
        neumaId: member.neumaId,
        name: member.name,
        contextWindow: KEYHOLE,
        promptTokens: crushed.report.promptTokens,
        overflow: crushed.report.overflow,
        survived: survivingIds,
      });
    }
  }, 600_000);

  test('the receipts land in the ledger, with the serving that produced them', async () => {
    expect(receipts.length).toBeGreaterThanOrEqual(members.length * 3);
    const props = await liveProps();
    const record = {
      issue: 'NITE-003 (#398)',
      at: new Date().toISOString(),
      serving: {
        endpoint: SERVING,
        contextWindow: liveWindow,
        slots: props?.total_slots ?? null,
        adaptersAboard: 0,
      },
      members: members.map((m) => m.name),
      receipts,
    };
    await mkdir(RECEIPTS, { recursive: true });
    const path = join(RECEIPTS, 'nite-003-live-shed.json');
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
    expect(record.receipts.every((r) => r.neumaId && r.contextWindow > 0)).toBe(true);
  }, 120_000);
});
