/**
 * EVERY SALES EMAIL CARRIES ITS WAY OUT, AND THE HOUSE HONOURS IT (sales/opt-out.js, email/opt-out-footer.js,
 * mail-upkeep.js) — Design note, 2026-11-23: […]; then […]. CAN-SPAM (US) and PECR (UK) ask every commercial email for a
 * working opt-out, and CAN-SPAM for the sender's postal address: a reply of […] closes them, and the address is
 * the sending company's (a product of a company mails as that company).
 * Real stores, a real SMTP server over TLS on loopback (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { startTlsSmtp } from '../helpers/smtp-tls-kit.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setEmailCredential } from '../../backend/services/email/email-credentials.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { noteAddressCheck, addSuppression, readSuppressions } from '../../backend/services/sales/sales-store.js';
import { makeSuppression } from '../../backend/services/sales/suppress-shape.js';
import { stageDraft, sendDraft, readOutbox } from '../../backend/services/sales/email-outbox.js';
import { withFooters } from '../../backend/services/sales/opt-out.js';
import { settleMail } from '../../backend/services/sales/mail-upkeep.js';
import { emailSendIntent } from '../../backend/services/intents/email-send.js';
import { addCompany, setCompanyPostal, listCompanies, sendingEntity } from '../../backend/services/marketing/companies.js';
import { companyFiles } from '../../backend/services/positions/company-file.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { buildMimeMessage } from '../../backend/services/email/smtp-sender.js';
import { withFooter, optOutFooter } from '../../backend/services/email/opt-out-footer.js';

const KEYS = ['DNA_ENCRYPTION_KEY', 'HUNTER_API_KEY', 'TOMBA_API_KEY', 'TOMBA_API_SECRET', 'APOLLO_API_KEY'];
const SAVED = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const PRIOR_ROOT = getWorkspacesRoot();
const POSTAL = '1 Market Street, Suite 2, San Francisco, CA 94105, USA';

// The message as it left: its headers, and its body decoded.
const parse = (raw) => {
  const [head, body] = raw.split('\r\n\r\n');
  return { head, text: Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8') };
};
const header = (head, name) => head.split('\r\n').find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))?.slice(name.length + 1).trim() ?? null;

describe('the footer', () => {
  test('it says to reply "stop", never "unsubscribe", and names who sends it from where; once', () => {
    const footer = optOutFooter({ name: 'Acme Ltd', postal: POSTAL });
    expect(footer).toBe(`-- \nReply "stop" and we will not write again.\nAcme Ltd · ${POSTAL}`);
    expect(footer).not.toMatch(/unsubscribe/i);
    const once = withFooter('Hello Mika.', footer);
    expect(withFooter(once, footer)).toBe(once);
    expect(optOutFooter({ name: 'Acme Ltd', postal: null }).split('\n').at(-1)).toBe('Acme Ltd');
    expect(buildMimeMessage({ from: 'a@h.example', to: ['b@c.example'], subject: 'Hi', text: 'Hello', date: new Date(0), messageId: '<0123456789abcdef01234567@h.example>' })).not.toMatch(/List-Unsubscribe/);
  });

  test('a product of a company mails as that company: the nearest one above it with an address', () => {
    const companies = [{ id: 'ignis', parentId: null, legalEntity: { name: 'Ignis AI Labs, LLC', postalAddress: POSTAL } }, { id: 'umbrae', parentId: 'ignis', legalEntity: null },
      { id: 'dn', parentId: 'ignis', legalEntity: { name: 'Deus Neuma Inc', postalAddress: '8 The Green, Suite B, Dover, DE 19901, USA' } }];
    expect(sendingEntity(companies, companies[1]).id).toBe('ignis');
    expect(sendingEntity(companies, companies[2]).id).toBe('dn');
    expect(sendingEntity([{ id: 'x', parentId: null, legalEntity: null }], { id: 'x', parentId: null, legalEntity: null }).id).toBe('x');
  });
});

describe('sales mail carries its way out, and the house honours it', () => {
  let me; let smtp;
  beforeAll(async () => {
    for (const k of KEYS) delete process.env[k];
    process.env.DNA_ENCRYPTION_KEY = 'sales-opt-out-test-key';
    useTempRealm();
    const tmp = await createTempDir('sales-opt-out');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    me = await fullAuth();
    smtp = await startTlsSmtp(tmp);
    await setEmailCredential(me.address, { address: 'sales@house.example', username: 'sales@house.example', password: 'test-app-password', smtpHost: 'localhost', smtpPort: String(smtp.port), imapHost: 'localhost', imapPort: '1' });
    await setHouseWorkspace(me.address, await createTempDir('sales-opt-out-ground-'));
    expect(await addCompany(me.address, { name: 'Acme' })).toMatchObject({ ok: true });
  }, 60000);
  afterAll(async () => {
    await smtp?.close();
    setWorkspacesRoot(PRIOR_ROOT);
    for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  test('a company with no postal address says it is missing; once set it stands on the company', async () => {
    expect((await companyFiles(me.address))[0].missing.join(' ')).toMatch(/postal address/);
    expect(await setCompanyPostal(me.address, 'acme', `  ${POSTAL}  `)).toMatchObject({ ok: true });
    expect((await listCompanies(me.address))[0].legalEntity).toMatchObject({ name: 'Acme', postalAddress: POSTAL });
    expect((await companyFiles(me.address))[0]).toMatchObject({ postal: POSTAL });
    expect((await companyFiles(me.address))[0].missing.join(' ')).not.toMatch(/postal address/);
    expect(await setCompanyPostal(me.address, 'acme', 'line one\nline two')).toMatchObject({ ok: false, error: expect.stringMatching(/one line/) });
  });

  test('an email to a buyer leaves with the footer; the outbox showed that footer first', async () => {
    const ledger = await leadLedgerFor(me.address);
    await ledger.add({ name: 'Mika at Flow', contact: 'mika@flow.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: 'merc' });
    await noteAddressCheck(me.address, { email: 'mika@flow.example', check: { status: 'valid', score: 99, checker: 'Hunter' }, spent: 1, by: 'merc' });
    const staged = await stageDraft(me.address, { to: ['mika@flow.example'], subject: 'Liquid tokens', text: 'Hello Mika, the words of the first email.', by: 'merc' });
    const shown = (await withFooters(me.address, (await readOutbox(me.address)).drafts)).find((d) => d.id === staged.id);
    expect(shown.footer).toMatch(/Reply "stop"[\s\S]*Acme · 1 Market Street/);
    expect(await sendDraft(me.address, staged.id, { acceptRisk: true })).toMatchObject({ ok: true });
    const { head, text } = parse(smtp.received.at(-1).data);
    expect(header(head, 'List-Unsubscribe')).toBeNull();
    expect(text).toBe(`Hello Mika, the words of the first email.\n\n${shown.footer}`);
  }, 60000);

  test('an email to a vendor carries neither: it is not sales mail', async () => {
    const ledger = await leadLedgerFor(me.address);
    await ledger.add({ name: 'Supplier', contact: 'orders@vendor.example', channelId: 'email', kind: 'vendor', status: 'cold', addedBy: 'operator' });
    await noteAddressCheck(me.address, { email: 'orders@vendor.example', check: { status: 'valid', score: 99, checker: 'Hunter' }, spent: 1, by: 'operator' });
    const staged = await stageDraft(me.address, { to: ['orders@vendor.example'], subject: 'Our order', text: 'Please send the invoice.', by: 'operator' });
    expect((await withFooters(me.address, (await readOutbox(me.address)).drafts)).find((d) => d.id === staged.id).footer).toBeNull();
    const sent = await sendDraft(me.address, staged.id, { acceptRisk: true });
    expect(sent.ok, JSON.stringify(sent)).toBe(true);
    const { head, text } = parse(smtp.received.at(-1).data);
    expect(header(head, 'List-Unsubscribe')).toBeNull();
    expect(text).toBe('Please send the invoice.');
  }, 60000);

  test('a reply of "stop" to the email closes them; the same word from anyone else closes nobody', async () => {
    const leads = await (await leadLedgerFor(me.address)).load();
    const sent = leads.find((l) => l.contact === 'mika@flow.example').touches.findLast((t) => t.messageId).messageId;
    // A "stop" carrying no email the house sent: nothing closes (P6-70). It is read as a reply, never as proof.
    const forged = await settleMail(me.address, { credentials: null, message: { uid: 1, from: 'x@else.example', subject: 'stop' }, sender: 'x@else.example', isLead: false, leads });
    expect(forged).toEqual({ kind: null });
    expect((await readSuppressions(me.address)).some((s) => s.value === 'mika@flow.example')).toBe(false);
    // The rule itself: "stop" alone on their first line, above what they quoted, is the request.
    const { asksToStop, provenAddresses } = await import('../../backend/services/sales/reply-rules.js');
    expect(asksToStop('Stop.\n\nOn Mon, Mika wrote:\n> Hello')).toBe(true);
    expect(asksToStop('Can you stop by the booth?')).toBe(false);
    expect(provenAddresses({ addresses: ['mika@flow.example'], leads, ids: [sent] })).toEqual(['mika@flow.example']);
    expect(provenAddresses({ addresses: ['mika@flow.example'], leads, ids: ['<other@h.example>'] })).toEqual([]);
    expect(provenAddresses({ addresses: ['mika@flow.example'], leads: [{ contact: 'mika@flow.example', touches: [{ direction: 'in', messageId: sent }] }], ids: [sent] })).toEqual([]);
  }, 60000);

  test('a no is recorded as their words but closes the lead only with outgoing-message proof', async () => {
    const ledger = await leadLedgerFor(me.address);
    const lead = await ledger.add({ name: 'No Proof', contact: 'no@proof.example', channelId: 'email', kind: 'buyer', status: 'contacted', addedBy: 'merc' });
    const { cleanSaid, readReply } = await import('../../backend/services/sales/reply-reading.js');
    const { recordReceived } = await import('../../backend/services/sales/email-ledger.js');
    const said = cleanSaid(readReply({ subject: 'No', text: 'No thanks.', from: lead.contact }), 'mail-watch');
    await recordReceived(me.address, { from: lead.contact, ref: 'mail #forged', said, closeProven: false });
    expect((await ledger.load()).find((l) => l.id === lead.id).status).not.toBe('lost');
    await recordReceived(me.address, { from: lead.contact, ref: 'mail #proven', said, closeProven: true });
    expect((await ledger.load()).find((l) => l.id === lead.id).status).toBe('lost');
  });

  test('email/send checks the do-not-contact list again when it runs: a card raised before an unsubscribe sends nothing', async () => {
    const ledger = await leadLedgerFor(me.address);
    await ledger.add({ name: 'Pia', contact: 'pia@sund.example', channelId: 'email', kind: 'buyer', status: 'contacted', addedBy: 'merc' });
    await addSuppression(me.address, makeSuppression({ target: 'pia@sund.example', reason: 'asked', note: 'asked after the card', by: 'mail-watch', now: new Date().toISOString() }));
    const before = smtp.received.length;
    const outcome = await emailSendIntent.execute({ to: ['pia@sund.example'], subject: 'Re: hello', text: 'Following up.', from: 'sales@house.example' }, { connection: { walletAddress: me.address, companion: { neumaId: 'merc' } } });
    expect(outcome).toMatchObject({ ok: false, reason: expect.stringMatching(/pia@sund\.example went on the do-not-contact list after the card was raised/) });
    expect(smtp.received.length).toBe(before);
  }, 60000);
});
