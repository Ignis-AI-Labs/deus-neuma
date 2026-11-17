// THE LEAD PIPELINE — one road from discovery to the first email, the same for every audience
// (Design note, 2026-11-16: […]).
//
//   1 DISCOVER   a search of its own for the audience (Hunter's company search, the wide net)
//   2 VERIFY     each company's own site read: alive or dead, what it says it is, what it publishes
//   3 RESEARCH   each live company's pages read against the audience's signs of fit, and SCORED
//   4 CONTACTS   the people at each fit, top first (a paid lookup, or the addresses its site publishes)
//   5 LEADS      the top person of each fit filed on the lead list
//   6 APPROVE    the operator approves the list (their step)
//   7 OUTREACH   the first email to each lead; then the upkeep (follow-ups, the next one up)
//
// Where every company of an audience stands, counted step by step, and the ONE next step — the
// work closest to a sent email first, so a pool already full is worked before it is fed. The acts
// hold the order too: a company is scored only once its site was read alive, and people are pulled
// only at a company scored as a fit. The briefing and the desk both read this one function. PURE.

export const STEPS = Object.freeze([
  { id: 'discover', label: 'DISCOVER', act: 'sales/discover, then sales/gather source hunter-discover', does: 'a search of its own for this audience' },
  { id: 'verify', label: 'VERIFY', act: 'sales/read-sites', does: 'read each gathered company\'s own site' },
  { id: 'research', label: 'RESEARCH', act: 'read its pages, then sales/prospect', does: 'research each live company against the signs of fit and score it' },
  { id: 'contacts', label: 'CONTACTS', act: 'sales/contacts (up to ten at once)', does: 'pull the people at each fit, top first' },
  { id: 'leads', label: 'LEADS', act: 'sales/lead', does: 'file the top person of each fit on the lead list' },
  { id: 'approve', label: 'APPROVE', act: 'the operator\'s APPROVE THE LIST', does: 'the operator approves the list' },
  { id: 'outreach', label: 'OUTREACH', act: 'sales/draft-email', does: 'write the first email to each lead' },
]);
const WRITTEN = new Set(['contacted', 'replied', 'qualified', 'won', 'lost']);
const REPLIED = new Set(['replied', 'qualified', 'won']);

const hasAddress = (p) => (p.people ?? []).some((x) => x?.email);

/**
 * Where one audience stands on the road, step by step, and its next step. Pure.
 * @param {{segment: object, candidates?: object[], prospects?: object[], leads?: object[], searches?: object[], held?: Map<string, object[]>}} state
 *   candidates/prospects/searches of this audience; leads: the whole lead list (matched by id); held: people pulled, by company
 */
export const audiencePipeline = ({ segment, candidates = [], prospects = [], leads = [], searches = [], held = new Map() }) => {
  const live = prospects.filter((p) => p.stage !== 'dropped');
  const scoredDomains = new Set(prospects.map((p) => p.domain));
  const waiting = candidates.filter((c) => !scoredDomains.has(c.domain));
  const unread = waiting.filter((c) => !c.siteRead);
  const dead = candidates.filter((c) => c.siteRead && !c.siteRead.alive);
  const toScore = waiting.filter((c) => c.siteRead?.alive);
  const fits = live.filter((p) => p.match >= 2);
  const peopleAt = (p) => hasAddress(p) || (held.get(p.domain) ?? []).length > 0;
  const noPeople = fits.filter((p) => p.stage === 'found' && !peopleAt(p));
  const toFile = fits.filter((p) => p.stage === 'found' && peopleAt(p));
  const onList = fits.filter((p) => p.stage === 'promoted');
  const byId = new Map(leads.map((l) => [l.id, l]));
  const leadOf = (p) => byId.get(p.leadId) ?? null;
  const unwritten = onList.filter((p) => { const l = leadOf(p); return l && !WRITTEN.has(l.status) && l.contact; });
  const steps = {
    // Companies gathered before searches were kept on record were found by one all the same.
    discover: { searches: searches.length, gathered: candidates.length, due: searches.length || candidates.length ? 0 : 1 },
    verify: { unread: unread.length, alive: candidates.filter((c) => c.siteRead?.alive).length, dead: dead.length, due: unread.length },
    research: { toScore: toScore.length, strong: live.filter((p) => p.match === 3).length, weak: live.filter((p) => p.match === 2).length, none: live.filter((p) => p.match === 1).length, due: toScore.length },
    contacts: { fits: fits.length, withPeople: fits.length - noPeople.length, due: noPeople.length },
    leads: { toFile: toFile.length, leads: onList.length, due: toFile.length },
    approve: { waiting: fits.filter((p) => !p.listApproved).length, approved: fits.filter((p) => p.listApproved).length, due: 0 },
    outreach: { unwritten: unwritten.length, written: onList.filter((p) => WRITTEN.has(leadOf(p)?.status)).length, replied: onList.filter((p) => REPLIED.has(leadOf(p)?.status)).length, due: unwritten.length },
  };
  const next = segment.state === 'draft' ? { id: 'pitch', words: 'its pitch waits for the operator\'s approval — nothing runs until then' }
    : segment.state !== 'approved' ? null
      : nextStep(steps);
  return { segment, steps, next };
};

// pure — the one next step: the work closest to a sent email first, then down to a new search.
const nextStep = (steps) => {
  const order = ['outreach', 'leads', 'contacts', 'research', 'verify'];
  const due = order.find((id) => steps[id].due > 0);
  const step = (id) => STEPS.find((s) => s.id === id);
  if (due) return { id: due, count: steps[due].due, words: `${step(due).label}: ${step(due).does} — ${steps[due].due.toLocaleString('en-US')} waiting (${step(due).act})` };
  const first = steps.discover.due > 0;
  return { id: 'discover', count: 1, words: `DISCOVER: ${first ? 'this audience has no search of its own yet' : 'every company found so far is worked — search again, wider or another way'} (${STEPS[0].act})` };
};

/** The road of one audience in one line, step by step. Pure. */
export const pipelineLine = ({ segment, steps, next }) => {
  const n = (v) => v.toLocaleString('en-US');
  return [
    `[${segment.id}] ${segment.name}`,
    `1 DISCOVER ${n(steps.discover.gathered)} found (${steps.discover.searches} search${steps.discover.searches === 1 ? '' : 'es'})`,
    `2 VERIFY ${n(steps.verify.alive)} alive, ${n(steps.verify.dead)} dead, ${n(steps.verify.unread)} unread`,
    `3 RESEARCH ${steps.research.strong} strong, ${steps.research.weak} weak, ${steps.research.none} no fit, ${n(steps.research.toScore)} to score`,
    `4 CONTACTS people at ${steps.contacts.withPeople} of ${steps.contacts.fits} fits`,
    `5 LEADS ${steps.leads.leads} on the list${steps.leads.toFile ? `, ${steps.leads.toFile} to file` : ''}`,
    `6 APPROVE ${steps.approve.waiting ? `${steps.approve.waiting} wait for the operator` : 'nothing waiting'}`,
    `7 OUTREACH ${steps.outreach.written} written, ${steps.outreach.replied} replied${steps.outreach.unwritten ? `, ${steps.outreach.unwritten} to write` : ''}`,
  ].join(' · ') + (next ? ` — NEXT: ${next.words}` : '');
};

/** What the seat reads first about the road. */
export const PIPELINE_RULE = `THE PIPELINE — every audience walks the same road, step by step, never skipping one: ${STEPS.map((s, i) => `${i + 1} ${s.label} (${s.does})`).join(', ')}. Each audience has a search of its own. A company is scored only once its own site was read and found alive; people are pulled only at a company scored as a fit; the top person of each fit goes on the lead list. Work the NEXT step named for each audience — it is the work closest to a sent email.`;
