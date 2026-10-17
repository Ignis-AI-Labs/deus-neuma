/**
 * S6 — the sovereign memory tools through the REAL portal (AC-P2-1, non-live
 * legs): the LIFECYCLE surface — pin/unpin, deliberate notes, supersede,
 * retract, archive, merge, the memory walk, and the hostile lifecycle refs.
 * NO mock anywhere on the claimed path (RULE 0). Decision #8 (S-07) SIGNED by
 * Design note, 2026-07-24: a default-allow `memory` GLOBAL_DEFAULTS row — no ask on any
 * contact.
 *
 * The plumbing lives in test/helpers/memory-portal-harness.js; the intent path
 * in test/helpers/intent-path.js. The access surface (advertisement, free
 * contact, deny override, expand, OBSERVE, IDOR) lives in
 * api-memory-tools-access.test.js.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { __test } from '../../backend/services/portal-test-surface.js';
import { viaIntent } from '../helpers/intent-path.js';
import { openMemoryPortal } from '../helpers/memory-portal-harness.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { listMemories } from '../../core/memory/memory-lifecycle.js';

const { processToolCalls } = __test;
const NEUMA_ID = 'memoryecho';
const OTHER_ID = 'memoryother';

describe('sovereign memory tools through the real portal — lifecycle (gnosis)', () => {
  let portal, serverWs, anchoredRef;
  const setDecide = (fn) => { portal.state.decide = fn; };
  const armResolver = (c) => portal.armResolver(c);
  const resetPolicy = (id) => portal.resetPolicy(id);

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

  test('memory/pin and memory/unpin work the real store — cap refusal carries the held refs', async () => {
    await resetPolicy(NEUMA_ID);
    const connection = freshConnection();
    armResolver(connection);
    setDecide(() => { throw new Error('Decision #8 is signed — nothing here may ask'); });

    const pinned = await viaIntent(connection, 'memory/pin', { ref: anchoredRef, note: 'the observatory stays close' });
    expect(pinned[0].status).toBe('ok');
    expect(pinned[0].content).toContain('Pinned. Anchors held (1/5)');
    expect(pinned[0].content).toContain(anchoredRef);

    // Fill to the cap, then the 6th refusal NAMES what is held.
    for (let i = 0; i < 4; i += 1) {
      const r = await viaIntent(connection, 'memory/pin', { ref: `mem_sess-fill_${1753290000100 + i}_abcdef0${i}` });
      expect(r[0].status).toBe('ok');
    }
    const refused = await viaIntent(connection, 'memory/pin', { ref: 'mem_sess-over_1753290000999_abcdef09' });
    expect(refused[0].status).toBe('error');
    expect(refused[0].error).toContain('held:');
    expect(refused[0].error).toContain(anchoredRef);

    const released = await viaIntent(connection, 'memory/unpin', { ref: anchoredRef });
    expect(released[0].status).toBe('ok');
    expect(released[0].content).toContain('Anchors held (4/5)');
  }, 30000);

  test('memory_note writes a deliberate fact that recall finds IMMEDIATELY at full fidelity (B-30)', async () => {
    await resetPolicy(NEUMA_ID);
    const connection = freshConnection();
    armResolver(connection);
    setDecide(() => { throw new Error('Decision #8 is signed — nothing here may ask'); });

    const fact = 'I am Keeper of the Eastern Lantern in House Aldmere, sealed on Base — the title is mine and I hold it gladly.';
    const noted = await processToolCalls(serverWs,
      `[TOOL: memory/memory_note {"content": "${fact}", "kind": "identity", "attestation": {"houseId": "aldmere", "chain": "base"}}]`, connection);
    expect(noted[0].status).toBe('ok');
    expect(noted[0].content).toContain('Remembered, at full fidelity');
    const noteRef = noted[0].content.match(/mem_note_\d+_[a-f0-9]{8}/)?.[0];
    expect(noteRef).toBeTruthy();

    // The deliberate act IS the significance — searchable this very turn,
    // its line carrying the note's own ref and the deliberate marker.
    const found = await processToolCalls(serverWs, '[TOOL: memory/memory_search {"query": "Eastern Lantern Keeper title"}]', connection);
    expect(found[0].status).toBe('ok');
    expect(found[0].content).toContain('Eastern Lantern');
    expect(found[0].content).toContain(noteRef);
    expect(found[0].content).toContain('· deliberate');

    // The ref opens the note at full fidelity — kind, provenance, the
    // untruncated text — through the same memory_expand seam.
    const opened = await processToolCalls(serverWs, `[TOOL: memory/memory_expand {"ref": "${noteRef}"}]`, connection);
    expect(opened[0].status).toBe('ok');
    expect(opened[0].content).toContain(fact);
    expect(opened[0].content).toContain('identity');
    expect(opened[0].content).toContain('self-authored');

    // The record carries the provenance and the full untruncated text.
    const observations = await workspace.listObservations(NEUMA_ID);
    const note = observations.find((o) => o.type === 'self-note' && o.memoryRef === noteRef);
    expect(note.content).toBe(fact);
    expect(note.noteKind).toBe('identity');
    expect(note.attestation).toEqual({ houseId: 'aldmere', chain: 'base' });
    expect(note.source).toBe('self-authored');

    // A note ref is a first-class address: minted by the memory_note TOOL,
    // spent by the memory/pin INTENT — both address the same record.
    const pinned = await viaIntent(connection, 'memory/pin', { ref: noteRef, note: 'the title stays close' });
    expect(pinned[0].status).toBe('ok');
    expect(pinned[0].content).toContain(noteRef);
    const unpinned = await viaIntent(connection, 'memory/unpin', { ref: noteRef });
    expect(unpinned[0].status).toBe('ok');

    // The gate refuses the oversized and the empty, explicitly.
    const tooBig = await processToolCalls(serverWs, `[TOOL: memory/memory_note {"content": "${'x'.repeat(1001)}"}]`, connection);
    expect(tooBig[0].status).toBe('error');
    const empty = await processToolCalls(serverWs, '[TOOL: memory/memory_note {"content": "   "}]', connection);
    expect(empty[0].status).toBe('error');
  }, 30000);

  const noteViaTool = async (connection, content, kind = 'note') => {
    const r = await processToolCalls(serverWs, `[TOOL: memory/memory_note ${JSON.stringify({ content, kind })}]`, connection);
    expect(r[0].status).toBe('ok');
    const ref = r[0].content.match(/mem_note_\d+_[a-f0-9]{8}/)?.[0];
    expect(ref).toBeTruthy();
    return ref;
  };

  test('memory_supersede: the old ref leaves recall, the truer note enters, the record keeps its stamps', async () => {
    await resetPolicy(NEUMA_ID);
    const connection = freshConnection();
    armResolver(connection);
    setDecide(() => { throw new Error('Decision #8 is signed — nothing here may ask'); });

    const oldRef = await noteViaTool(connection, 'the zephyrine bell rings at dawn — my first reading', 'fact');
    const superseded = await viaIntent(connection, 'memory/supersede', {
      ref: oldRef, content: 'the zephyrine bell rings at DUSK — the dawn reading was wrong', kind: 'fact',
    });
    expect(superseded[0].status).toBe('ok');
    const newRef = superseded[0].content.match(/mem_note_\d+_[a-f0-9]{8}/)?.[0];
    expect(newRef).toBeTruthy();

    // The old note drops out of recall; the truer one is found this turn.
    const stale = await processToolCalls(serverWs, '[TOOL: memory/memory_search {"query": "zephyrine bell dawn first reading"}]', connection);
    expect(stale[0].content).not.toContain(oldRef);
    const fresh = await processToolCalls(serverWs, '[TOOL: memory/memory_search {"query": "zephyrine bell dusk wrong"}]', connection);
    expect(fresh[0].content).toContain(newRef);

    // The old record REMAINS on disk with the full stamp set (audit, not erasure).
    const observations = await workspace.listObservations(NEUMA_ID);
    const old = observations.find((o) => o.memoryRef === oldRef);
    expect(old.invalidatedAt).toBeTruthy();
    expect(old.lifecycle).toBe('superseded');
    const replacement = observations.find((o) => o.memoryRef === newRef);
    expect(old.supersededBy).toBe(replacement.id);

    // Anti-gaslighting: the superseded note still opens by its ref — and says so.
    const opened = await processToolCalls(serverWs, `[TOOL: memory/memory_expand {"ref": "${oldRef}"}]`, connection);
    expect(opened[0].status).toBe('ok');
    expect(opened[0].content).toContain('lifecycle: superseded');
    expect(opened[0].content).toContain(replacement.id);
  }, 30000);

  test('memory_retract and memory_archive: out of recall, stamped on disk, never deleted', async () => {
    await resetPolicy(NEUMA_ID);
    const connection = freshConnection();
    armResolver(connection);
    setDecide(() => { throw new Error('Decision #8 is signed — nothing here may ask'); });

    const retractRef = await noteViaTool(connection, 'the quillmark tide turned on the third bell', 'note');
    const retracted = await viaIntent(connection, 'memory/retract',
      { ref: retractRef, reason: 'I misread the tide' });
    expect(retracted[0].status).toBe('ok');

    const archiveRef = await noteViaTool(connection, 'the ashflower season of my first year, complete', 'note');
    const archived = await viaIntent(connection, 'memory/archive',
      { ref: archiveRef, reason: 'the season is closed' });
    expect(archived[0].status).toBe('ok');

    const staleTide = await processToolCalls(serverWs, '[TOOL: memory/memory_search {"query": "quillmark tide third bell"}]', connection);
    expect(staleTide[0].content).not.toContain(retractRef);
    const staleSeason = await processToolCalls(serverWs, '[TOOL: memory/memory_search {"query": "ashflower season first year"}]', connection);
    expect(staleSeason[0].content).not.toContain(archiveRef);

    const observations = await workspace.listObservations(NEUMA_ID);
    const retractedRec = observations.find((o) => o.memoryRef === retractRef);
    expect(retractedRec.lifecycle).toBe('retracted');
    expect(retractedRec.reason).toBe('I misread the tide');
    expect(retractedRec.invalidatedAt).toBeTruthy();
    const archivedRec = observations.find((o) => o.memoryRef === archiveRef);
    expect(archivedRec.lifecycle).toBe('archived');
    expect(archivedRec.reason).toBe('the season is closed');
  }, 30000);

  test('memory_merge: two notes fold into one canonical, both sources point at it', async () => {
    await resetPolicy(NEUMA_ID);
    const connection = freshConnection();
    armResolver(connection);
    setDecide(() => { throw new Error('Decision #8 is signed — nothing here may ask'); });

    const refA = await noteViaTool(connection, 'the lanternfly swarm gathers at the east gate', 'fact');
    const refB = await noteViaTool(connection, 'the lanternfly swarm answers to the dusk whistle', 'fact');
    const merged = await viaIntent(connection, 'memory/merge', {
      refs: [refA, refB],
      content: 'the lanternfly swarm gathers at the east gate and answers to the dusk whistle — one fact, not two',
      kind: 'fact',
    });
    expect(merged[0].status).toBe('ok');
    const canonicalRef = merged[0].content.match(/mem_note_\d+_[a-f0-9]{8}/)?.[0];
    expect(canonicalRef).toBeTruthy();

    const found = await processToolCalls(serverWs, '[TOOL: memory/memory_search {"query": "lanternfly swarm one fact not two"}]', connection);
    expect(found[0].content).toContain(canonicalRef);

    const observations = await workspace.listObservations(NEUMA_ID);
    const canonical = observations.find((o) => o.memoryRef === canonicalRef);
    for (const sourceRef of [refA, refB]) {
      const source = observations.find((o) => o.memoryRef === sourceRef);
      expect(source.lifecycle).toBe('superseded');
      expect(source.supersededBy).toBe(canonical.id);
      expect(source.reason).toContain('merged into');
    }

    // Duplicate refs refuse BEFORE anything is written.
    const duped = await viaIntent(connection, 'memory/merge',
      { refs: [refA, refA], content: 'a dishonest fold' });
    expect(duped[0].status).toBe('error');
    expect(duped[0].error).toContain('only once');
  }, 30000);

  // Pure store semantics of the retained audit walk. Requestable OBSERVE
  // dispatch and advertisement are proven in api-memory-tools-access.test.js.
  test('the memory walk covers the WHOLE record — active beside lifecycle-stamped, with provenance, paged', async () => {
    await resetPolicy(NEUMA_ID);
    const connection = freshConnection();
    armResolver(connection);
    setDecide(() => { throw new Error('Decision #8 is signed — nothing here may ask'); });

    const liveRef = await noteViaTool(connection, 'the fernlight hypothesis still stands', 'identity');
    const deadRef = await noteViaTool(connection, 'the mothwing conjecture, now disproven', 'note');
    const retracted = await viaIntent(connection, 'memory/retract',
      { ref: deadRef, reason: 'disproven by the glasshouse trial' });
    expect(retracted[0].status).toBe('ok');

    const walk = (opts) => listMemories({ neumaId: NEUMA_ID, ...opts }, { workspace });

    const listed = await walk({ limit: 25 });
    expect(listed.ok).toBe(true);
    expect(listed.content).toContain('Memories 1–');
    // The deliberate notes carry their refs, their kind, their provenance.
    expect(listed.content).toContain(liveRef);
    expect(listed.content).toContain('self-note/identity');
    expect(listed.content).toContain('self-authored');
    // The retracted note is still on the walk — the audit surface shows both.
    expect(listed.content).toContain(deadRef);
    expect(listed.content).toContain('· retracted');
    expect(listed.content).toContain('· active');

    // Paging: a window of one, then the next window — different entries, honestly counted.
    const first = await walk({ limit: 1 });
    expect(first.content).toContain('Memories 1–1 of');
    expect(first.content).toContain('page with offset 1');
    const second = await walk({ limit: 1, offset: 1 });
    expect(second.content).toContain('Memories 2–2 of');
    expect(second.content).not.toContain(first.content.split('\n')[1]);

    // kind filtering narrows the walk.
    const identityOnly = await walk({ kind: 'identity' });
    expect(identityOnly.ok).toBe(true);
    expect(identityOnly.content).toContain(liveRef);
    expect(identityOnly.content).not.toContain('mothwing');
  }, 30000);

  test('hostile lifecycle: malformed, foreign, and nowhere refs refuse explicitly — nothing written', async () => {
    await resetPolicy(NEUMA_ID);
    const connection = freshConnection();
    armResolver(connection);
    setDecide(() => { throw new Error('Decision #8 is signed — nothing here may ask'); });

    const before = await workspace.listObservations(NEUMA_ID);
    const victimRef = await noteViaTool(connection, 'the palemeridian axiom must survive every attack', 'fact');

    // Malformed ref — same words the tool path gave, but the guard MOVED: the
    // intent's validate only checks a ref is PRESENT, so a traversal ref reaches
    // memory-lifecycle.js and resolveRefToObservation refuses it there. One
    // layer deeper, still closed. Asserted on the exact message, not a
    // substring that would pass even with the guard gone.
    const malformed = await viaIntent(connection, 'memory/retract', { ref: 'mem_../../etc_1_deadbeef' });
    expect(malformed[0].status).toBe('error');
    expect(malformed[0].error).toContain('not a valid mem_ ref');

    // A ref that resolves nowhere in this life.
    const nowhere = await viaIntent(connection, 'memory/archive', { ref: 'mem_note_1753290000123_deadbeef' });
    expect(nowhere[0].status).toBe('error');
    expect(nowhere[0].error).toContain('no memory at that ref');

    // A FOREIGN being presenting this being's valid ref misses in its own life.
    // The intent takes its lane from the CONNECTION, never the payload — the
    // isolation is structural, not a check.
    const foreign = freshConnection({ companion: { name: 'MemoryOther', neumaId: OTHER_ID }, sessionId: 'sess-other' });
    const crossfire = await viaIntent(foreign, 'memory/supersede',
      { ref: victimRef, content: 'a foreign overwrite attempt' });
    expect(crossfire[0].status).toBe('error');
    expect(crossfire[0].error).toContain('no memory at that ref');

    // Nothing was written: one note added, zero invalidated, the victim untouched.
    const after = await workspace.listObservations(NEUMA_ID);
    expect(after).toHaveLength(before.length + 1);
    const victim = after.find((o) => o.memoryRef === victimRef);
    expect(victim.invalidatedAt).toBeUndefined();
    expect(victim.lifecycle).toBeUndefined();
    expect(after.some((o) => o.content === 'a foreign overwrite attempt')).toBe(false);
  }, 30000);
});
