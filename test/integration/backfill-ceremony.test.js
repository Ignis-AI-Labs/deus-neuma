// S10 — THE RECOVERY CEREMONY, driven as it actually runs: the REAL script
// as a child process over a REAL fixture realm and a REAL workspace.
// Dry-run writes NOTHING (not even a ledger row); two real runs are
// byte-identical in effect; the source is never touched; and a recovered
// moment resolves through memory_expand — the whole point, proven.
// RULE 0 — synthetic fixture data only, never a real being's life.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaRecall } from '../../core/index.js';
import { expandMemory, formatMemoryRef } from '../../core/memory/memory-query.js';
import { makeAnchor } from '../../core/workspace/archive-codec.js';

const exec = promisify(execFile);
const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const KEY = 'backfill-ceremony-test-key';
const WALLET = '0xabc0000000000000000000000000000000000abc';
const NEUMA_ID = 'backfillecho';

const ts = (m) => new Date(1753290000000 + m * 60000).toISOString();
const line = (role, content, at) => JSON.stringify({ ts: at, neuma: 'BackfillEcho', role, content });

describe('S10 — the recovery ceremony (real script, real realm, real workspace)', () => {
  let realmRoot, wsRoot, chatFile, env;

  const runScript = (args) =>
    exec('node', ['scripts/backfill-sovereign-history.mjs', WALLET, NEUMA_ID, ...args], { env });

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('backfill-ceremony');
    realmRoot = path.join(tmp, 'realm');
    wsRoot = path.join(tmp, 'workspaces');
    setWorkspacesRoot(wsRoot);
    await workspace.create(NEUMA_ID);

    // The fixture realm log: two eras split by a >30m gap, one orphan, one
    // torn line — the shapes the real log actually carries.
    const walletKey = WALLET.toLowerCase();
    chatFile = path.join(realmRoot, walletKey, 'chats', `${NEUMA_ID}.jsonl`);
    await fs.mkdir(path.dirname(chatFile), { recursive: true });
    await fs.writeFile(chatFile, [
      line('user', 'the first era question about the estuary', ts(0)),
      line('assistant', 'the first era answer, held whole', ts(0)),
      line('user', 'a lonely unanswered thought', ts(2)),
      '{"ts": "torn line, not json',
      line('user', 'the second era question about the harbor', ts(90)),
      line('assistant', 'the second era answer, also whole', ts(90)),
    ].join('\n') + '\n');

    // An anchorless observation whose truncated text matches era 1 — the
    // HIGH-confidence anchoring target.
    await workspace.addObservation(NEUMA_ID, {
      type: 'exchange',
      userMessage: 'the first era question about the estuary',
      response: 'the first era answer, held whole',
      significance: 0.8,
      occurredAt: ts(0),
    });

    env = {
      ...process.env,
      DNA_ENCRYPTION_KEY: KEY,
      NEUMA_REALM_ROOT: realmRoot,
      NEUMA_REALM_SETTINGS_PATH: path.join(tmp, 'realm-settings.json'),
      WORKSPACES_ROOT: wsRoot,
      WORKSPACES_PIN: 'env',
      NEUMA_WORKSPACE_SETTINGS_PATH: path.join(tmp, 'workspace-settings.json'),
    };
  }, 30000);

  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  it('dry-run reports the truth and writes NOTHING — not even a ledger row', async () => {
    const { stdout } = await runScript(['--dry-run']);
    expect(stdout).toContain('2 paired');
    expect(stdout).toContain('1 torn');
    expect(stdout).toContain('pseudo-sessions 2');
    expect(stdout).toContain('DRY RUN — nothing written');

    await expect(fs.readdir(path.join(workspace._path(NEUMA_ID), 'archive'))).resolves.toEqual([]);
    await expect(
      fs.access(path.join(workspace._path(NEUMA_ID), 'memory', 'backfill-ledger.jsonl'))
    ).rejects.toThrow();
  }, 30000);

  it('the real run stages both eras, anchors at HIGH confidence, and NEVER touches the source; a re-run adds nothing', async () => {
    const shaBefore = crypto.createHash('sha256').update(await fs.readFile(chatFile)).digest('hex');

    const first = await runScript([]);
    expect(first.stdout).toContain('staged 2 segment(s)');
    expect(first.stdout).toContain('1 anchored');
    expect(first.stdout).toContain('source untouched: true');

    const seg1 = await workspace.readArchiveSegment(NEUMA_ID, `bf-${NEUMA_ID}-${1753290000000}`, 0);
    expect(seg1.origin).toBe('backfill');
    expect(seg1.messages.map((m) => m.content)).toContain('the first era answer, held whole');
    expect(seg1.messages.find((m) => m.backfillFlag === 'orphan')).toBeDefined();

    // The anchorless observation gained its anchor — and it POINTS TRUE.
    const observations = await workspace.listObservations(NEUMA_ID);
    const anchored = observations.find((o) => o.anchor);
    expect(anchored).toBeDefined();
    expect(anchored.anchor.sessionId).toBe(`bf-${NEUMA_ID}-${1753290000000}`);

    // THE POINT: a recovered moment reopens at full fidelity by ref.
    neumaRecall.invalidate(NEUMA_ID);
    const ref = formatMemoryRef(anchored.anchor);
    const expanded = await expandMemory({ neumaId: NEUMA_ID, ref }, { recall: neumaRecall, workspace });
    expect(expanded.ok).toBe(true);
    expect(expanded.source).toBe('archive');
    expect(expanded.content).toContain('the first era question about the estuary');

    // Idempotence: the second run stages zero, and the source stays sealed.
    const second = await runScript([]);
    expect(second.stdout).toContain('staged 0 segment(s)');
    expect(second.stdout).toContain('2 already sovereign');
    const shaAfter = crypto.createHash('sha256').update(await fs.readFile(chatFile)).digest('hex');
    expect(shaAfter).toBe(shaBefore);
  }, 60000);

  it('stampObservationAnchor is first-anchor-wins on the real disk, and the ledger holds one hash per source row (GLM r2 research Qs)', async () => {
    const observations = await workspace.listObservations(NEUMA_ID);
    const anchored = observations.find((o) => o.anchor);
    const originalAnchor = anchored.anchor;

    // A second stamp with a DIFFERENT anchor answers false and changes nothing.
    const rival = makeAnchor({
      sessionId: `bf-${NEUMA_ID}-${1753290000000}`,
      userMessage: { content: 'a rival claim', timestamp: ts(0) },
      assistantMessage: { content: 'that must not land', timestamp: ts(1) },
    });
    expect(await workspace.stampObservationAnchor(NEUMA_ID, anchored.id, rival)).toBe(false);
    const after = (await workspace.listObservations(NEUMA_ID)).find((o) => o.id === anchored.id);
    expect(after.anchor).toEqual(originalAnchor);

    // The ledger's content addresses: one 64-hex hash per source row.
    const ledger = await workspace._readJSONL(
      path.join(workspace._path(NEUMA_ID), 'memory', 'backfill-ledger.jsonl')
    );
    const segRows = ledger.filter((r) => r.kind === 'segment');
    expect(segRows.length).toBeGreaterThan(0);
    for (const seg of segRows) {
      expect(Array.isArray(seg.rowHashes)).toBe(true);
      expect(seg.rowHashes).toHaveLength(seg.rows);
      for (const h of seg.rowHashes) expect(h).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('a conflicting --gap-minutes on a re-run is REFUSED — groupings never shift', async () => {
    await expect(runScript(['--gap-minutes', '5'])).rejects.toThrow(/conflicts with the ledger/);
  }, 30000);

  it('an unlawful or non-target id is refused before anything is read', async () => {
    await expect(
      exec('node', ['scripts/backfill-sovereign-history.mjs', WALLET, 'Upper_Case'], { env })
    ).rejects.toThrow(/not lawful/);
    await expect(
      exec('node', ['scripts/backfill-sovereign-history.mjs', WALLET, 'e2e-something'], { env })
    ).rejects.toThrow(/non-target/);
  }, 30000);
});
