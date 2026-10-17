// email-verify.mjs — prove the house email account end-to-end before a being
// touches it.
//
//   node scripts/email-verify.mjs                    → read-only probes:
//     SMTP connect+auth (then QUIT — nothing sent) and IMAP login+EXAMINE
//     (message count — nothing read or marked)
//   node scripts/email-verify.mjs --send <to> "subject" "text"
//     → ONE real email through the same sender send_email rides
//   node scripts/email-verify.mjs --inbox [n]
//     → list the newest n envelopes (default 5) through the same reader
//
// Resolves credentials exactly as the platform does (encrypted Settings store
// > .env > Gmail defaults), and speaks through the SAME protocol clients the
// email tools ride — uniform-architecture law: one path, proven here,
// trusted everywhere.
//
// Trust note: the probes send the password to the configured SMTP/IMAP
// hosts. Those hosts are WITNESS-controlled config (the 0600 encrypted store
// or the operator's .env — never neuma-writable) and every session is
// implicit TLS, so the credential can only travel, encrypted, to a server
// the witness personally named.

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(REPO, '.env') });

const { EMAIL_ACCOUNT } = await import(path.join(REPO, 'backend/services/email/email-registry.js'));
const { resolveEmailCredential } = await import(path.join(REPO, 'backend/services/email/email-credentials.js'));
const { sendEmail, probeSmtp } = await import(path.join(REPO, 'backend/services/email/smtp-sender.js'));
const { listInbox } = await import(path.join(REPO, 'backend/services/email/imap-reader.js'));

const creds = await resolveEmailCredential();
if (!creds) {
  console.log(`email is not configured — fill the fields in Settings > EMAIL or .env (${EMAIL_ACCOUNT.fields.map((f) => f.env).join(', ')}).`);
  console.log('Gmail needs 2-step verification + an app password; hosts/ports default to Gmail.');
  process.exit(1);
}

const sendIdx = process.argv.indexOf('--send');
const inboxIdx = process.argv.indexOf('--inbox');

if (sendIdx !== -1) {
  const [to, subject, text] = process.argv.slice(sendIdx + 1, sendIdx + 4);
  if (!to || !subject || !text) {
    console.error('usage: node scripts/email-verify.mjs --send <to> "subject" "text"');
    process.exit(1);
  }
  console.log(`sending ONE real email from ${creds.address} to ${to}…`);
  const outcome = await sendEmail(creds, { to, subject, text });
  if (outcome.ok) {
    console.log(`SENT — message id ${outcome.messageId}`);
  } else {
    console.error(`send FAILED — ${outcome.detail}`);
    process.exit(1);
  }
} else if (inboxIdx !== -1) {
  const limit = parseInt(process.argv[inboxIdx + 1], 10) || 5;
  const outcome = await listInbox(creds, { limit });
  if (!outcome.ok) {
    console.error(`inbox read FAILED — ${outcome.detail}`);
    process.exit(1);
  }
  console.log(`INBOX ${creds.address} — newest ${outcome.messages.length} of ${outcome.total} message(s):`);
  for (const m of outcome.messages) {
    console.log(`  uid ${m.uid}${m.seen ? '' : ' [unread]'} — ${m.from} — "${m.subject}" — ${m.date}`);
  }
} else {
  console.log(`account ${creds.address} — SMTP ${creds.smtpHost}:${creds.smtpPort}, IMAP ${creds.imapHost}:${creds.imapPort}`);

  const smtp = await probeSmtp(creds);
  if (smtp.ok) console.log('smtp — VERIFIED: server accepted authentication (nothing sent)');
  else { console.error(`smtp — FAILED: ${smtp.detail}`); process.exitCode = 1; }

  const imap = await listInbox(creds, { limit: 1 });
  if (imap.ok) console.log(`imap — VERIFIED: INBOX opened read-only (${imap.total} message(s))`);
  else { console.error(`imap — FAILED: ${imap.detail}`); process.exitCode = 1; }

  if (!process.exitCode) {
    console.log('\nnothing was sent or altered. One real test send: node scripts/email-verify.mjs --send <to> "subject" "text"');
  }
  process.exit(process.exitCode || 0);
}
