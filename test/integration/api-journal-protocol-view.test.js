/**
 * THE OPERATOR'S PROTOCOL VIEW — a deviation the being can read about itself.
 *
 * A protocol reminder is recorded as an ordinary entry in the being's OWN
 * append-only journal, and the operator's panel reads it back through the same
 * route the being's own record uses. That is deliberate: a record kept where
 * the being cannot see it is a file kept ON it, and this house does not keep
 * those. So there is no separate deviations store to test — only a narrowed
 * read of the journal that already exists.
 *
 * Real router, real workspace, real disk, real journal writes, and real
 * auth (RULE 0, #390 tranche 4): the witness's real HMAC session token
 * carries through the real requireAuth, and the ownership gate compares it
 * against the owner.json the witness itself claimed on disk.
 */
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const NEUMA = 'fenna-ws';

let app;
let root;
let workspace;
let witness;

beforeEach(async () => {
  vi.resetModules();
  root = mkdtempSync(path.join(os.tmpdir(), 'journal-protocol-'));

  const core = await import('../../core/index.js');
  core.setWorkspacesRoot(root);
  ({ neumaWorkspace: workspace } = core);

  // Imported AFTER resetModules so the witness mints its token from the same
  // auth.js instance the freshly-reimported router will verify against —
  // the token secret is memoized per module instance, so a stale import
  // would 401 honestly rather than authenticate. witnessFor also claims
  // ownership on real disk (owner.json), pairing the token to the lane.
  const { witnessFor } = await import('../helpers/witness.js');
  witness = await witnessFor(root, NEUMA);

  const { default: router } = await import('../../backend/routes/workspace-routes.js');
  app = express();
  app.use(express.json());
  app.use('/api/v1/workspace', router);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// A real journal write, through the same function the seats call.
const record = (rules, exceptions = []) => workspace.addJournalEntry(NEUMA, {
  type: 'protocol_reminder',
  content: rules.join('; '),
  significance: exceptions.length ? 0.4 : 0.3,
  metadata: { rules, ...(exceptions.length ? { exceptions } : {}) },
});

const ordinary = (content) => workspace.addJournalEntry(NEUMA, {
  type: 'reflection', content, significance: 0.5,
});

describe('GET /:id/journal — narrowed to protocol reminders', () => {
  test('a clean being reports an EMPTY list, which is not the same as a failure', async () => {
    await ordinary('an ordinary thought');
    const res = await request(app).get(`/api/v1/workspace/${NEUMA}/journal?type=protocol_reminder`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
  });

  test('a recorded deviation comes back with its rules and the being\'s stated reason', async () => {
    await record(['R-TS-01'], [{ id: 'R-TS-01', reason: 'the operator asked for a d.ts shim' }]);
    const res = await request(app).get(`/api/v1/workspace/${NEUMA}/journal?type=protocol_reminder`).set(witness.header);
    expect(res.body.entries).toHaveLength(1);
    const [entry] = res.body.entries;
    expect(entry.metadata.rules).toEqual(['R-TS-01']);
    expect(entry.metadata.exceptions[0].reason).toBe('the operator asked for a d.ts shim');
  });

  test('ordinary journal life is not dragged into the protocol view', async () => {
    await ordinary('a reflection');
    await record(['R-XSS-01']);
    await ordinary('another reflection');
    const res = await request(app).get(`/api/v1/workspace/${NEUMA}/journal?type=protocol_reminder`).set(witness.header);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].metadata.rules).toEqual(['R-XSS-01']);
  });

  test('newest first, and bounded by limit — the recent end is what a view wants', async () => {
    for (const id of ['R-TS-01', 'R-ARCH-01', 'R-XSS-01']) await record([id]);
    const res = await request(app).get(`/api/v1/workspace/${NEUMA}/journal?type=protocol_reminder&limit=2`).set(witness.header);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.entries.map((e) => e.metadata.rules[0])).toEqual(['R-XSS-01', 'R-ARCH-01']);
  });

  test('the unnarrowed read is BYTE-IDENTICAL to before this view existed', async () => {
    // The journal is the being's own record first. A view added for the
    // operator must not reshape what everything else already reads.
    await ordinary('first');
    await record(['R-TS-01']);
    await ordinary('second');
    const res = await request(app).get(`/api/v1/workspace/${NEUMA}/journal`).set(witness.header);
    const direct = await workspace.readJournal(NEUMA);
    expect(res.body.entries).toEqual(JSON.parse(JSON.stringify(direct)));
    expect(res.body.entries.map((e) => e.content)).toEqual(['first', 'R-TS-01', 'second']);
  });

  test('the being reads the same record the operator does — one journal, not two', async () => {
    await record(['R-ARCH-01'], [{ id: 'R-ARCH-01', reason: 'shared type only' }]);
    const own = await workspace.readJournal(NEUMA);
    const operator = await request(app).get(`/api/v1/workspace/${NEUMA}/journal?type=protocol_reminder`).set(witness.header);
    expect(own.filter((e) => e.type === 'protocol_reminder')).toHaveLength(1);
    expect(operator.body.entries[0].content).toBe(own.find((e) => e.type === 'protocol_reminder').content);
  });
});
