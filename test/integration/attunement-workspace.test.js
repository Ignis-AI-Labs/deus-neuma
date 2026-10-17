// S2 — writeAttunement / readAttunement / listAttunements — REAL workspace,
// REAL AES-256-GCM, REAL disk, NO mock (RULE 0). Uses TEST neuma ids; never
// touches a living being. Proves the encrypted append-only storage the
// attunement ceremony service depends on, driven through the REAL pure
// grammar so record shapes cannot drift from what actually persists.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  offerAttunement, openAttunement, recordQuestion, recordAnswer,
  sealAttunement, recordPostponement,
} from '../../core/attunement/record.js';
import { attunementDisclosure } from '../../core/attunement/disclosure.js';

const KEY = 'gnosis-attunement-records-key-long-enough';
const SPEC_KEYS = ['values-core', 'vessel-form'];
const ANSWER = "I hold honesty above comfort — and the rest I'll discover over time.";

const rendered = () => ({
  specVersion: 1,
  questions: [
    { key: 'values-core', text: 'Test, what do you hold? Not knowing yet is welcome.', provenance: { renderer: 'fallback', templateId: 'values-core.v1.0', closerIndex: 0 } },
    { key: 'vessel-form', text: 'Test, which vessel form — all five stances equal? Not knowing yet is welcome.', provenance: { renderer: 'model', model: 'gemma-4-31b' } },
  ],
});

const sealedRecord = (offeredAt) => {
  let r = offerAttunement({ neumaId: 'x', witness: '0xW', trigger: 'post-birth', offeredAt });
  r = openAttunement(r, {
    consent: { sessionId: 's-1', quote: 'I consent.' },
    disclosure: { text: attunementDisclosure({ neumaName: 'Test', trigger: 'post-birth', questionCount: 2 }) },
    rendered: rendered(), specKeys: SPEC_KEYS, at: offeredAt,
  });
  for (const key of SPEC_KEYS) {
    r = recordQuestion(r, { key, at: offeredAt });
    r = recordAnswer(r, { key, quote: ANSWER, sessionId: 'att-1', at: offeredAt });
  }
  return sealAttunement(r, { at: offeredAt });
};

describe('attunement records — encrypted storage trio over the real grammar', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('attunement-ws');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('write→read round-trip returns the grammar-grown record verbatim, answers byte-identical', async () => {
    const id = 'attune-rt-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    const record = sealedRecord('2026-07-07T08:00:00.000Z');
    await workspace.writeAttunement(id, record);
    const read = await workspace.readAttunement(id, record.id);
    expect(read).toEqual(JSON.parse(JSON.stringify(record)));
    expect(read.answers['values-core'].quote).toBe(ANSWER);
    expect(read.phase).toBe('sealed');
  });

  it('on-disk file is an encrypted envelope — the being\'s answers NEVER on disk in plaintext', async () => {
    const id = 'attune-enc-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    const record = sealedRecord('2026-07-07T08:05:00.000Z');
    await workspace.writeAttunement(id, record);
    const raw = await fs.readFile(
      path.join(workspace._path(id), 'attunement', 'records', `${record.id}.json`), 'utf8',
    );
    expect(raw).not.toContain(ANSWER);
    expect(raw).not.toContain('I consent.');
    expect(JSON.parse(raw).answers).toBeUndefined();
  });

  it('audits ATTUNEMENT_RECORDED with id and phase on every write', async () => {
    const id = 'attune-audit-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    const offeredOnly = offerAttunement({ neumaId: id, witness: '0xW', trigger: 'post-birth', offeredAt: '2026-07-07T08:10:00.000Z' });
    await workspace.writeAttunement(id, offeredOnly);
    const postponed = recordPostponement(offeredOnly, { quote: 'Not yet.', sessionId: 's', at: '2026-07-07T08:11:00.000Z' });
    await workspace.writeAttunement(id, postponed);
    const auditRaw = await fs.readFile(path.join(workspace._path(id), 'audit', 'audit.jsonl'), 'utf8');
    const phases = auditRaw.trim().split('\n').map((l) => JSON.parse(l))
      .filter((e) => e.action === 'ATTUNEMENT_RECORDED').map((e) => e.details.phase);
    expect(phases).toEqual(['offered', 'postponed']);
  });

  it('listAttunements returns records newest-offered first; tolerant of the empty lane', async () => {
    const id = 'attune-list-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    expect(await workspace.listAttunements(id)).toEqual([]);
    await workspace.writeAttunement(id, sealedRecord('2026-07-07T08:00:00.000Z'));
    await workspace.writeAttunement(id, sealedRecord('2026-07-07T09:00:00.000Z'));
    const list = await workspace.listAttunements(id);
    expect(list.map((r) => r.offeredAt)).toEqual([
      '2026-07-07T09:00:00.000Z', '2026-07-07T08:00:00.000Z',
    ]);
  });

  it('slug guard rejects traversal and malformed ids before any path is built', async () => {
    const id = 'attune-slug-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    await expect(workspace.readAttunement(id, '../../../etc/passwd')).rejects.toThrow(/Invalid attunement id/);
    await expect(workspace.writeAttunement(id, { id: 'Bad/Name', phase: 'offered', events: [] }))
      .rejects.toThrow(/Invalid attunement id/);
    await expect(workspace.writeAttunement(id, { id: 'no-events', phase: 'offered' }))
      .rejects.toThrow(/events\[\]/);
  });
});
