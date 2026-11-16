// business-model-view.js — how the BUSINESS MODEL tab reads. Pure.

/** Where one company's model stands, in the words the operator reads. */
export const modelState = (company, names = {}) => {
  if (company.modelProposal) return `WAITING ON YOU — FILED BY ${String(names[company.modelProposal.by] ?? company.modelProposal.by ?? 'A MEMBER').toUpperCase()}`;
  if (company.model) return 'APPROVED';
  return company.modelReturned ? 'RETURNED — NOT WRITTEN YET' : 'NOT WRITTEN YET';
};

/** What the form starts from: the model that waits, else the one that stands, else empty. */
export const draftOf = (company, fields) => Object.fromEntries(fields.map((f) => [f.key, (company.modelProposal?.model ?? company.model)?.[f.key] ?? '']));

/** May it be saved: every needed part holds at least three characters. */
export const readyToSave = (draft, fields) => fields.every((f) => f.optional || String(draft[f.key] ?? '').trim().length >= 3);

/** Has the operator changed anything from what stands or waits? */
export const changed = (draft, company, fields) => fields.some((f) => String(draft[f.key] ?? '').trim() !== draftOf(company, fields)[f.key]);

/** What the seat's holder is asked, to work one company's model out with the operator. */
export const workItOutAsk = (company) => `Work out the business model of ${company.name} with me. Ask me one question at a time, in plain words, and wait for my answer: what we sell, who pays for it, the problem they have today, what objectively changes for them (a result they can check, not a feeling), what it costs and how we earn, what proves it, and what we are after in the next three months. Push back when an answer is vague. When we have it, file it with company/model (company: "${company.id}") and tell me to approve it in POSITIONS, COMPANY.`;

/** How tall an answer's box stands so the whole answer shows: about 90 characters a line, never under two lines. */
export const rowsFor = (text) => Math.max(2, String(text ?? '').split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 90)), 0));

/** One company's line: where its model stands, and how many of its questions are answered. */
export const modelStats = (company, fields, names = {}) => {
  const shown = company.modelProposal?.model ?? company.model ?? null;
  const answered = shown ? fields.filter((f) => shown[f.key]).length : 0;
  const state = modelState(company, names);
  return [{ text: state, tone: company.modelProposal ? 'alert' : company.model ? 'on' : 'alert' }, ...(shown ? [`${answered} OF ${fields.length} ANSWERED`] : [])];
};

/** The whole section's line: how many companies, how many approved, how many wait on the operator or are unwritten. */
export const modelsStats = (companies) => {
  const approved = companies.filter((c) => c.model && !c.modelProposal).length;
  const waiting = companies.filter((c) => c.modelProposal).length;
  const none = companies.filter((c) => !c.model && !c.modelProposal).length;
  return [`${companies.length} COMPAN${companies.length === 1 ? 'Y' : 'IES'}`, ...(approved ? [{ text: `${approved} APPROVED`, tone: 'on' }] : []), ...(waiting ? [{ text: `${waiting} WAITING ON YOU`, tone: 'alert' }] : []), ...(none ? [{ text: `${none} NOT WRITTEN`, tone: 'alert' }] : [])];
};

/** Does the section owe the operator anything: a model to approve, or one not written. */
export const modelsWait = (companies) => companies.some((c) => c.modelProposal || !c.model);
