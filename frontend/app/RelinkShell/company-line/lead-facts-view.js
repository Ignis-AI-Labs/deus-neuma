// lead-facts-view.js — how the sales facts sheet reads. Pure.

/** Where the sheet stands, in the operator's words. */
export const sheetState = (facts) => (!facts?.sheet ? 'NONE FILED — NO LEAD IS EMAILED UNTIL ONE IS APPROVED'
  : facts.review?.verdict === 'approved' ? 'APPROVED — EMAILS TO LEADS ARE CHECKED AGAINST IT'
    : facts.review?.verdict === 'returned' ? `RETURNED — ${facts.review.note}`
      : 'WAITS FOR YOUR APPROVAL');

/** The facts under the company each is true of, in the sheet's own order; a fact that names none stands under EVERY COMPANY. */
export const factsByCompany = (sheet, companies = []) => {
  const groups = [];
  for (const fact of sheet?.facts ?? []) {
    const id = fact.company || '';
    const group = groups.find((g) => g.id === id) ?? groups[groups.push({ id, name: (companies.find((c) => c.id === id)?.name ?? id) || 'EVERY COMPANY', facts: [] }) - 1];
    group.facts.push(fact);
  }
  return groups;
};

/** What the seat's holder is asked about one fact; drafted in their chat, sent by the operator. */
export const factAsk = (fact) => `About fact ${fact.n} on the sales facts sheet${fact.company ? ` (${fact.company})` : ''}: "${fact.claim}" (source: ${fact.source}). Tell me exactly where it comes from and whether it is still true today, and propose a better wording if it needs one. Do not file a new sheet until I say so.`;

/** May the edited fact be saved: a real claim and a source, and something changed. */
export const editReady = (draft, fact) => draft.claim.trim().length >= 10 && draft.source.trim().length >= 5 && (draft.claim.trim() !== fact.claim || draft.source.trim() !== fact.source);

const same = (a, b) => a.company === b.company && a.claim === b.claim && a.source === b.source;

/** The facts ticked when the sheet opens: the ones the operator already approved, word for word (a re-filed sheet is not checked twice). */
export const startChecked = (facts) => (facts?.sheet?.facts ?? []).filter((f) => (facts.approved?.facts ?? []).some((a) => same(a, f))).map((f) => f.n);

/** One fact's standing on a reviewed sheet: 'approved', 'held' (sent back to fix), or null while the sheet waits. */
export const factStanding = (facts, fact) => (!facts?.review || facts.review.verdict !== 'approved' ? null : (facts.review.held ?? []).some((h) => h.n === fact.n) ? 'held' : 'approved');

/** The count line over the sheet. */
export const checkedWords = (checked, total) => `${checked} OF ${total} CHECKED`;

/** A reviewed sheet in one line: how many stand and how many went back. */
export const reviewWords = (facts) => {
  const held = facts?.review?.held?.length ?? 0;
  if (facts?.review?.verdict !== 'approved' || !held) return null;
  return `${facts.sheet.facts.length - held} APPROVED · ${held} SENT BACK TO FIX`;
};

/** The whole sheet in one line: how many facts, and where the sheet stands. */
export const sheetStats = (facts) => {
  const sheet = facts?.sheet;
  if (!sheet) return [{ text: 'NONE FILED', tone: 'alert' }];
  const held = facts.review?.held?.length ?? 0;
  const state = !facts.review ? { text: 'WAITS FOR YOUR APPROVAL', tone: 'alert' }
    : facts.review.verdict === 'returned' ? { text: 'RETURNED', tone: 'alert' }
      : held ? { text: `${sheet.facts.length - held} APPROVED · ${held} SENT BACK`, tone: 'alert' } : { text: 'APPROVED', tone: 'on' };
  return [`${sheet.facts.length} FACT${sheet.facts.length === 1 ? '' : 'S'}`, state];
};

/** One company's line on the sheet: its facts, and how many are ticked (while it waits) or stand (once reviewed). */
export const groupStats = (group, facts, ticked = []) => {
  const n = group.facts.length;
  const count = `${n} FACT${n === 1 ? '' : 'S'}`;
  if (!facts?.review) return [count, `${group.facts.filter((f) => ticked.includes(f.n)).length} CHECKED`];
  if (facts.review.verdict !== 'approved') return [count];
  const held = group.facts.filter((f) => (facts.review.held ?? []).some((h) => h.n === f.n)).length;
  return [count, held ? { text: `${n - held} APPROVED · ${held} TO FIX`, tone: 'alert' } : { text: 'APPROVED', tone: 'on' }];
};
