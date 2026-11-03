/**
 * delivery/publish — the Mercator's one door outward for finished work (the
 * house economy's Stage 4): a file from the house ground, or an invoice the
 * Quaestor issued, published for a deal to the place the OPERATOR chose (a
 * folder they serve at an https address), under an unguessable path. The act
 * returns the link; the link reaches the buyer through the house mailbox
 * (email/send), which asks the operator on its own.
 *
 * THE SEAT LAW: the house's seated Mercator alone, re-read per act; the deal
 * is this house's, open or won. Tier `requireApproval` (tool-policy-defaults):
 * a file leaving the house is the operator's yes (or the charter's). A text
 * file is screened for live secrets before it can leave; an invoice is
 * rendered from the record, so its payment address is always the operator's.
 */
import fs from 'fs/promises';
import { croDesignation } from '../revenue/cro-designation.js';
import { readDeals } from '../revenue/deal-store.js';
import { loadHouseWorkspace } from '../house-workspace.js';
import { readInvoices } from '../invoices/invoice-store.js';
import { invoiceHtml } from '../invoices/invoice-shape.js';
import { readDestination, groundFile, publish } from '../delivery/delivery-store.js';
import { checkOutboundSecrets } from '../security/outbound-secrets.js';

const SCREEN_MAX_BYTES = 2 * 1024 * 1024;
const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const officeRefusal = { ok: false, status: 'denied', reason: 'delivery is the Mercator office\'s — only the seated Mercator publishes for a deal' };
const holds = async (connection) => croDesignation.holds(connection?.walletAddress, connection?.companion?.neumaId).catch(() => false);

// impure — a ground file's bytes, refused when its text carries a live secret.
const screenedBytes = async (file, size) => {
  const bytes = await fs.readFile(file);
  if (size > SCREEN_MAX_BYTES) return { bytes };
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return { bytes }; // a binary file: no text to screen
  const secret = checkOutboundSecrets('the file', [bytes.toString('utf8')], 'nothing was published');
  return secret.ok ? { bytes } : { refusal: secret.reason };
};

export const deliveryPublishIntent = Object.freeze({
  name: 'delivery/publish',
  policyTool: 'delivery.publish',
  fieldsForPrompt: '{deal, path?, invoice?}',
  descriptionForPrompt: 'THE MERCATOR OFFICE. Publish finished work for a deal to the place your operator chose, and get its link: deal is the deal\'s [id]; path a file on the house ground (repos/<company>/…), OR invoice an invoice [id] the Quaestor issued for that deal. Then send the link to the buyer from the house mailbox (email/send). Nothing else leaves; the operator approves each publish unless the charter covers it.',
  availableFor: async ({ laneId, connection }) => ((await croDesignation.holds(connection?.walletAddress, laneId).catch(() => false)) ? {} : null),
  validate: async (payload, { connection }) => {
    if (!(await holds(connection))) return officeRefusal;
    const wallet = connection.walletAddress;
    const deal = (await readDeals(wallet)).deals.find((d) => d.id === String(payload?.deal ?? '').trim());
    if (!deal) return invalid(`"${payload?.deal ?? ''}" is not a deal of this house — your MERCATOR OFFICE briefing names each by its [id]`);
    if (deal.stage === 'lost') return invalid('that deal is lost — nothing is delivered on it');
    const destination = await readDestination(wallet);
    if (!destination) return { ok: false, status: 'denied', reason: 'the operator has not chosen where deliveries go — ask them by house post (COMPANY LINE → SALES)' };
    const hasPath = typeof payload?.path === 'string' && payload.path.trim();
    const hasInvoice = typeof payload?.invoice === 'string' && payload.invoice.trim();
    if (Boolean(hasPath) === Boolean(hasInvoice)) return invalid('name one thing to publish: path (a file on the house ground) or invoice (its [id])');
    if (hasInvoice) {
      const invoice = (await readInvoices(wallet)).invoices.find((v) => v.id === payload.invoice.trim() || v.number === payload.invoice.trim());
      if (!invoice || invoice.dealId !== deal.id) return invalid(`no invoice "${payload.invoice}" bills that deal`);
      if (invoice.status === 'void') return invalid(`${invoice.number} is void — it is not sent`);
      return { ok: true, value: { deal, destination, kind: 'invoice', invoiceId: invoice.id, name: `${invoice.number}.html` } };
    }
    const { root } = await loadHouseWorkspace(wallet);
    if (!root) return { ok: false, status: 'denied', reason: 'the house has no ground set — the operator sets it (the HOUSE window)' };
    const found = await groundFile(root, payload.path);
    if (!found.ok) return invalid(found.reason);
    const screened = await screenedBytes(found.file, found.size);
    if (screened.refusal) return { ok: false, status: 'denied', reason: screened.refusal };
    return { ok: true, value: { deal, destination, kind: 'file', root, path: payload.path.trim(), name: found.name } };
  },
  summarize: (payload) => `publish ${payload?.invoice ? `invoice ${payload.invoice}` : `"${String(payload?.path ?? '?').slice(0, 120)}"`} for deal ${payload?.deal ?? '?'} to the operator's delivery folder`,
  execute: async (value, { connection }) => {
    const wallet = connection.walletAddress;
    let body;
    if (value.kind === 'invoice') {
      const invoice = (await readInvoices(wallet)).invoices.find((v) => v.id === value.invoiceId);
      if (!invoice || invoice.status === 'void') return { ok: false, reason: 'that invoice is void now — it is not sent' };
      body = invoiceHtml(invoice);
    } else {
      // judged again at execute: the file (or a link in its place) may have changed while the operator decided
      const found = await groundFile(value.root, value.path);
      if (!found.ok) return { ok: false, reason: found.reason };
      const screened = await screenedBytes(found.file, found.size);
      if (screened.refusal) return { ok: false, reason: screened.refusal };
      body = screened.bytes;
    }
    const delivery = await publish(wallet, {
      destination: value.destination, deal: value.deal, company: value.deal.companyId, kind: value.kind, name: value.name,
      body, invoiceId: value.invoiceId ?? null, by: connection.companion.neumaId, now: new Date().toISOString(),
    });
    return { ok: true, detail: `Published ${delivery.name} for ${delivery.buyer}: ${delivery.link} — send it to them from the house mailbox (email/send), in your own words, with the AI disclosure.` };
  },
});

export const deliveryIntents = Object.freeze([deliveryPublishIntent]);
