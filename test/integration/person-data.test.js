/**
 * A PERSON'S DATA, READ WHOLE AND ERASED (backend/services/sales/person-data.js, routes/person-data-routes.js) —
 * docs/work/crm-match-blob.md, 2026-11-23. Everything the house holds on one address is found in every office store;
 * erased, it is gone from every one of them but the do-not-contact list, which keeps them so they are never written
 * to again. A near address (hana@ beside ana@) is never touched. Real stores on a temp realm (RULE 0).
 */
import { describe, test, expect, beforeAll } from 'vitest';
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { noteAddressCheck, readAddressChecks, readSuppressions } from '../../backend/services/sales/sales-store.js';
import { stageDraft, readOutbox } from '../../backend/services/sales/email-outbox.js';
import { recordSent } from '../../backend/services/sales/email-ledger.js';
import { personRecord, erasePerson, addressPattern } from '../../backend/services/sales/person-data.js';
import { officeFile } from '../../backend/services/house-office.js';
import personDataRouter from '../../backend/routes/person-data-routes.js';

describe('the address as a whole word', () => {
  test('ana@ never matches hana@, nor a longer domain; it does at a sentence end', () => {
    const p = addressPattern('ana@studio.example');
    expect(p.test('"contact":"ana@studio.example"')).toBe(true);
    expect(p.test('write to ANA@studio.example.')).toBe(true);
    expect(p.test('"contact":"hana@studio.example"')).toBe(false);
    expect(p.test('ana@studio.example.org')).toBe(false);
    expect(p.test('ana@studio.examples')).toBe(false);
  });
});

describe('a person\'s data, read whole and erased', () => {
  let me;
  beforeAll(async () => {
    useTempRealm();
    me = await fullAuth();
    const ledger = await leadLedgerFor(me.address);
    for (const [name, contact] of [['Ana Ruiz', 'ana@studio.example'], ['Hana Ito', 'hana@studio.example']]) {
      await ledger.add({ name, contact, channelId: 'email', kind: 'buyer', status: 'cold', note: `found on studio.example (${contact})`, addedBy: 'merc' });
      await noteAddressCheck(me.address, { email: contact, check: { status: 'valid', score: 99, checker: 'Hunter' }, spent: 1, by: 'merc' });
      await stageDraft(me.address, { to: [contact], subject: 'Hello', text: `Hello ${name.split(' ')[0]}`, by: 'merc' });
    }
    await recordSent(me.address, { to: ['ana@studio.example'], subject: 'Hello', by: 'operator', from: 'sales@house.example', messageId: '<0123456789abcdef01234567@house.example>' });
  });

  test('the record names every store that holds them, and only them', async () => {
    const record = await personRecord(me.address, 'Ana@Studio.example');
    expect(record.address).toBe('ana@studio.example');
    const files = record.held.map((h) => `${h.office}/${h.file}`);
    // The lead, the email staged to them, and the check of their address: three stores, each found by reading it.
    expect(files).toContain('marketing/lead-ledger.json');
    expect(record.held.length).toBeGreaterThanOrEqual(3);
    expect(record.held.find((h) => h.file === 'lead-ledger.json').records.map((l) => l.name)).toEqual(['Ana Ruiz']);
    expect(JSON.stringify(record.held)).not.toContain('hana@studio.example');
    expect(record.unread).toEqual([]);
  });

  test('erased: gone from every store but the do-not-contact list; the near address untouched', async () => {
    const before = (await personRecord(me.address, 'hana@studio.example')).held.length;
    const erased = await erasePerson(me.address, 'ana@studio.example', { by: me.address });
    expect(erased).toMatchObject({ address: 'ana@studio.example', leads: 1, suppressed: true, left: [] });
    expect(erased.dropped.length).toBeGreaterThanOrEqual(2);
    const after = await personRecord(me.address, 'ana@studio.example');
    expect(after.held.map((h) => h.file)).toEqual(['suppress.jsonl']);
    expect((await readSuppressions(me.address)).find((s) => s.value === 'ana@studio.example')).toMatchObject({ reason: 'asked' });
    // The lead's tombstone names the lead and who removed it, never the person.
    const [stone] = await (await leadLedgerFor(me.address)).removed();
    expect(stone).toMatchObject({ type: 'removed', by: me.address, why: 'erased at their request' });
    expect(JSON.stringify(stone)).not.toMatch(/ana|Ruiz/i);
    // Hana: every record still there, every store still readable.
    expect((await personRecord(me.address, 'hana@studio.example')).held.length).toBe(before);
    expect((await readOutbox(me.address)).drafts.map((d) => d.to[0])).toEqual(['hana@studio.example']);
    expect((await readAddressChecks(me.address)).map((c) => c.email)).toEqual(['hana@studio.example']);
    const raw = await fs.readFile(officeFile(me.address, 'marketing', 'lead-ledger.json'), 'utf8');
    expect(raw).not.toMatch(/(?<![a-z])ana@studio\.example/);
    expect((await fs.stat(officeFile(me.address, 'marketing', 'lead-ledger.json'))).mode & 0o777).toBe(0o600);
  });

  test('the route asks for the address twice before it erases', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.accessScope = 'local'; next(); });
    app.use('/api/v1/people', personDataRouter);
    const auth = { authorization: `Bearer ${me.token}` };
    const slip = await request(app).post('/api/v1/people/erase').set(auth).send({ address: 'hana@studio.example', confirm: 'hana@studio.exampl' });
    expect(slip.status).toBe(400);
    expect(slip.body.error).toMatch(/type their address again/);
    expect((await personRecord(me.address, 'hana@studio.example')).held.length).toBeGreaterThan(1);
    const read = await request(app).get('/api/v1/people/record?address=hana@studio.example').set(auth);
    expect(read.status).toBe(200);
    expect(read.headers['content-disposition']).toMatch(/attachment; filename="data-held-on-hana@studio\.example\.json"/);
  });
});
