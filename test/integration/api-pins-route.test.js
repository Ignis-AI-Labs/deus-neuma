// S9 — the witness's pins window (FR-P4-05): REAL router, REAL workspace on
// real disk, REAL encrypted ledger, REAL auth (#390 tranche 4), with
// ownership proven both ways. Active pins ONLY — the superseded history
// stays the being's own.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const REF_HELD = 'mem_sess-a_1753290000000_abcdef01';
const REF_RELEASED = 'mem_sess-b_1753290000001_abcdef02';

describe('GET /api/v1/workspace/:id/pins (the witness window)', () => {
  let app, workspace, setWorkspacesRoot, neumaId, witness, strangerWitness;

  const buildApp = async () => {
    const { default: router } = await import('../../backend/routes/workspace-routes.js');
    const built = express();
    built.use(express.json());
    built.use('/api/v1/workspace', router);
    return built;
  };

  beforeEach(async () => {
    vi.resetModules();
    process.env.DNA_ENCRYPTION_KEY = 'api-pins-route-test-key';

    // Imported AFTER resetModules — the token must be minted from the same
    // auth.js instance the router will verify against (memoized HMAC secret
    // per module instance; a stale import 401s honestly).
    let witnessFor;
    ({ witnessFor, strangerWitness } = await import('../helpers/witness.js'));

    ({ default: workspace, setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js'));
    const tmp = await createTempDir(`pins-route-${Math.random().toString(36).slice(2)}`);
    const workspacesRoot = path.join(tmp, 'workspaces');
    setWorkspacesRoot(workspacesRoot);

    neumaId = 'pinsroute-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(neumaId);
    witness = await witnessFor(workspacesRoot, neumaId);
    const { applyPin, applyUnpin } = await import('../../core/memory/pin-ledger.js');
    const NOW = '2026-07-24T11:00:00.000Z';
    await workspace.updatePinLedger(neumaId, (pins) => applyPin(pins, { ref: REF_HELD, note: 'held close', now: NOW }));
    await workspace.updatePinLedger(neumaId, (pins) => applyPin(pins, { ref: REF_RELEASED, now: NOW }));
    await workspace.updatePinLedger(neumaId, (pins) => applyUnpin(pins, { ref: REF_RELEASED, now: NOW }));

    app = await buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot?.(null);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  it('returns ACTIVE pins only — the released anchor stays the being\'s own history', async () => {
    const res = await request(app).get(`/api/v1/workspace/${neumaId}/pins`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.pins).toEqual([
      { ref: REF_HELD, note: 'held close', pinnedAt: '2026-07-24T11:00:00.000Z' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(REF_RELEASED);
  });

  it('a foreign wallet is refused at the ownership wall', async () => {
    const stranger = strangerWitness();
    const res = await request(app).get(`/api/v1/workspace/${neumaId}/pins`).set(stranger.header);
    expect(res.status).toBe(403);
  });

  it('a rotted ledger answers 500 — loud, never an empty lie', async () => {
    await fs.writeFile(workspace._pinLedgerPath(neumaId), 'rotten ledger bytes');
    const res = await request(app).get(`/api/v1/workspace/${neumaId}/pins`).set(witness.header);
    expect(res.status).toBe(500);
  });
});
