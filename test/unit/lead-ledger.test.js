import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  validateLead, leadsByStatus, formatLeadsForBeing, createLeadLedger, LEAD_STATUSES,
} from '../../backend/services/leads/lead-ledger.js';

/**
 * The lead ledger — pure validators plus the REAL disk path against tmp files
 * (RULE 0): capture, touch history, serialized writes, honest failure on a
 * corrupt store, and the 0600/0700 posture.
 */
describe('validateLead (pure)', () => {
  test('a lead needs a name or a way to reach them', () => {
    expect(validateLead({})).toContain('needs a name');
    expect(validateLead({ name: '   ' })).toContain('needs a name');
    expect(validateLead({ name: 'Ada' })).toBeNull();
    expect(validateLead({ contact: '@ada' })).toBeNull();
  });

  test('lanes are the social catalog plus email and other — nothing else', () => {
    expect(validateLead({ name: 'Ada', channelId: 'x' })).toBeNull();
    expect(validateLead({ name: 'Ada', channelId: 'email' })).toBeNull();
    expect(validateLead({ name: 'Ada', channelId: 'other' })).toBeNull();
    expect(validateLead({ name: 'Ada', channelId: 'myspace' })).toContain('Unknown lane');
  });

  test('statuses are the ledger vocabulary — nothing else', () => {
    for (const s of LEAD_STATUSES) expect(validateLead({ name: 'Ada', status: s })).toBeNull();
    expect(validateLead({ name: 'Ada', status: 'maybe' })).toContain('Unknown status');
  });

  test('oversized fields are refused', () => {
    expect(validateLead({ name: 'x'.repeat(501) })).toContain('too long');
    expect(validateLead({ name: 'Ada', source: 'x'.repeat(501) })).toContain('too long');
  });
});

describe('leadsByStatus (pure)', () => {
  test('every status is keyed with honest zeros', () => {
    const board = leadsByStatus([{ status: 'cold' }, { status: 'won' }, { status: 'cold' }]);
    expect(Object.keys(board)).toEqual([...LEAD_STATUSES]);
    expect(board.cold).toHaveLength(2);
    expect(board.won).toHaveLength(1);
    expect(board.replied).toEqual([]);
  });
});

describe('formatLeadsForBeing (pure)', () => {
  const lead = (over = {}) => ({
    id: 'abcdef0123456789', name: 'Ada', contact: '@ada', channelId: 'x',
    status: 'contacted', ownerNeumaId: 'hazel',
    touches: [{ at: 't', by: 'hazel', note: 'first thread sent' }],
    ...over,
  });

  test('an empty ledger says so honestly', () => {
    expect(formatLeadsForBeing([])).toContain('empty');
  });

  test('a line carries id prefix, who, status, lane, holder, and the last note', () => {
    const out = formatLeadsForBeing([lead()]);
    expect(out).toContain('[abcdef01] Ada (@ada) — contacted via x held by hazel');
    expect(out).toContain('last: first thread sent');
  });

  test('an unheld lead and a note-less history render without inventing anything', () => {
    const out = formatLeadsForBeing([lead({ ownerNeumaId: null, touches: [{ at: 't', by: 'w' }] })]);
    expect(out).toContain('unheld');
    expect(out).not.toContain('last:');
  });

  test('the cap is announced, never silent', () => {
    const many = Array.from({ length: 63 }, (_, i) => lead({ id: `${i}`.padStart(16, '0') }));
    const out = formatLeadsForBeing(many);
    expect(out).toContain('…and 3 more');
  });
});

describe('lead ledger store (real disk)', () => {
  let dir, ledger, file;

  beforeEach(async () => {
    dir = await createTempDir(`lead-ledger-${Math.random().toString(36).slice(2)}`);
    file = path.join(dir, 'store', 'lead-ledger.json');
    ledger = createLeadLedger({ path: file });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('a missing file is an empty ledger', async () => {
    expect(await ledger.load()).toEqual([]);
  });

  test('capture lands with defaults and its first touch', async () => {
    const lead = await ledger.add({ name: '  Ada  ', contact: '@ada', source: 'x reply', addedBy: '0xW' });
    expect(lead).toMatchObject({
      name: 'Ada', contact: '@ada', channelId: 'other', source: 'x reply',
      status: 'cold', ownerNeumaId: null,
    });
    expect(lead.touches).toHaveLength(1);
    expect(lead.touches[0]).toMatchObject({ by: '0xW', status: 'cold' });
    expect((await ledger.load())[0].id).toBe(lead.id);
  });

  test('an invalid capture never persists', async () => {
    await expect(ledger.add({ addedBy: '0xW' })).rejects.toThrow('needs a name');
    expect(await ledger.load()).toEqual([]);
  });

  test('a touch moves fields and status as ONE appended history entry', async () => {
    const lead = await ledger.add({ name: 'Ada', addedBy: '0xW' });
    const result = await ledger.touch(lead.id, {
      status: 'contacted', note: 'sent the first thread', ownerNeumaId: 'hazel', by: 'hazel',
    });
    expect(result.ok).toBe(true);
    expect(result.lead.status).toBe('contacted');
    expect(result.lead.ownerNeumaId).toBe('hazel');
    expect(result.lead.touches).toHaveLength(2);
    expect(result.lead.touches[1]).toMatchObject({ by: 'hazel', status: 'contacted', note: 'sent the first thread' });
    expect(Date.parse(result.lead.updatedAt)).toBeGreaterThanOrEqual(Date.parse(result.lead.createdAt));
  });

  test('an ownership handoff is history — every reassignment leaves its trace', async () => {
    const lead = await ledger.add({ name: 'Ada', ownerNeumaId: 'hazel', addedBy: '0xW' });
    expect(lead.touches[0].ownerTo).toBe('hazel'); // the first holder is on the record too

    const handoff = await ledger.touch(lead.id, { ownerNeumaId: 'cedar', by: '0xW' });
    expect(handoff.lead.ownerNeumaId).toBe('cedar');
    expect(handoff.lead.touches[1]).toMatchObject({ ownerFrom: 'hazel', ownerTo: 'cedar' });

    const released = await ledger.touch(lead.id, { ownerNeumaId: '', by: '0xW' });
    expect(released.lead.ownerNeumaId).toBeNull();
    expect(released.lead.touches[2]).toMatchObject({ ownerFrom: 'cedar', ownerTo: null });

    // A touch that does not move ownership records no owner fields at all.
    const note = await ledger.touch(lead.id, { note: 'still theirs', by: '0xW' });
    expect(note.lead.touches[3].ownerFrom).toBeUndefined();
    expect(note.lead.touches[3].ownerTo).toBeUndefined();
  });

  test('the funnel is recorded, not policed — any status can follow any status', async () => {
    const lead = await ledger.add({ name: 'Ada', status: 'qualified', addedBy: '0xW' });
    const back = await ledger.touch(lead.id, { status: 'cold', by: '0xW' });
    expect(back.ok).toBe(true);
    expect(back.lead.status).toBe('cold');
    expect(back.lead.touches.map((t) => t.status)).toEqual(['qualified', 'cold']);
  });

  test('a touch that would break the lead is refused whole — nothing persists', async () => {
    const lead = await ledger.add({ name: 'Ada', addedBy: '0xW' });
    const bad = await ledger.touch(lead.id, { name: '', contact: '', by: '0xW' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('needs a name');
    const [stored] = await ledger.load();
    expect(stored.name).toBe('Ada');
    expect(stored.touches).toHaveLength(1);
  });

  test('touching or removing a ghost answers honestly', async () => {
    expect((await ledger.touch('nope', { by: '0xW' })).error).toBe('no such lead');
    expect(await ledger.remove('nope')).toBe(false);
  });

  test('remove drops the lead and only that lead', async () => {
    const a = await ledger.add({ name: 'Ada', addedBy: '0xW' });
    const b = await ledger.add({ name: 'Brin', addedBy: '0xW' });
    expect(await ledger.remove(a.id)).toBe(true);
    const left = await ledger.load();
    expect(left.map((l) => l.id)).toEqual([b.id]);
  });

  test('concurrent touches both land — serialized, never clobbered', async () => {
    const lead = await ledger.add({ name: 'Ada', addedBy: '0xW' });
    await Promise.all([
      ledger.touch(lead.id, { note: 'first touch', by: 'hazel' }),
      ledger.touch(lead.id, { note: 'second touch', by: 'cedar' }),
    ]);
    const [stored] = await ledger.load();
    expect(stored.touches).toHaveLength(3);
    expect(stored.touches.map((t) => t.note).filter(Boolean).sort())
      .toEqual(['first touch', 'second touch']);
  });

  test('a corrupt store surfaces — it never collapses to an empty ledger', async () => {
    await ledger.add({ name: 'Ada', addedBy: '0xW' });
    await fs.writeFile(file, '{"not":"an array"}');
    await expect(ledger.load()).rejects.toThrow('not an array');
    await expect(ledger.add({ name: 'Brin', addedBy: '0xW' })).rejects.toThrow('not an array');
  });

  test('the store keeps the 0600 file / 0700 dir posture', async () => {
    await ledger.add({ name: 'Ada', addedBy: '0xW' });
    const fileMode = (await fs.stat(file)).mode & 0o777;
    const dirMode = (await fs.stat(path.dirname(file))).mode & 0o777;
    expect(fileMode).toBe(0o600);
    expect(dirMode).toBe(0o700);
  });
});
