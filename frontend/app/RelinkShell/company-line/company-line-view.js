// company-line-view.js — the COMPANY LINE window's display law: who a holder
// is in words, what a line's state means, whose move it waits on, and what
// the operator may do from here. Pure — the window renders from these and
// nothing else (CompanyLineBody.jsx), and the server judges every move.

export const MODE_WORDS = Object.freeze({ field: 'IN YOUR FIELD', house: 'HOUSE-LED' });

const STATUS_WORDS = Object.freeze({
  open: 'WITH ITS MASTER',
  returned: 'RETURNED TO ITS MASTER',
  inspecting: 'UNDER INSPECTION',
  standing: 'THE COMPANY STANDS',
});

/**
 * A holder in words: YOU for the operator, the being's name, else its lane.
 * @param {?string} holder - a lane id, 'operator', or null
 * @param {Record<string, string>} names - lane id → name
 */
export const holderName = (holder, names) => {
  if (holder === 'operator') return 'YOU';
  if (!holder) return 'NOBODY';
  return (names?.[holder] || holder).toUpperCase();
};

/** @param {{status: string}} company */
export const statusWords = (company) => STATUS_WORDS[company?.status] ?? '—';

/** The stage the line is at, or null once the company stands. */
export const currentStage = (company) => company?.stages?.find((s) => s.id === company.stage) ?? null;

/**
 * Whose move the line waits on, in words.
 * @param {object} company - the server's line view
 * @param {Record<string, string>} names
 */
export const upWords = (company, names) => {
  const up = company?.up ?? {};
  if (up.kind === 'standing') return 'NOTHING — THE COMPANY STANDS';
  if (up.kind === 'unheld') return `NOBODY HOLDS THE ${String(up.seat).toUpperCase()} SEAT`;
  const who = holderName(up.holder, names);
  if (up.kind === 'master') return `${who} — TO MASTER`;
  if (up.as === 'counsel') return `${who} — TO RECORD COUNSEL'S ANSWER`;
  return `${who} — TO INSPECT AS ${String(up.as).toUpperCase()}`;
};

/**
 * The inspections the work in hand must pass, the current one [bracketed]. '' when none.
 * @param {object} company
 */
export const stepWords = (company) => {
  if (company?.status !== 'inspecting' || !company.handed) return '';
  const steps = company.handed.inspections.map((s, i) => (i === company.step ? `[${String(s).toUpperCase()}]` : String(s).toUpperCase()));
  return `INSPECTION ${company.step + 1} OF ${steps.length}: ${steps.join(' → ')}`;
};

/**
 * What the operator may do on this line now, or null when it waits on someone else.
 * @param {object} company
 * @returns {null | {kind: 'hand-on', ownYes: boolean, stoppable: boolean} | {kind: 'inspect', counsel: boolean, stoppable: boolean}}
 *   ownYes: handing it on is the operator's own yes — no second look follows
 */
export const operatorMove = (company) => {
  if (company?.up?.holder !== 'operator') return null;
  if (company.up.kind === 'master') return { kind: 'hand-on', ownYes: company.ownYes === true, stoppable: Boolean(currentStage(company)?.stoppable) };
  return { kind: 'inspect', counsel: company.up.as === 'counsel', stoppable: Boolean(currentStage(company)?.stoppable) };
};

const lines = (v) => String(v ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * Is the operator's hand-on draft whole enough to send? (The server judges
 * the worksheet itself; this only keeps HAND ON dark until something is there.)
 * @param {{id: string, worksheet: boolean}} stage
 * @param {object} draft
 */
export const handOnReady = (stage, draft) => {
  if (stage.id === 'choose') return Boolean(String(draft.why ?? '').trim()) && lines(draft.kill).length > 0;
  if (stage.worksheet) return Boolean(String(draft.json ?? '').trim());
  return Boolean(String(draft.artifact ?? '').trim());
};

/**
 * The hand-on the operator's draft sends, or a thrown reason (a JSON worksheet that does not parse).
 * @param {object} company - the line view
 * @param {object} draft
 * @returns {{stage: string, note?: string, artifact?: string, worksheet?: object}}
 */
export const handOnPayload = (company, draft) => {
  const stage = currentStage(company);
  const base = { stage: stage.id, ...(String(draft.note ?? '').trim() ? { note: draft.note } : {}) };
  if (stage.id === 'choose') {
    return { ...base, worksheet: { candidate: company.worksheets?.shape?.candidate ?? '', why: draft.why, killCriteria: lines(draft.kill) } };
  }
  if (!stage.worksheet) return { ...base, artifact: draft.artifact };
  try {
    return { ...base, worksheet: JSON.parse(draft.json) };
  } catch {
    throw new Error('The worksheet is not valid JSON.');
  }
};

/** What a HANDS item asks back, as the box's prompt. */
export const ANSWER_ASKS = Object.freeze({
  done: null,
  fact: 'The fact the house asked for',
  held: 'Where it is kept — never the secret itself',
});

/**
 * Every open HANDS item across the house, oldest first, each with its company.
 * @param {?{companies: object[]}} board
 */
export const openHands = (board) => (board?.companies ?? [])
  .flatMap((c) => (c.hands ?? []).filter((i) => i.status === 'open').map((i) => ({ ...i, company: c })))
  .sort((a, b) => a.raisedAt.localeCompare(b.raisedAt));

/** The site a link goes to, shown plainly beside it — a link is judged by where it leads. */
export const domainOf = (href) => {
  try {
    return new URL(href).hostname.toUpperCase();
  } catch {
    return '—';
  }
};

/**
 * The window's overview: what waits on you (moves on a line and HANDS asks),
 * how many lines are still being founded, how many companies stand.
 * @param {?{companies: object[]}} board
 */
export const lineOverview = (board) => {
  const companies = board?.companies ?? [];
  return {
    owed: companies.filter((c) => operatorMove(c)).length + openHands(board).length,
    founding: companies.filter((c) => c.status !== 'standing').length,
    standing: companies.filter((c) => c.status === 'standing').length,
  };
};
