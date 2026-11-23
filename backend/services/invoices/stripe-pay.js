// PAY BY CARD — an invoice's own Stripe payment link, on the operator's own Stripe account.
//
// Design note, 2026-11-21: […] (This lifts the ruling of 2026-10-16 §8.3, […].)
//
// One PAYMENT LINK an invoice (docs.stripe.com/api/payment-link/create, read 2026-11-21): it carries the invoice's own
// lines as inline prices, does not expire while the invoice is open, and closes itself after ONE completed payment
// (restrictions.completed_sessions.limit = 1). Stripe hosts the page, so the house needs no website. The buyer gets
// Stripe's own receipt and invoice (invoice_creation). Which payment methods show is the operator's Stripe setting:
// `payment_method_types` is never sent.
//
// HOW THE HOUSE LEARNS IT WAS PAID: Stripe's recommended way is a webhook, and a webhook needs a public address this
// desk does not have. So the house ASKS: the Checkout Sessions of that link, completed, and counts one only when its
// payment_status is paid (a delayed method — a bank debit — completes first and is paid later; it is not counted
// until it is). The cost of asking instead of being told: a payment is seen at the next ask, minutes later, not at once.
//
// The key is the operator's (SETTINGS, API, Payments) — a RESTRICTED key (rk_…) with write on Payment Links and read
// on Checkout Sessions is enough, and is what the row asks for. No being ever holds it, and no being writes a link:
// the link is made here from the invoice's record, and printed on the invoice by the platform.
// The shaping is PURE; the three calls are impure and never throw.

import process from 'node:process';
import { testEndpoint } from '../test-endpoint-door.js';

export const STRIPE_URL = 'https://api.stripe.com';
export const STRIPE_VERSION = '2026-11-18.endive';
// Currencies a card invoice is issued in today: each has two decimal places, so an amount is its hundredths.
export const CARD_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'CHF']);
const baseUrl = () => testEndpoint(process.env, 'NEUMA_STRIPE_API', STRIPE_URL);

/** An amount in the currency's smallest unit (hundredths). pure. */
export const minor = (amount) => Math.round(Number(amount) * 100);

/**
 * The form Stripe is sent to make an invoice's payment link. pure.
 * @param {object} invoice - an issued invoice (invoice-shape.js)
 * @returns {Array<[string, string]>} form fields, in order
 */
export const payLinkForm = (invoice) => [
  ...invoice.lines.flatMap((line, i) => [
    [`line_items[${i}][quantity]`, '1'],
    [`line_items[${i}][price_data][currency]`, invoice.currency.toLowerCase()],
    [`line_items[${i}][price_data][unit_amount]`, String(minor(line.amount))],
    [`line_items[${i}][price_data][product_data][name]`, String(line.what).slice(0, 250)],
  ]),
  ['restrictions[completed_sessions][limit]', '1'],
  ['invoice_creation[enabled]', 'true'],
  ['invoice_creation[invoice_data][description]', `${invoice.company} — invoice ${invoice.number}`],
  ['payment_intent_data[description]', `${invoice.company} — invoice ${invoice.number}`],
  ['after_completion[type]', 'hosted_confirmation'],
  ['after_completion[hosted_confirmation][custom_message]', `Thank you. Invoice ${invoice.number} from ${invoice.company} is paid.`.slice(0, 500)],
  ['inactive_message', `Invoice ${invoice.number} from ${invoice.company} is no longer open for payment.`.slice(0, 500)],
  ['metadata[invoice]', invoice.id],
  ['metadata[number]', invoice.number],
];

/**
 * The payment that settles an invoice, among the completed sessions of its link, or null. Only one that Stripe says
 * is PAID, in the invoice's currency, for at least its total. pure.
 * @param {object[]} sessions - Checkout Session objects
 * @param {{total: number, currency: string}} invoice
 * @returns {?{session: string, paymentIntent: ?string, amount: number, currency: string, email: ?string}}
 */
export const paidOf = (sessions, invoice) => {
  const hit = (Array.isArray(sessions) ? sessions : []).find((s) => s?.status === 'complete' && s.payment_status === 'paid'
    && String(s.currency).toUpperCase() === invoice.currency && Number(s.amount_total) >= minor(invoice.total));
  return hit ? { session: String(hit.id), paymentIntent: typeof hit.payment_intent === 'string' ? hit.payment_intent : hit.payment_intent?.id ?? null,
    amount: Number(hit.amount_total) / 100, currency: invoice.currency, email: hit.customer_details?.email ?? null } : null;
};

/** What Stripe's refusal means, in the operator's words. pure. */
export const stripeRefusal = (status, body) => {
  const said = String(body?.error?.message ?? '').slice(0, 240);
  if (status === 401) return 'Stripe refused the key — check it in SETTINGS, API, Payments';
  if (status === 403) return `the Stripe key may not do this — a restricted key needs WRITE on Payment Links and READ on Checkout Sessions${said ? ` (${said})` : ''}`;
  if (status === 429) return 'Stripe is busy — try again in a moment';
  return `Stripe answered ${status}${said ? `: ${said}` : ''}`;
};

// impure — one call to Stripe: form-encoded in, JSON out; a refusal in words, never a throw.
const call = async (key, method, path, { form = null, idempotencyKey = null, signal } = {}) => {
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method, signal,
      headers: { authorization: `Bearer ${key}`, 'stripe-version': STRIPE_VERSION, accept: 'application/json',
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
      ...(form ? { body: form.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') } : {}),
    });
    const body = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, body } : { ok: false, reason: stripeRefusal(res.status, body) };
  } catch (err) {
    return { ok: false, reason: `Stripe could not be reached (${err.message})` };
  }
};

/**
 * Make the invoice's payment link. Asked twice for one invoice, Stripe answers with the same link (idempotency).
 * @returns {Promise<{ok: true, link: {id: string, url: string, live: boolean}} | {ok: false, reason: string}>}
 */
export const createPayLink = async ({ key, invoice, signal }) => {
  const made = await call(key, 'POST', '/v1/payment_links', { form: payLinkForm(invoice), idempotencyKey: `neuma-invoice-${invoice.id}`, signal });
  if (!made.ok) return made;
  const { id, url, livemode } = made.body ?? {};
  return /^plink_/.test(String(id)) && /^https:\/\/\S+$/.test(String(url)) ? { ok: true, link: { id, url, live: livemode === true } } : { ok: false, reason: 'Stripe answered without a payment link' };
};

/**
 * Was the invoice paid through its link? Asked of Stripe now.
 * @returns {Promise<{ok: true, paid: ?object} | {ok: false, reason: string}>}
 */
export const askPaid = async ({ key, invoice, signal }) => {
  const got = await call(key, 'GET', `/v1/checkout/sessions?payment_link=${encodeURIComponent(invoice.card.id)}&status=complete&limit=20`, { signal });
  return got.ok ? { ok: true, paid: paidOf(got.body?.data, invoice) } : got;
};

/** Close a link so it can no longer be paid (a voided invoice, or one paid another way). */
export const closePayLink = async ({ key, linkId, signal }) => {
  const done = await call(key, 'POST', `/v1/payment_links/${encodeURIComponent(linkId)}`, { form: [['active', 'false']], signal });
  return done.ok ? { ok: true } : done;
};
