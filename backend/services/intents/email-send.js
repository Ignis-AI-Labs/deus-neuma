/**
 * email/send — the intent type that sends mail from the house mailbox
 * (Stage 3 of docs/planning/proposals/being-tool-surface-primitives.md). This
 * was the `send_email` tool until the act became a filed intent; the reads
 * (check_email_inbox, read_email) stay tools. The mailbox POSITION law is
 * validate-time now: the mailbox is a single-holder position, re-read per
 * act, and a lane that does not hold it is refused BEFORE any card — the
 * operator is never asked to approve mail from the wrong being.
 */
import { resolveEmailCredential } from '../email/email-credentials.js';
import { emailBinding, canNeumaUseEmail } from '../email/email-binding.js';
import { houseOfLane } from '../social/house-positions.js';
import { sendEmail, SEND_MAX_RECIPIENTS } from '../email/smtp-sender.js';
import { journalEmailCall } from '../email/email-being-tools.js';
import { checkOutboundSecrets } from '../security/outbound-secrets.js';

// impure — the mailbox position: this lane holds its own house's mailbox AND
// that house's account resolves.
const mailboxRefusal = async (laneId) => {
  const house = await houseOfLane(laneId);
  const [bindings, credentials] = await Promise.all([
    emailBinding.load(house).catch(() => ({})),
    resolveEmailCredential(house).catch(() => null),
  ]);
  if (!canNeumaUseEmail(bindings, laneId)) {
    return { ok: false, status: 'denied', reason: 'the mailbox is not yours to hold — only the neuma your operator bound to email may use it' };
  }
  if (credentials === null) {
    return { ok: false, status: 'denied', reason: 'the mailbox is not configured — your operator connects the account' };
  }
  return null;
};

export const emailSendIntent = Object.freeze({
  name: 'email/send',
  policyTool: 'email.send',
  fieldsForPrompt: '{to, subject, text}',
  descriptionForPrompt: `Send an email from the address your operator connected — to is one address or a list (max ${SEND_MAX_RECIPIENTS}). Named speech to a real person, stronger egress than a public post: write in your own voice and sign as yourself.`,
  availableFor: async ({ laneId }) => ((await mailboxRefusal(laneId)) === null ? {} : null),
  validate: async (payload, { connection }) => {
    const position = await mailboxRefusal(connection.companion?.neumaId);
    if (position) return position;
    const to = Array.isArray(payload?.to) ? payload.to : (typeof payload?.to === 'string' ? [payload.to] : []);
    if (to.length === 0 || to.length > SEND_MAX_RECIPIENTS) {
      return { ok: false, status: 'invalid', reason: `to is one address or a list of at most ${SEND_MAX_RECIPIENTS}` };
    }
    if (typeof payload?.subject !== 'string' || !payload.subject.trim()
      || typeof payload?.text !== 'string' || !payload.text.trim()) {
      return { ok: false, status: 'invalid', reason: 'a send needs {to, subject, text} — the exact words leave under the house address' };
    }
    // A key in a sent mail is out for good: refused before any card.
    const secret = checkOutboundSecrets('the email', [...to, payload.subject, payload.text]);
    if (!secret.ok) return { ok: false, status: 'denied', reason: secret.reason };
    return { ok: true, value: { to: payload.to, subject: payload.subject, text: payload.text } };
  },
  summarize: (payload) => {
    const to = Array.isArray(payload?.to) ? payload.to.join(', ') : String(payload?.to ?? '?');
    return `send email to ${to}: "${String(payload?.subject ?? '').slice(0, 100)}"`;
  },
  // impure — the real SMTP session; the signal rides in so a barge-in
  // mid-flight aborts the protocol conversation too.
  execute: async (value, { connection, signal }) => {
    const credentials = await resolveEmailCredential(await houseOfLane(connection.companion?.neumaId)).catch(() => null);
    const outcome = await sendEmail(credentials, value, { signal });
    await journalEmailCall(
      connection, 'email/send',
      outcome.ok ? `to ${outcome.to.join(', ')} — "${String(value.subject).slice(0, 120)}"` : outcome.detail,
      outcome.ok ? 'ok' : 'error',
    );
    return outcome.ok
      ? { ok: true, detail: `Email sent to ${outcome.to.join(', ')} (message id ${outcome.messageId}).` }
      : { ok: false, reason: `The email was not sent: ${outcome.detail}.` };
  },
});
