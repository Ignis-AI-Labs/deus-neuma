// THE LEAD PIPELINE — one road from the first search to the first email, the same for every audience
// (Design note, 2026-11-16: […]; and 11-17: […]).
//
//   1 GATHER     a search of the audience's own, the wide net gathered into its pool
//   2 FILTER     the pool narrowed to the most reasonable prospects: a shortlist (the rest passed over)
//   3 VERIFY     each shortlisted company's own site read: alive or dead, what it says, what it publishes
//   4 SCORE      each verified company researched against the audience's signs of fit, and scored
//   5 VALIDATE   each fit confirmed from its own page by the house's screening (a lead run): no list for the operator
//                to read (Design note, 2026-11-21: […])
//   6 CONTACTS   the people at each validated fit, top first (a paid lookup, or the addresses its site publishes)
//   7 LEADS      the top person of each fit filed on the lead list
//   8 OUTREACH   the first email to each lead; then the upkeep (follow-ups, the next one up)
//
// Where every company of an audience stands, counted step by step, and the ONE next step — the
// work closest to a sent email first, so what is already found is worked before more is found. The
// acts hold the order too: only a shortlisted company's site is read, a company is scored only once
// its site was read alive, and people are pulled only at a company scored as a fit. The briefing and
// the desk both read this one function. PURE.

export const STEPS = Object.freeze([
  { id: 'discover', label: 'GATHER', act: 'sales/gather from the source with the best record for this audience (sales/discover looks at Hunter for free first)', does: 'a search of its own for this audience' },
  { id: 'filter', label: 'FILTER', act: 'sales/candidates to look, then sales/shortlist', does: 'narrow the pool to the most reasonable prospects' },
  { id: 'verify', label: 'VERIFY', act: 'sales/read-sites', does: 'read each shortlisted company\'s own site' },
  { id: 'score', label: 'SCORE', act: 'read its pages, then sales/prospect', does: 'research each verified company against the signs of fit and score it' },
  { id: 'approve', label: 'VALIDATE', act: 'sales/run — a lead run validates every fit waiting, then finds the people and files the leads itself', does: 'confirm each fit from its own page' },
  { id: 'contacts', label: 'CONTACTS', act: 'sales/contacts (up to ten at once)', does: 'pull the people at each fit, top first' },
  { id: 'leads', label: 'LEADS', act: 'sales/lead', does: 'file the top person of each fit on the lead list' },
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
export const audiencePipeline = ({ segment, candidates = [], prospects = [], leads = [], searches = [], held = new Map(), drafts = [] }) => {
  const live = prospects.filter((p) => p.stage !== 'dropped');
  const scoredDomains = new Set(prospects.map((p) => p.domain));
  const waiting = candidates.filter((c) => !scoredDomains.has(c.domain));
  const unsorted = waiting.filter((c) => !c.shortlist && !c.siteRead);
  const unread = waiting.filter((c) => c.shortlist === 'kept' && !c.siteRead);
  const toScore = waiting.filter((c) => c.siteRead?.alive);
  const fits = live.filter((p) => p.match >= 2);
  const peopleAt = (p) => hasAddress(p) || (held.get(p.domain) ?? []).length > 0;
  const noPeople = fits.filter((p) => p.stage === 'found' && !peopleAt(p));
  const toFile = fits.filter((p) => p.stage === 'found' && peopleAt(p));
  const onList = fits.filter((p) => p.stage === 'promoted');
  const byId = new Map(leads.map((l) => [l.id, l]));
  const leadOf = (p) => byId.get(p.leadId) ?? null;
  // An email staged for the operator's review is written: it waits on them, not on the seat.
  const staged = new Set(drafts.filter((d) => d.state === 'waiting').flatMap((d) => d.to ?? []).map((a) => String(a).toLowerCase()));
  const open = onList.filter((p) => { const l = leadOf(p); return l && !WRITTEN.has(l.status) && l.contact; });
  const unwritten = open.filter((p) => !staged.has(String(leadOf(p).contact).toLowerCase()));
  const steps = {
    // Companies gathered before searches were kept on record were found by one all the same.
    discover: { searches: searches.length, gathered: candidates.length, due: searches.length || candidates.length ? 0 : 1 },
    filter: { kept: candidates.filter((c) => c.shortlist === 'kept').length, passed: candidates.filter((c) => c.shortlist === 'passed').length, unsorted: unsorted.length, due: unsorted.length },
    verify: { unread: unread.length, alive: candidates.filter((c) => c.siteRead?.alive).length, dead: candidates.filter((c) => c.siteRead && !c.siteRead.alive).length, due: unread.length },
    score: { toScore: toScore.length, strong: live.filter((p) => p.match === 3).length, weak: live.filter((p) => p.match === 2).length, none: live.filter((p) => p.match === 1).length, due: toScore.length },
    contacts: { fits: fits.length, withPeople: fits.length - noPeople.length, due: noPeople.length },
    leads: { toFile: toFile.length, leads: onList.length, due: toFile.length },
    approve: { waiting: fits.filter((p) => !p.listApproved).length, approved: fits.filter((p) => p.listApproved).length, due: fits.filter((p) => !p.listApproved && p.stage === 'found').length },
    outreach: { unwritten: unwritten.length, staged: open.length - unwritten.length, written: onList.filter((p) => WRITTEN.has(leadOf(p)?.status)).length, replied: onList.filter((p) => REPLIED.has(leadOf(p)?.status)).length, due: unwritten.length },
  };
  const next = segment.state === 'draft' ? { id: 'pitch', words: 'its pitch waits for the operator\'s approval — nothing runs until then' }
    : segment.state !== 'approved' ? null
      : nextStep(steps);
  return { segment, steps, next };
};

// pure — the one next step: the work closest to a sent email first, then back up the road to a new search.
const nextStep = (steps) => {
  const order = ['outreach', 'leads', 'contacts', 'approve', 'score', 'verify', 'filter'];
  const due = order.find((id) => steps[id].due > 0);
  const step = (id) => STEPS.find((s) => s.id === id);
  if (due) return { id: due, count: steps[due].due, words: `${step(due).label}: ${step(due).does} — ${steps[due].due.toLocaleString('en-US')} waiting (${step(due).act})` };
  const first = steps.discover.due > 0;
  return { id: 'discover', count: 1, words: `GATHER: ${first ? 'this audience has no search of its own yet' : 'every company found so far is worked — search again, wider or another way'} (${STEPS[0].act})` };
};

/**
 * EXACTLY WHAT STANDS AT ONE STEP of an audience's road, each thing by its id — what the counts
 * count (Design note, 2026-11-17: […]). Pure.
 * @param {Parameters<typeof audiencePipeline>[0] & {drafts?: object[]}} state - drafts: the outbox's staged emails
 * @param {string} step - a STEPS id
 * @returns {object[]}
 */
export const stepItems = ({ candidates = [], prospects = [], leads = [], held = new Map(), drafts = [] }, step) => {
  const scoredDomains = new Set(prospects.map((p) => p.domain));
  const waiting = candidates.filter((c) => !scoredDomains.has(c.domain));
  const live = prospects.filter((p) => p.stage !== 'dropped');
  const fits = live.filter((p) => p.match >= 2);
  const peopleOf = (p) => [...(p.people ?? []).filter((x) => x?.email), ...(held.get(p.domain) ?? [])];
  const byId = new Map(leads.map((l) => [l.id, l]));
  const addresses = (c) => Number(c.hunterEmails?.total) || 0;
  switch (step) {
    case 'filter': return waiting.filter((c) => !c.shortlist && !c.siteRead).sort((a, b) => addresses(b) - addresses(a));
    case 'verify': return waiting.filter((c) => c.shortlist === 'kept' && !c.siteRead).sort((a, b) => addresses(b) - addresses(a));
    case 'score': return waiting.filter((c) => c.siteRead?.alive);
    case 'contacts': return fits.filter((p) => p.stage === 'found' && !peopleOf(p).length);
    case 'leads': return fits.filter((p) => p.stage === 'found' && peopleOf(p).length).map((p) => ({ ...p, top: peopleOf(p)[0] }));
    case 'approve': return fits.filter((p) => !p.listApproved);
    case 'outreach': {
      // Each lead with the id of the email staged to it, if one waits: staging again replaces that one.
      const draftTo = new Map(drafts.filter((d) => d.state === 'waiting').flatMap((d) => (d.to ?? []).map((a) => [String(a).toLowerCase(), d.id])));
      return fits.filter((p) => p.stage === 'promoted').map((p) => ({ prospect: p, lead: byId.get(p.leadId) ?? null }))
        .filter(({ lead }) => lead && lead.contact && !WRITTEN.has(lead.status))
        .map(({ prospect, lead }) => ({ ...lead, domain: prospect.domain, staged: draftTo.has(String(lead.contact).toLowerCase()), draft: draftTo.get(String(lead.contact).toLowerCase()) ?? null }));
    }
    default: return [];
  }
};

/** The road of one audience in one line, step by step. Pure. */
export const pipelineLine = ({ segment, steps, next }) => {
  const n = (v) => v.toLocaleString('en-US');
  return [
    `[${segment.id}] ${segment.name}`,
    `1 GATHER ${n(steps.discover.gathered)} found (${steps.discover.searches} search${steps.discover.searches === 1 ? '' : 'es'})`,
    `2 FILTER ${n(steps.filter.kept)} shortlisted, ${n(steps.filter.passed)} passed over, ${n(steps.filter.unsorted)} not filtered`,
    `3 VERIFY ${n(steps.verify.alive)} alive, ${n(steps.verify.dead)} dead, ${n(steps.verify.unread)} shortlisted unread`,
    `4 SCORE ${steps.score.strong} strong, ${steps.score.weak} weak, ${steps.score.none} no fit, ${n(steps.score.toScore)} to score`,
    `5 VALIDATE ${steps.approve.approved} validated${steps.approve.waiting ? `, ${steps.approve.waiting} wait for a lead run` : ''}`,
    `6 CONTACTS people at ${steps.contacts.withPeople} of ${steps.contacts.fits} fits`,
    `7 LEADS ${steps.leads.leads} on the list${steps.leads.toFile ? `, ${steps.leads.toFile} to file` : ''}`,
    `8 OUTREACH ${steps.outreach.written} sent, ${steps.outreach.replied} replied${steps.outreach.staged ? `, ${steps.outreach.staged} staged for the operator's review` : ''}${steps.outreach.unwritten ? `, ${steps.outreach.unwritten} to write` : ''}`,
  ].join(' · ') + (next ? ` — NEXT: ${next.words}` : '');
};

/** What the seat reads first about the road. */
export const PIPELINE_RULE = `THE SCRIPT, IN ORDER — follow it exactly, for every audience: (1) GATHER companies with a NARROW search (sales/gather; a search matching more than 10,000 keeps nothing) FROM THE SOURCE THAT HAS GIVEN THIS AUDIENCE THE MOST FITS — the record of each source stands below, per audience. No source is the first by habit: Hunter's search is free and wide, and what it brings has fitted far less often than a paid company search that finds an audience by what it IS, so take the source with the best record first, and where an audience has no record yet gather a small batch from each attached source and let the record say. (2) START A LEAD RUN: sales/run {segment, leads} — the house itself reads every gathered company's site, screens it from its own page, finds the person, confirms one address and files the lead, several companies at once. NEVER do those steps by hand one company at a time while a run can do them. (3) The run also writes the research card and the first email of each lead it files, from the company's own page, staged for your operator; the ones it says it could not write are yours, and a lead worth more than its page shows (a recent raise, a deal) you may research deeper and stage again. (4) Answer replies; book calls. Your own turns go to (1), (3) and (4). GRADE YOUR OWN WORK: sales/review grades every stage against the written standard, from the records, free — read it after each run and before you call a batch ready, and fix every MUST it names. KEEPING IT FLOWING IS YOUR JOB: whenever you wake, and when a run or a gather ends, read sales/run {status: true} — it says where EVERY audience stands and its one next step — and do that step for each: start a run where companies wait (several audiences at once), gather where nothing waits (from the source with the best record; a free Base list in one gather with count), and where FEW ARE A FIT read the misses it lists and fix the cause (a narrower gather, or tell your operator the first sign is something no page says) before running that audience again. Never leave an audience idle with companies waiting, and never leave a lead without its research and its first email. The road each company walks, whoever walks it: ${STEPS.map((s, i) => `${i + 1} ${s.label} (${s.does})`).join(', ')}. Each audience has a search of its own. Narrow the wide net before reading a single site: shortlist the most reasonable prospects (what Hunter holds there, size, its name and words) and pass the rest over with why. Only a shortlisted company's site is read; every company read alive is SCORED right after — research it against the signs of fit, score every sign; people are pulled only at a company scored as a fit; the top person of each fit goes on the lead list. Work the NEXT step named for each audience — it is the work closest to a sent email. sales/pipeline lists exactly what stands at any step, each thing by its id (the companies to file with their top person, the leads to write, every staged email): read it rather than guess.`;
