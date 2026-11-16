// outbox-view.js — how the outbox reads: the emails the sales seat staged, waiting for the operator. Pure.

/** The outbox's own line: what waits, what went, what came back. */
export const outboxStats = (drafts = []) => {
  const n = (state) => drafts.filter((d) => d.state === state).length;
  return [n('waiting') ? { text: `${n('waiting')} TO REVIEW`, tone: 'alert' } : { text: 'NOTHING WAITS', tone: 'on' }, `${n('sent')} SENT`, ...(n('returned') ? [`${n('returned')} RETURNED TO FIX`] : [])];
};

/** The emails that wait, oldest first (the order they were written in). */
export const waitingDrafts = (drafts = []) => drafts.filter((d) => d.state === 'waiting').slice().reverse();

/** Who an email is for, in words: the lead's name when the address is a lead's, with the campaign it is tied to. */
export const draftFor = (draft, leads = []) => {
  const lead = leads.find((l) => draft.to.includes(String(l.contact).toLowerCase()));
  return { name: lead?.name ?? draft.to.join(', '), campaign: lead?.origin?.campaign ?? null, audience: lead?.origin?.audience ?? null };
};

/** How many words an email runs to (a first email is short). */
export const wordCount = (text) => (String(text ?? '').trim().match(/\S+/g) ?? []).length;

/** Whether the operator's change to an email is worth saving: something changed, and it is still an email. */
export const editReady = (edit, draft) => Boolean(edit) && edit.subject.trim().length > 0 && edit.text.trim().length >= 20 && (edit.subject.trim() !== draft.subject || edit.text.trim() !== draft.text);
