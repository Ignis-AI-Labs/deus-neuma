/**
 * ANOTHER LAYER BEFORE A FIRST EMAIL LEAVES (address-verdict.js, address-check.js requireConfirmed, email-outbox.js
 * sendDraft) — 2026-11-19: mika.ohiorhenuan@flowtrackfund.com, handed over by Apollo as "verified" from its own
 * records, answered "could not confirm" by Apollo's live check, was staged on the stored flag and hard-bounced (550
 * 5.1.1). Founder: […]
 * A live answer outranks a stored flag; every send checks the address again; a first email goes only to an address a
 * database confirmed live — unless the operator sends it anyway. Real stores, a real SMTP server over TLS on loopback
 * (RULE 0); no provider key attached, so nothing is asked of the outside.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import process from 'node:process';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { startTlsSmtp } from '../helpers/smtp-tls-kit.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setEmailCredential } from '../../backend/services/email/email-credentials.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { noteContacts, noteAddressCheck, readAddressChecks } from '../../backend/services/sales/sales-store.js';
import { stageDraft, sendDraft } from '../../backend/services/sales/email-outbox.js';
import { recordSent } from '../../backend/services/sales/email-ledger.js';

const KEYS = ['DNA_ENCRYPTION_KEY', 'HUNTER_API_KEY', 'TOMBA_API_KEY', 'TOMBA_API_SECRET', 'APOLLO_API_KEY'];
const SAVED = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const PRIOR_ROOT = getWorkspacesRoot();

describe('a first email goes only to an address confirmed live', () => {
  let me; let smtp;
  beforeAll(async () => {
    for (const k of KEYS) delete process.env[k];
    process.env.DNA_ENCRYPTION_KEY = 'send-unconfirmed-test-key';
    useTempRealm();
    const tmp = await createTempDir('send-unconfirmed');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    me = await fullAuth();
    smtp = await startTlsSmtp(tmp);
    await setEmailCredential(me.address, { address: 'orrin@house.example', username: 'orrin@house.example', password: 'test-app-password', smtpHost: 'localhost', smtpPort: String(smtp.port), imapHost: 'localhost', imapPort: '1' });
  }, 60000);
  afterAll(async () => {
    await smtp?.close();
    setWorkspacesRoot(PRIOR_ROOT);
    for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  test('the Flowtrack case: a stored "verified" a live check could not confirm stops at send; the operator alone sends it anyway', async () => {
    const ledger = await leadLedgerFor(me.address);
    await ledger.add({ name: 'Mika Ohiorhenuan, Partner at Flowtrack', contact: 'mika@flowtrack.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: 'merc' });
    await noteContacts(me.address, 'flowtrack.example', 'apollo', [{ name: 'Mika Ohiorhenuan', role: 'Partner', email: 'mika@flowtrack.example', confidence: 100, sourceUrl: 'https://www.linkedin.com/in/mika', basis: 'verified', checked: 'valid' }], 'merc', 1);
    await noteAddressCheck(me.address, { email: 'mika@flowtrack.example', check: { status: 'unknown', score: 0, checker: 'Apollo' }, spent: 1, by: 'merc' });
    expect((await readAddressChecks(me.address)).find((c) => c.email === 'mika@flowtrack.example')).toMatchObject({ status: 'unknown', live: true, foundBy: ['Apollo'], confirmedBy: [] });
    const staged = await stageDraft(me.address, { to: ['mika@flowtrack.example'], subject: 'Liquid tokens', text: 'Hello Mika, the words of the first email.', by: 'merc' });
    const before = smtp.received.length;
    const refused = await sendDraft(me.address, staged.id);
    expect(refused).toMatchObject({ ok: false, reason: expect.stringMatching(/the address mika@flowtrack\.example is not confirmed \(could not be confirmed[\s\S]*a first email goes only to an address a database confirmed LIVE[\s\S]*your operator sends it anyway/) });
    expect(smtp.received.length).toBe(before);
    // SEND ANYWAY: the operator's, knowing it may bounce.
    expect(await sendDraft(me.address, staged.id, { acceptRisk: true })).toMatchObject({ ok: true, to: ['mika@flowtrack.example'] });
    expect(smtp.received.length).toBe(before + 1);
  }, 60000);

  test('a follow-up to someone already written to is not held; a stored "verified" no live check could answer still goes', async () => {
    const ledger = await leadLedgerFor(me.address);
    // Already emailed once: a follow-up goes even where no database could confirm the address.
    await ledger.add({ name: 'Ola Nord, Partner at Fjord', contact: 'ola@fjord.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: 'merc' });
    await recordSent(me.address, { to: ['ola@fjord.example'], subject: 'First', by: 'operator', from: 'orrin@house.example' });
    await noteAddressCheck(me.address, { email: 'ola@fjord.example', check: { status: 'unknown', score: 0, checker: 'Apollo' }, spent: 1, by: 'merc' });
    const follow = await stageDraft(me.address, { to: ['ola@fjord.example'], subject: 'Re: First', text: 'One more thing, Ola.', by: 'merc', followUp: true });
    expect(await sendDraft(me.address, follow.id)).toMatchObject({ ok: true });
    // Only a stored flag, and no live checker attached to ask: it stands (said, not hidden).
    await ledger.add({ name: 'Pia Sund, Partner at Sund', contact: 'pia@sund.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: 'merc' });
    await noteContacts(me.address, 'sund.example', 'apollo', [{ name: 'Pia Sund', role: 'Partner', email: 'pia@sund.example', confidence: 100, sourceUrl: 'https://www.linkedin.com/in/pia', basis: 'verified', checked: 'valid' }], 'merc', 1);
    expect((await readAddressChecks(me.address)).find((c) => c.email === 'pia@sund.example')).toMatchObject({ status: 'valid', live: false });
    const first = await stageDraft(me.address, { to: ['pia@sund.example'], subject: 'Hello Pia', text: 'Hello Pia, the first email.', by: 'merc' });
    expect(await sendDraft(me.address, first.id)).toMatchObject({ ok: true });
  }, 60000);
});
