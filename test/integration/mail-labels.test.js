/**
 * THE MAILBOX HOLDER KEEPS IT IN ORDER (RULE 0, nothing mocked): a real TLS
 * IMAP server on loopback speaking the label verbs, the house's real reader
 * against it. Labels are listed, made, applied, removed; a message is archived;
 * a server without Gmail's labels files by folder and says what it cannot do.
 * Nothing is deleted, and a read never opens the inbox for change.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { startTlsImap } from '../helpers/imap-tls-kit.js';
import { listInbox, listLabels, labelMessage, cleanLabel, parseListNames } from '../../backend/services/email/imap-reader.js';
import { EMAIL_TOOLS } from '../../backend/services/email/email-being-tools.js';
import { GLOBAL_DEFAULTS } from '../../backend/services/tool-policy-defaults.js';

describe('the mailbox labels through a real IMAP session (gnosis)', () => {
  let imap, credentials, uid;

  beforeAll(async () => {
    imap = await startTlsImap(await createTempDir('mail-labels'));
    credentials = { username: 'house@tidewater.example', password: 'app-password', imapHost: 'localhost', imapPort: String(imap.port) };
    uid = imap.deliver({ from: 'Dima <dima@limitless.example>', subject: 'Re: LMTS pool', body: 'Yeah, curious about it.' });
    imap.state.folders.push('Receipts');
  }, 60000);

  afterAll(async () => { await imap?.close(); });

  test('a label name is plain words; system folders are never offered as labels', () => {
    expect(cleanLabel('  Leads /  Replied ')).toBe('Leads / Replied');
    expect(cleanLabel('Leads/Replied')).toBe('Leads/Replied');
    for (const bad of ['', 'a"b', '/root', 'x'.repeat(61), '{9}', 42]) expect(cleanLabel(bad)).toBe(null);
    expect(parseListNames([
      { text: '* LIST (\\HasNoChildren) "/" "INBOX"' }, { text: '* LIST (\\Noselect \\HasChildren) "/" "[Gmail]"' },
      { text: '* LIST (\\HasNoChildren \\Sent) "/" "[Gmail]/Sent Mail"' }, { text: '* LIST (\\HasNoChildren) "/" "Leads/Replied"' }, { text: '* LIST () "/" Receipts' },
    ])).toEqual(['Leads/Replied', 'Receipts']);
  });

  test('the labels are listed; a new one is made and put on the message; it comes off again', async () => {
    expect(await listLabels(credentials)).toEqual({ ok: true, labels: ['Receipts'] });
    expect(await labelMessage(credentials, { uid, label: 'Leads/Replied' })).toEqual({ ok: true, done: ['label "Leads/Replied" created', '"Leads/Replied" applied'] });
    expect(imap.box[0].labels).toEqual(['\\Inbox', 'Leads/Replied']);
    expect(await listLabels(credentials)).toEqual({ ok: true, labels: ['Leads/Replied', 'Receipts'] });
    // A label that already stands is applied, not made twice.
    expect(await labelMessage(credentials, { uid, label: 'Receipts' })).toEqual({ ok: true, done: ['"Receipts" applied'] });
    expect(await labelMessage(credentials, { uid, label: 'Receipts', remove: true })).toEqual({ ok: true, done: ['"Receipts" removed'] });
    expect(imap.box[0].labels).toEqual(['\\Inbox', 'Leads/Replied']);
  });

  test('archive takes the message out of the inbox and keeps its label; the message itself is never removed', async () => {
    expect(await labelMessage(credentials, { uid, archive: true })).toEqual({ ok: true, done: ['archived out of the inbox'] });
    expect(imap.box[0].labels).toEqual(['Leads/Replied']);
    expect(imap.box).toHaveLength(1);
  });

  test('refusals name what is wrong, and change nothing', async () => {
    const before = JSON.stringify(imap.box);
    expect(await labelMessage(credentials, { uid: 999, label: 'Leads' })).toEqual({ ok: false, detail: 'no message with uid 999 in the inbox' });
    expect((await labelMessage(credentials, { uid, label: 'bad"name' })).detail).toMatch(/label: at most 60 characters/);
    expect(await labelMessage(credentials, { uid })).toEqual({ ok: false, detail: 'name a label, or archive: true' });
    expect(await labelMessage(credentials, { uid: 0, label: 'Leads' })).toEqual({ ok: false, detail: 'a positive message uid is required' });
    expect(await labelMessage(null, { uid, label: 'Leads' })).toEqual({ ok: false, detail: 'email credentials are not configured' });
    expect(JSON.stringify(imap.box)).toBe(before);
  });

  test('a server without Gmail\'s labels files by folder, and says what it cannot do from here', async () => {
    imap.state.gmail = false;
    expect(await labelMessage(credentials, { uid, label: 'Clients' })).toEqual({ ok: true, done: ['label "Clients" created', '"Clients" applied'] });
    expect(imap.state.copies).toEqual([[uid, 'Clients']]);
    expect((await labelMessage(credentials, { uid, label: 'Clients', remove: true })).detail).toMatch(/keeps labels as folders/);
    expect((await labelMessage(credentials, { uid, archive: true })).detail).toMatch(/archiving is only known for Gmail/);
    imap.state.gmail = true;
  });

  test('reading opens the inbox read-only; only label work opens it for change', async () => {
    const selects = imap.state.selects;
    expect((await listInbox(credentials)).ok).toBe(true);
    expect((await listLabels(credentials)).ok).toBe(true);
    expect(imap.state.selects).toBe(selects);
    expect((await labelMessage(credentials, { uid, label: 'Receipts' })).ok).toBe(true);
    expect(imap.state.selects).toBe(selects + 1);
  });

  test('the holder is offered both tools, and each asks the operator before it runs', () => {
    expect(EMAIL_TOOLS.map((t) => t.name)).toEqual(['check_email_inbox', 'read_email', 'list_email_labels', 'label_email']);
    expect(GLOBAL_DEFAULTS.email.requireApproval).toEqual(expect.arrayContaining(['list_email_labels', 'label_email']));
  });
});
