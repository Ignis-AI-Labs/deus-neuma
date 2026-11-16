/**
 * sales/draft-email — the sales seat stages an email for its operator's review (Design note, 2026-11-16:
 * […]).
 *
 * The seat writes the whole email. It is held to everything a send is held to, BEFORE it reaches
 * the operator: the mailbox is the house's, no secret rides in it, nobody on the do-not-contact
 * list, and to a lead only what the approved facts back, short, with one ask and its promise named,
 * to an address that exists. Then it waits in the outbox (sales/email-outbox.js), unsent. The
 * operator sends it, changes it, or returns it. Tier `allowed`: nothing leaves the house.
 */
import { officeContext } from './revenue-acts.js';
import { SEND_MAX_RECIPIENTS } from '../email/smtp-sender.js';
import { checkOutboundSecrets } from '../security/outbound-secrets.js';
import { suppressedRecipients, leadEmailRefusal } from '../sales/email-ledger.js';
import { stageDraft } from '../sales/email-outbox.js';

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const denied = (reason) => ({ ok: false, status: 'denied', reason });
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;

const salesDraftEmailIntent = Object.freeze({
  name: 'sales/draft-email',
  policyTool: 'sales.draft-email',
  fieldsForPrompt: '{to, subject, text, promise}',
  descriptionForPrompt: 'THE LEAD ENGINE. Stage an email to a lead for your operator to review: to (one address), subject, text (the whole email, in your own voice, signed as the AI you are), promise (what the email promises the reader, in a few words). It is checked now exactly as a send is checked: the do-not-contact list, the approved facts (every claim and number must stand on one), the first-email shape, and that the address exists. A draft that fails is refused with the reason and nothing is staged: fix it and stage again. One that passes WAITS, unsent, in your operator\'s outbox (POSITIONS, CHIEF REVENUE OFFICER, LEADS): they send it, change it, or return it with what should change. Say "staged for your review", never "sent". One email a person at a time.',
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return denied('the lead engine is the Mercator office\'s — only the seated Mercator stages an email to a lead');
    const to = Array.isArray(payload?.to) ? payload.to : (typeof payload?.to === 'string' ? [payload.to] : []);
    if (to.length === 0 || to.length > SEND_MAX_RECIPIENTS) return invalid('to is one address');
    if (typeof payload?.subject !== 'string' || !payload.subject.trim() || typeof payload?.text !== 'string' || !payload.text.trim()) return invalid('a draft needs {to, subject, text, promise} — the exact words that would leave under the house address');
    const secret = checkOutboundSecrets('the email', [...to, payload.subject, payload.text]);
    if (!secret.ok) return denied(secret.reason);
    let blocked; let unchecked;
    try {
      blocked = await suppressedRecipients(context.wallet, to);
      unchecked = await leadEmailRefusal(context.wallet, { to, subject: payload.subject, text: payload.text, promise: payload.promise, laneId: context.laneId });
    } catch (err) {
      return denied(`the house's do-not-contact list or lead records could not be read (${err.message}) — nothing is staged until they can`);
    }
    if (blocked.length) return denied(`${blocked.join(', ')} ${blocked.length === 1 ? 'is' : 'are'} on the house's do-not-contact list — never written to again`);
    if (unchecked) return invalid(unchecked);
    return { ok: true, value: { context, to, subject: payload.subject, text: payload.text, promise: typeof payload.promise === 'string' ? payload.promise : '' } };
  },
  summarize: (payload) => `stage an email to ${Array.isArray(payload?.to) ? payload.to.join(', ') : String(payload?.to ?? '?')} for review: "${String(payload?.subject ?? '').slice(0, 100)}"`,
  execute: async ({ context, to, subject, text, promise }) => {
    const staged = await stageDraft(context.wallet, { to, subject, text, promise, by: context.laneId });
    return staged.ok
      ? { ok: true, detail: `Staged for your operator's review [${staged.id}]: to ${to.join(', ')}, "${subject}". It has NOT been sent. Tell them it waits in POSITIONS, CHIEF REVENUE OFFICER, LEADS, in the outbox.` }
      : { ok: false, reason: staged.reason };
  },
});

export const salesOutboxIntents = Object.freeze([salesDraftEmailIntent]);
