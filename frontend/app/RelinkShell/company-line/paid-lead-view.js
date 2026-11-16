// paid-lead-view.js — how PAID LEAD DATA reads on the leads screen. Pure.

/** The three choices, in the order they spend: nothing, a little, freely. */
export const SPEND_CHOICES = Object.freeze([
  { mode: 'ask', label: 'ASK ME FIRST', what: 'Nothing paid runs. The seat asks you before it spends a single credit.' },
  { mode: 'free-first', label: 'FREE FIRST', what: 'The seat reads and scores each company from its own pages first. It pays for a lookup only when those pages gave no address.' },
  { mode: 'paid-first', label: 'PAID FROM THE START', what: 'The seat may pay for the people at any company it gathered, without reading its pages first.' },
].map(Object.freeze));

/** Which providers are attached, or where to attach one. */
export const attachedWords = (spend) => (spend.attached.length
  ? `ATTACHED: ${spend.attached.map((id) => id.toUpperCase()).join(' · ')}`
  : 'NO PROVIDER ATTACHED — ADD A KEY IN SETTINGS, API, LEAD DATA (HUNTER, TOMBA, APOLLO)');

/** What the month has spent against its cap. */
export const spentWords = (spend) => `SPENT THIS MONTH: ${spend.spent} OF ${spend.rule.cap} CREDIT${spend.rule.cap === 1 ? '' : 'S'}${spend.rule.chosen ? '' : ' · YOU HAVE NOT CHOSEN YET, SO NOTHING PAID RUNS'}`;

/** One past lookup. */
export const lookupWords = (l) => `${String(l.at ?? '').slice(0, 10)} — ${l.domain} — ${String(l.source).toUpperCase()} — ${l.found} FOUND — ${Number.isFinite(l.spent) ? l.spent : 1} CREDIT(S)`;

/** Is the cap the operator typed a whole number the house accepts? */
export const capOk = (text) => /^\d{1,6}$/.test(String(text).trim());

/** The section's line: which rule stands, what is attached, and what the month has spent. */
export const spendStats = (spend) => [
  spend.rule.chosen ? { text: SPEND_CHOICES.find((c) => c.mode === spend.rule.mode)?.label ?? spend.rule.mode, tone: 'on' } : { text: 'NOT CHOSEN — NOTHING PAID RUNS', tone: spend.attached.length ? 'alert' : null },
  spend.attached.length ? spend.attached.map((id) => id.toUpperCase()).join(' · ') : 'NO PROVIDER ATTACHED',
  `${spend.spent} OF ${spend.rule.cap} CREDITS THIS MONTH`,
];
