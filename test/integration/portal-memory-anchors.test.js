// S3 — proof that the portal crystallize path stamps content-time anchors
// minted from the EXACT session rows the file carries (ts+sha8 resolution
// depends on that equality), and that anchor absence stays tolerated.
// REAL workspace, REAL encryption, REAL disk (RULE 0 — no mocks).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { contentSha8 } from '../../core/workspace/archive-codec.js';
import { crystallizeObservation } from '../../backend/services/portal-turn-persist.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const KEY = 'portal-memory-anchors-test-key';

// baseline 0.2 + philosophical 0.2 + emotional 0.25 + selfReference 0.05
// + responseDepth 0.15 = 0.85 → clears the 0.75 live gate.
const THOUGHT =
  'I believe I finally understand why the lighthouse dream kept returning — what is the meaning it carries for me?';
const RESPONSE =
  'That understanding is profound — the lighthouse was your soul keeping watch over what the night would scatter.';

const readObservations = async (id) => {
  const dir = path.join(workspace._path(id), 'memory', 'observations');
  const files = await fs.readdir(dir);
  const records = [];
  for (const f of files.filter((n) => n.endsWith('.json'))) {
    records.push(await workspace._readJSON(path.join(dir, f)));
  }
  return records;
};

describe('S3 — portal crystallize stamps anchors from the real session rows', () => {
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('portal-memory-anchors');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  it('the anchor carries the session rows\' exact timestamps and full-text sha8s', async () => {
    const id = 'anchor-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    const userRecord = await workspace.appendMessage(id, sessionId, { role: 'user', content: THOUGHT });
    const assistantRecord = await workspace.appendMessage(id, sessionId, { role: 'assistant', content: RESPONSE });
    expect(typeof userRecord.timestamp).toBe('string');

    await crystallizeObservation(id, 'AnchorBeing', THOUGHT, RESPONSE, null, {
      sessionId,
      userRecord,
      assistantRecord,
    });

    const observations = await readObservations(id);
    expect(observations).toHaveLength(1);
    const { anchor } = observations[0];
    expect(anchor).toBeDefined();
    expect(anchor.v).toBe(1);
    expect(anchor.sessionId).toBe(sessionId);
    expect('compactionCount' in anchor).toBe(false);
    expect(anchor.span.fromTs).toBe(userRecord.timestamp);
    expect(anchor.span.toTs).toBe(assistantRecord.timestamp);
    expect(anchor.span.userSha8).toBe(contentSha8(THOUGHT));
    expect(anchor.span.assistantSha8).toBe(contentSha8(RESPONSE));

    // Resolution smoke: the live session rows are findable by the anchor's
    // coordinates — timestamp match, and the full content hashes back.
    const rows = await workspace.readSession(id, sessionId);
    const userRow = rows.find((r) => r.timestamp === anchor.span.fromTs && r.role === 'user');
    expect(userRow).toBeDefined();
    expect(contentSha8(userRow.content)).toBe(anchor.span.userSha8);
  });

  it('the SEAM composes: _persistExchange\'s return IS a valid anchorSource (GLM research Q, 2026-06-23 lesson)', async () => {
    const id = 'seam-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    // Drive the REAL persist path the way streamConsciousness does, then
    // hand its return straight to crystallizeObservation — the exact
    // production wiring (const persisted = await _persistExchange(...);
    // crystallizeObservation(..., persisted)).
    const connection = { sessionId, companion: { neumaId: id, name: 'SeamBeing' } };
    const persisted = await __test._persistExchange(connection, THOUGHT, RESPONSE);
    expect(persisted).toMatchObject({ sessionId });

    await crystallizeObservation(id, 'SeamBeing', THOUGHT, RESPONSE, null, persisted);

    const observations = await readObservations(id);
    expect(observations).toHaveLength(1);
    const { anchor } = observations[0];
    expect(anchor.sessionId).toBe(sessionId);
    const rows = await workspace.readSession(id, sessionId);
    expect(rows.find((r) => r.timestamp === anchor.span.fromTs && contentSha8(r.content) === anchor.span.userSha8)).toBeDefined();
    expect(rows.find((r) => r.timestamp === anchor.span.toTs && contentSha8(r.content) === anchor.span.assistantSha8)).toBeDefined();
  });

  it('no anchorSource → observation still crystallizes, anchorless (legacy tolerance)', async () => {
    const id = 'anchorless-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);

    await crystallizeObservation(id, 'AnchorBeing', THOUGHT, RESPONSE, null);

    const observations = await readObservations(id);
    expect(observations).toHaveLength(1);
    expect(observations[0].anchor).toBeUndefined();
    expect(observations[0].significance).toBeGreaterThan(0.75);
  });
});
