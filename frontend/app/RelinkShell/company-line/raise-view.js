// raise-view.js — the RAISE section's display law. Pure.

export const ACCOUNT_KINDS = Object.freeze(['wallet', 'bank', 'portal']);

/** Counsel's three questions, answered before any investor is asked (plan §15). */
export const COUNSEL_QUESTIONS = Object.freeze([
  'Which legal route, for each jurisdiction the company raises in.',
  'Whether an agent team pitching for the company counts as the company speaking for itself.',
  'The final words of the disclosure line, and the facts sheet itself.',
]);

/** The receiving account the operator's draft describes. pure. */
export const accountFromDraft = (d) => {
  if (d.kind === 'wallet') return { kind: 'wallet', address: (d.address ?? '').trim(), network: 'ethereum' };
  if (d.kind === 'bank') return { kind: 'bank', bankName: d.bankName ?? '', accountName: d.accountName ?? '', details: d.details ?? '' };
  if (d.kind === 'portal') return { kind: 'portal', portal: d.portal ?? '', url: (d.url ?? '').trim() };
  return null;
};

/** Is the signature whole enough to send? (The server judges it.) pure. */
export const signReady = (d) => {
  const a = accountFromDraft(d);
  if (!a || d.counsel !== true) return false;
  return Object.values(a).every((v) => String(v).trim().length > 1);
};

/** A sum as a person reads it before signing: 2,000,000 is never mistaken for 20,000,000. pure. */
export const money = (n) => Number(n).toLocaleString('en-US');

/** A mandate in one line. pure. */
export const mandateWords = (m) => `${money(m.amount)} ${m.currency} BY ${String(m.instrument).toUpperCase()} · VALUATION ${money(m.valuation.low)}–${money(m.valuation.high)} · ${String(m.route.kind).toUpperCase()} IN ${m.route.jurisdiction} · ${m.limits.perDay} A DAY, ${m.limits.followUps} FOLLOW-UPS · MIN CHECK ${money(m.minCheck)}`;

/** The receiving account in words, as the operator entered it. pure. */
export const accountWords = (a) => (!a ? '—' : a.kind === 'wallet' ? `WALLET ${a.address} (${a.network})`
  : a.kind === 'bank' ? `BANK ${a.bankName} — ${a.accountName}` : `PORTAL ${a.portal} — ${a.url}`);
