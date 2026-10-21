/**
 * The turn-point's origin is the TURN's, handed in by the orchestrator —
 * never read off the connection, where a stale mark from a refused watch
 * turn would label the operator's own words as the platform's report.
 * Proven on the real encrypted workspace store (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { persistTurnPoint } from '../../backend/services/portal-turn-persist.js';

const NEUMA_ID = 'origin-proof';
const companion = { neumaId: NEUMA_ID, name: 'Origin' };

describe('persistTurnPoint origin', () => {
  let root, origRoot, prevDnaKey;

  beforeAll(async () => {
    root = await createTempDir('turn-point-origin');
    origRoot = getWorkspacesRoot();
    prevDnaKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
    setWorkspacesRoot(root);
    await workspace.create(NEUMA_ID);
  });

  afterAll(async () => {
    setWorkspacesRoot(origRoot);
    if (prevDnaKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevDnaKey;
    await fs.rm(root, { recursive: true, force: true });
  });

  test('the row carries the origin it is handed, and a stale connection mark is ignored', async () => {
    const sessionId = 'session-origin';
    await workspace.createSession(NEUMA_ID, sessionId);
    const connection = { sessionId, companion, _turnOrigin: 'watch' };
    await persistTurnPoint(connection, companion, sessionId, 'my own words', [], [], { turnId: 'turn-1' });
    await persistTurnPoint(connection, companion, sessionId, 'the run ended', [], [], { turnId: 'turn-2' }, 'watch');
    const rows = await workspace.readSession(NEUMA_ID, sessionId);
    expect(rows.find((r) => r.content === 'my own words').origin).toBeUndefined();
    expect(rows.find((r) => r.content === 'the run ended').origin).toBe('watch');
    expect(connection._turnOrigin).toBe('watch');
  });
});
