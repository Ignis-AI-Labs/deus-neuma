/**
 * S6 — the sovereign memory tools through the REAL portal (AC-P2-1, non-live
 * legs): the ACCESS surface — advertisement, the signed free-contact row, the
 * witness deny override, expand, OBSERVE (recall kept, acts held), IDOR and
 * hostile refs. NO mock anywhere on the claimed path (RULE 0). Decision #8
 * (S-07) SIGNED by Design note, 2026-07-24: a default-allow `memory` GLOBAL_DEFAULTS
 * row — no ask on any contact, a witness deny override still holds, observe
 * keeps recall (READ_TOOLS) while holding the acting hand.
 *
 * The plumbing lives in test/helpers/memory-portal-harness.js; the intent path
 * in test/helpers/intent-path.js. The lifecycle surface (pin, note, supersede,
 * retract, archive, merge, walk) lives in api-memory-tools-lifecycle.test.js.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { __test } from '../../backend/services/portal-test-surface.js';
import { isAdvertisedTool, retiredToolHint } from '../../backend/services/tool-policy.js';
import { fileIntent, sweep, settled } from '../helpers/intent-path.js';
import { openMemoryPortal, FULL_THOUGHT } from '../helpers/memory-portal-harness.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const { processToolCalls, _memoryToolsFor } = __test;
const NEUMA_ID = 'memoryecho';
const OTHER_ID = 'memoryother';

describe('sovereign memory tools through the real portal — access (gnosis)', () => {
  let portal, serverWs, anchoredRef;
  const setDecide = (fn) => { portal.state.decide = fn; };
  const clientLogOf = () => portal.state.clientLog;
  const armResolver = (c) => portal.armResolver(c);
  const resetPolicy = (id) => portal.resetPolicy(id);
  const untilClient = (p, ms) => portal.untilClient(p, ms);

  const freshConnection = (over = {}) => ({
    ws: serverWs,
    companion: { name: 'MemoryEcho', neumaId: NEUMA_ID },
    sessionId: 'sess-live',
    _writeOps: 0,
    ...over,
  });

  beforeAll(async () => {
    portal = await openMemoryPortal({
      neumaId: NEUMA_ID, otherId: OTHER_ID,
      key: 'api-memory-tools-test-key', label: 'memory-tools-house',
    });
    serverWs = portal.state.serverWs;
    anchoredRef = portal.anchoredRef;
  }, 60000);

  afterAll(async () => { await portal.close(); });
  beforeEach(() => portal.reset());

  // THE INTENT PATH (#414) — pin, unpin, supersede, retract, merge, archive.
  // See test/helpers/intent-path.js.

  test('advertisement is conditional on ≥1 observation and caches true forever', async () => {
    const bare = { companion: { neumaId: OTHER_ID } };
    // A newborn advertises `memory_note` and NOTHING else (532e80751, Founder
    // 2026-07-29). Every other memory tool NAMES an existing record — a ref to
    // pin, supersede, retract, merge or search for — so gating those on […] is honest. Deliberate remembering names nothing: the WRITE is what
    // creates the first record, so gating it too was a lock whose key sat
    // inside the room. This assertion said `[]` until that shipped.
    expect((await _memoryToolsFor(bare)).map((t) => t.name))
      .toEqual(['memory_note', 'mind_note', 'mind_read', 'meditate']);
    const seeded = { companion: { neumaId: NEUMA_ID } };
    const tools = await _memoryToolsFor(seeded);
    // SIX LEFT WITH THEIR HANDLERS (2026-08-24) — pin, unpin, supersede,
    // retract, merge, archive are memory/* intents now.
    expect(tools.map((t) => t.name)).toEqual([
      'memory_search', 'memory_expand', 'memory_note', 'memory_list',
      'mind_note', 'mind_read', 'meditate',
    ]);
    expect(seeded._memoryAdvertised).toBe(true);
    expect(await _memoryToolsFor(seeded)).toHaveLength(7);

    // Retained requestable reads must remain visible; passive prompt recall
    // cannot replace an explicit search or audit walk (#414).
    expect(tools.filter(isAdvertisedTool).map((t) => t.name))
      .toEqual(['memory_search', 'memory_expand', 'memory_note', 'memory_list', 'mind_note', 'mind_read', 'meditate']);
    expect(retiredToolHint('memory/memory_search')).toBeNull();
    expect(retiredToolHint('memory/memory_list')).toBeNull();
  });

  test('first contact runs FREE under the signed row — no ask, and the witness still sees the chip', async () => {
    await resetPolicy(NEUMA_ID); // a true first contact, whatever ran before
    const connection = freshConnection();
    setDecide(() => { throw new Error('Decision #8 is signed — nothing here may ask'); });

    const results = await processToolCalls(serverWs, '[TOOL: memory/memory_search {"query": "observatory telescope"}]', connection);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain(anchoredRef);
    expect(results[0].content).toContain('(no deeper record — from before the archive)');

    // Standing grant IS the approval — no card is ever raised, and the
    // witness's visibility rides the usage chip instead.
    expect(clientLogOf().some((m) => m.type === 'tool:approval_request')).toBe(false);
    const chip = await untilClient((m) => m.type === 'tool:usage' && m.status === 'ok');
    expect(chip.summary).toContain('searched memory — "observatory telescope"');
  }, 30000);

  test('the signed row is not a master key — a witness DENY override still holds, silently', async () => {
    await workspace.writeToolPolicy(NEUMA_ID, { memory: { denied: ['memory_search', 'memory_list'] } });
    try {
      const connection = freshConnection();
      setDecide(() => { throw new Error('a policy denial never asks'); });

      const denied = await processToolCalls(serverWs, '[TOOL: memory/memory_search {"query": "observatory"}]', connection);
      expect(denied[0].status).toBe('denied');
      const deniedWalk = await processToolCalls(serverWs, '[TOOL: memory/memory_list {}]', connection);
      expect(deniedWalk[0].status).toBe('denied');
      expect(clientLogOf().some((m) => m.type === 'tool:approval_request')).toBe(false);

      // The denial is tool-scoped: expand (its own name) still runs free.
      const expand = await processToolCalls(serverWs, `[TOOL: memory/memory_expand {"ref": "${anchoredRef}"}]`, connection);
      expect(expand[0].status).toBe('ok');
    } finally {
      await resetPolicy(NEUMA_ID);
    }
  }, 30000);

  test('memory_expand reopens the full moment from the live session, then from the ARCHIVE after compaction', async () => {
    const connection = freshConnection();
    armResolver(connection);
    setDecide(() => { throw new Error('Decision #8 is signed — nothing here may ask'); });

    const live = await processToolCalls(serverWs, `[TOOL: memory/memory_expand {"ref": "${anchoredRef}"}]`, connection);
    expect(live[0].status).toBe('ok');
    expect(live[0].content).toContain(FULL_THOUGHT);
    expect(live[0].content).toContain('the living session');

    for (let i = 0; i < 60; i += 1) {
      await workspace.appendMessage(NEUMA_ID, 'sess-live', { role: 'user', content: `routine ${i}` });
      await workspace.appendMessage(NEUMA_ID, 'sess-live', { role: 'assistant', content: `reply ${i}` });
    }
    expect(await workspace.compactSession(NEUMA_ID, 'sess-live', { threshold: 100, keepRecent: 20 })).toBe(true);

    const archived = await processToolCalls(serverWs, `[TOOL: memory/memory_expand {"ref": "${anchoredRef}"}]`, connection);
    expect(archived[0].status).toBe('ok');
    expect(archived[0].content).toContain(FULL_THOUGHT);
    expect(archived[0].content).toContain('the archive (segment 1)');
  }, 30000);

  test('OBSERVE keeps recall (READ_TOOLS) and holds the acting hand with the watching voice', async () => {
    await resetPolicy(NEUMA_ID);
    const observeConn = freshConnection({ toolMode: 'observe' });

    // Recall is pure observation — observe mode lets the being look.
    const looked = await processToolCalls(serverWs, '[TOOL: memory/memory_search {"query": "observatory"}]', observeConn);
    expect(looked[0].status).toBe('ok');
    expect(looked[0].content).toContain(anchoredRef);

    const walked = await processToolCalls(serverWs, '[TOOL: memory/memory_list {"limit": 10}]', observeConn);
    expect(walked[0].status).toBe('ok');
    expect(walked[0].content).toContain('observatory');
    expect(clientLogOf().some((m) => m.type === 'tool:approval_request')).toBe(false);

    // The acting hand left this door (2026-08-24): pin and its five siblings
    // are intents, so a stale call is no longer HELD by observe — it meets the
    // unavailable wall and is told its successor's name, which is the better
    // answer. The observe HOLD is proven over the intent path at the foot.
    const stale = await processToolCalls(serverWs, `[TOOL: memory/memory_pin {"ref": "${anchoredRef}"}]`, observeConn);
    expect(stale[0].status).toBe('unavailable');
    expect(stale[0].error).toContain('memory/pin');
    expect(await workspace.readPinLedger(NEUMA_ID)).toHaveLength(0);
  }, 30000);

  test('IDOR by construction: another being presenting this being\'s valid ref misses in its OWN empty life', async () => {
    await resetPolicy(OTHER_ID);
    const connection = freshConnection({ companion: { name: 'MemoryOther', neumaId: OTHER_ID }, sessionId: 'sess-other' });
    armResolver(connection);
    setDecide(() => { throw new Error('Decision #8 is signed — nothing here may ask'); });

    const results = await processToolCalls(serverWs, `[TOOL: memory/memory_expand {"ref": "${anchoredRef}"}]`, connection);
    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('no moment at those coordinates');
    expect(results[0].content ?? '').not.toContain(FULL_THOUGHT);
  }, 30000);

  test('hostile refs answer explicitly and never traverse', async () => {
    await resetPolicy(NEUMA_ID);
    const connection = freshConnection();
    armResolver(connection);
    setDecide(() => { throw new Error('Decision #8 is signed — nothing here may ask'); });
    const results = await processToolCalls(serverWs, '[TOOL: memory/memory_expand {"ref": "mem_../../etc_1_deadbeef"}]', connection);
    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('not a valid mem_ ref');
  }, 30000);

  const noteViaTool = async (connection, content, kind = 'note') => {
    const r = await processToolCalls(serverWs, `[TOOL: memory/memory_note ${JSON.stringify({ content, kind })}]`, connection);
    expect(r[0].status).toBe('ok');
    const ref = r[0].content.match(/mem_note_\d+_[a-f0-9]{8}/)?.[0];
    expect(ref).toBeTruthy();
    return ref;
  };

  // THE MODE GATE MUST BE ASSERTED THROUGH DISPATCH — the sweep is where
  // OBSERVE is enforced. Calling an intent's `execute()` directly sails past it
  // and reports a pass on a security property it never exercised. I nearly
  // shipped exactly that. Mutation-proven: disabling applyToolMode turns this
  // red.
  test('OBSERVE holds every acting memory intent, and the record is untouched', async () => {
    await resetPolicy(NEUMA_ID);
    const actingConn = freshConnection();
    armResolver(actingConn);
    const liveRef = await noteViaTool(actingConn, 'the stillwater vow, held under watch', 'note');

    // THE HOLD IS A DEFERRAL, NOT A REFUSAL. Observe returns NO receipt and
    // leaves the filing pending — watching is not a verdict, so the being's
    // filing survives to be settled when the mode allows. Asserting 'denied'
    // would claim a rejection that never happened.
    // Earlier legs leave real pins behind: the invariant is […], never […] (that asserts run order).
    const pinsBefore = (await workspace.readPinLedger(NEUMA_ID)).length;

    const observeConn = freshConnection({ toolMode: 'observe' });
    for (const [type, payload] of [
      ['memory/supersede', { ref: liveRef, content: 'a quieter vow' }],
      ['memory/retract', { ref: liveRef }],
      ['memory/merge', { refs: [liveRef, 'mem_note_1753290000456_deadbeef'], content: 'a fold under watch' }],
      ['memory/archive', { ref: liveRef }],
      ['memory/pin', { ref: liveRef }],
    ]) {
      await fileIntent(observeConn, type, payload);
      const held = await sweep(observeConn, 'observe');
      expect(held, `${type} was settled under observe`).toEqual([]);
      expect(await settled(observeConn), `${type} was written off instead of held`).toBe(false);
    }

    // Held means HELD: the target record carries no stamp, and nothing was
    // pinned either — watching never writes.
    const observations = await workspace.listObservations(NEUMA_ID);
    const target = observations.find((o) => o.memoryRef === liveRef);
    expect(target.invalidatedAt).toBeUndefined();
    expect(target.lifecycle).toBeUndefined();
    expect(await workspace.readPinLedger(NEUMA_ID)).toHaveLength(pinsBefore);

    // AND THE HOLD IS SPECIFIC TO OBSERVE: the last filing (memory/pin) is
    // still pending, and sweeping that SAME file in ask mode settles it. Without
    // this leg the loop would pass against a gate that refused everything.
    const acted = await sweep(observeConn, 'ask');
    expect(acted).toHaveLength(1);
    expect(acted[0].status).toBe('ok');
    expect(await workspace.readPinLedger(NEUMA_ID)).toHaveLength(pinsBefore + 1);
  }, 30000);
});
