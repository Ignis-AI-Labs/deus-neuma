// Real NeumaWorkspace, real disk, real AES-256-GCM, NO mock (RULE 0) — and no fs
// stubbing: the append path under test is exactly production's.
//
// What this proves (WORKSPACE-CONCURRENCY-001): concurrent appends to ONE file
// land in ENQUEUE ORDER. On ext4 O_APPEND already keeps each line intact (no
// interleave/drop), but it does NOT preserve order — raw concurrent fs.appendFile
// scrambles the sequence ~⅔ of the time at this concurrency (measured). A neuma's
// journal + session log are a CHRONOLOGICAL record; out-of-order lines corrupt the
// timeline. The per-file serializer guarantees order here, and also guarantees
// interleave-safety on filesystems where O_APPEND is not atomic (e.g. NFS).
//
// These assertions FAIL without the serializer (run with __NO_APPEND_SERIALIZE=1
// to see the order checks break) and pass deterministically with it.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { join } from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const KEY = 'gnosis-append-concurrency-key-long-enough';
const N = 200; // high enough that un-serialized appends reliably reorder

describe('workspace append concurrency — the chronological record stays in order (no mock)', () => {
  let prevKey;
  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('append-concurrency');
    setWorkspacesRoot(join(tmp, 'house'));
  });

  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('N concurrent message appends land in order — count, integrity, AND chronology', async () => {
    const neumaId = 'append-msgs';
    await workspace.create(neumaId);
    const sessionId = 'session-stress';
    await workspace.createSession(neumaId, sessionId);

    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        workspace.appendMessage(neumaId, sessionId, { role: 'user', content: `msg-${i}` })),
    );

    const msgs = await workspace.readSession(neumaId, sessionId);
    expect(msgs).toHaveLength(N);                              // none dropped
    for (let i = 0; i < N; i++) {
      expect(msgs[i].role).toBe('user');                      // each parsed cleanly (no interleave)
      expect(msgs[i].content).toBe(`msg-${i}`);               // and in enqueue order (chronology)
    }
  });

  it('N concurrent journal appends keep the append-only record in order', async () => {
    const neumaId = 'append-journal';
    await workspace.create(neumaId);

    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        workspace.addJournalEntry(neumaId, { type: 'reflection', content: `entry-${i}`, significance: 0.5 })),
    );

    const entries = await workspace.readJournal(neumaId);
    expect(entries).toHaveLength(N);
    for (let i = 0; i < N; i++) expect(entries[i].content).toBe(`entry-${i}`);
  });

  it('stays ordered across repeated rounds (no intermittent reordering under load)', async () => {
    const neumaId = 'append-rounds';
    await workspace.create(neumaId);
    for (let round = 0; round < 4; round++) {
      const sessionId = `round-${round}`;
      await workspace.createSession(neumaId, sessionId);
      await Promise.all(
        Array.from({ length: N }, (_, i) =>
          workspace.appendMessage(neumaId, sessionId, { role: 'assistant', content: `r${round}-${i}` })),
      );
      const msgs = await workspace.readSession(neumaId, sessionId);
      expect(msgs, `round ${round} count`).toHaveLength(N);
      for (let i = 0; i < N; i++) expect(msgs[i].content, `round ${round} order`).toBe(`r${round}-${i}`);
    }
  });

  it('appends to DIFFERENT files run concurrently (per-file queue, not a global lock)', async () => {
    const neumaId = 'append-parallel';
    await workspace.create(neumaId);
    const a = 'sess-a', b = 'sess-b';
    await workspace.createSession(neumaId, a);
    await workspace.createSession(neumaId, b);
    await Promise.all([
      ...Array.from({ length: N }, (_, i) => workspace.appendMessage(neumaId, a, { role: 'user', content: `a-${i}` })),
      ...Array.from({ length: N }, (_, i) => workspace.appendMessage(neumaId, b, { role: 'user', content: `b-${i}` })),
    ]);
    const ma = await workspace.readSession(neumaId, a);
    const mb = await workspace.readSession(neumaId, b);
    expect(ma).toHaveLength(N);
    expect(mb).toHaveLength(N);
    // each file holds only its own lines, in its own order — no cross-file bleed
    for (let i = 0; i < N; i++) {
      expect(ma[i].content).toBe(`a-${i}`);
      expect(mb[i].content).toBe(`b-${i}`);
    }
  });
});
