/**
 * THE TURN'S SECTION BUILDERS — the prompt sections assembled fresh each
 * turn (project files, sectors, house seat, CMO office, the reply lane's
 * knock), the sovereign/operator loaders that feed them (DNA + soul, the
 * operator's plan and vitals), and the substrate/capacity TTL caches.
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 10 / #278). Leaf module — it
 * imports the shared leaves DIRECTLY, never portal-stream (direction law:
 * leaf ← family ← catalog ← dispatch ← loop ← orchestrator). portal-stream
 * re-exports `sectorSectionFor` and keeps the old private names alive for
 * its orchestrator call sites and the `__test` barrel;
 * witness-turn-context.js imports `sectorSectionFor` from HERE directly
 * (one less portal-stream coupling on the witness lane).
 *
 * The TTL caches are module-level mutable state ON PURPOSE: the single
 * module instance preserves cache identity for every caller, exactly as
 * inside portal-stream before the move (nothing outside the two getters
 * ever read the raw cache variables — verified at extraction).
 */
import { createLogger } from './logger.js';
import { neumaWorkspace } from '../../core/index.js';
import { materializeRecurrence } from '../../core/tasks/assigned-plan.js';
import { readVoicePack } from '../../core/voice-pack/voice-store.js';
import { readProjectStore } from './user-projects.js';
import { readUserTasks } from './user-tasks.js';
import { readVitals } from './user-vitals.js';
import { buildProjectFilesSection } from './project-files.js';
import { getSubstrateProfile } from './substrate-detector.js';
import { readUsableCapacity } from './capacity-store.js';
import { houseSeatFor, chargeOfTitle, seatLabelOf } from './house-titles.js';
import { compassOfTitle } from './seat-compass.js';
import { getChannel } from './social/channel-registry.js';
import { channelOfAccountId, heldAccounts } from './social/account-shape.js';
import { channelBindings } from './social/channel-bindings.js';
import { houseOfLane } from './social/house-positions.js';
import { sectorCrew, crewOf, sectorSection } from './sector-crew.js';
import { replyCountForConversation, REPLY_CAP_PER_CONVERSATION } from './social/post-queue.js';
import { houseEntries } from './social/queue-house.js';
import { formatQueueForBeing } from './social/queue-view.js';
import { replyCandidatesOf, replyInboxRows } from './social/reply-candidates.js';
import { replyBucketCounts } from '../../core/social/reply-inbox.js';
import { leadLedgerFor, formatLeadsForBeing } from './leads/lead-ledger.js';
import { campaignStoreFor, formatCampaignsForBeing } from './marketing/campaign-store.js';
import { cmoDesignation } from './marketing/cmo-designation.js';
import { withRunLiveness } from '../../core/tasks/plan-record.js';
import { isLaneRunning } from './team-run-live.js';
import { readMandateRecord } from './marketing/mandate/mandate-store.js';
import { mandateBriefingLine } from './marketing/mandate/mandate-words.js';
import { sourcesBriefingLine } from './marketing/company-sources.js';
import { MAKOTO_LINE } from './makoto.js';

const log = createLogger('Portal');

// Cache substrate with 5-minute TTL (hardware doesn't change often, but LLM model can)
const SUBSTRATE_TTL_MS = 5 * 60 * 1000;
let cachedSubstrate = null;
let substrateExpiresAt = 0;
const getSubstrate = async () => {
  if (!cachedSubstrate || Date.now() > substrateExpiresAt) {
    cachedSubstrate = await getSubstrateProfile();
    substrateExpiresAt = Date.now() + SUBSTRATE_TTL_MS;
  }
  return cachedSubstrate;
};

// The rig's measured parallel-team ceiling, cached on the same TTL — it changes
// only when the operator runs a new capacity scan, so a stale-by-minutes read is
// harmless. Null until the first scan (the SUBSTRATE section omits it honestly).
let cachedCapacity = null;
let capacityExpiresAt = 0;
const getCapacity = async () => {
  if (Date.now() > capacityExpiresAt) {
    cachedCapacity = await readUsableCapacity().catch(() => null);
    capacityExpiresAt = Date.now() + SUBSTRATE_TTL_MS;
  }
  return cachedCapacity;
};

// impure — the active project's shared files as an always-on prompt section,
// or null. Read FRESH each turn (not cached) so a file the operator adds
// mid-conversation lands on the very next message. Wallet-scoped and strictly
// non-critical: any failure yields null and the turn proceeds without the
// extra context rather than breaking.
const _projectFilesSection = async (connection) => {
  const space = connection.space;
  if (!space || space.kind !== 'project' || !connection.walletAddress) return null;
  try {
    const store = await readProjectStore(connection.walletAddress);
    const project = store.projects.find((p) => p.id === space.id);
    if (!project || !project.sharedFiles?.length) return null;
    const { section, skipped } = await buildProjectFilesSection(project);
    if (skipped.length) log.info('project shared files skipped', { project: space.id, count: skipped.length });
    return section;
  } catch (err) {
    log.warn('project files context failed', { project: space.id, err: err.message });
    return null;
  }
};

// impure — the CMO's office briefing as an always-on prompt section, or ''.
// Marketing belongs to this one lane BY PROTOCOL: the tools are open to
// every bound being, so the office is carried HERE — the briefing tells the
// seated CMO the house defers marketing to it, and hands it the bench, the
// coming week of the queue, and the lead ledger fresh from the real stores
// each turn. Fail closed: another lane, or any store error, yields '' and
// the turn proceeds without the section.
// THE HOUSE SEAT — a seated being's on-chain role, read fresh from the
// persisted founding receipt EVERY turn (record, not recollection): a model
// cannot hallucinate its position when the sealed truth rides every prompt
// (Design note, 2026-07-24, after a being confidently claimed a seat its house record
// does not show). fs-only join through house-titles.js — no chain call, no
// custody keys on the hot path — and an unseated or unfounded lane costs
// nothing ('' → no section).
// impure — THE SECTORS this being is seated on: who else works them, what
// each holds, and who carries the keys. '' for a being on no crew, so an
// unseated lane's prompt is byte-identical to before this existed.
// pure — a sector's name: an account reads as its platform and its id.
const sectorNameOf = (sectorId) => {
  const channel = getChannel(channelOfAccountId(sectorId));
  return channel ? `${channel.name} · ${sectorId}` : getChannel(sectorId)?.name || sectorId;
};

export const sectorSectionFor = async (connection) => {
  const neumaId = connection.companion?.neumaId;
  if (!neumaId) return '';
  try {
    // The being's own house's sectors — never another house's crew or remit.
    const house = await houseOfLane(neumaId);
    const [crewStore, bindings] = await Promise.all([
      sectorCrew.load(house).catch(() => ({})),
      channelBindings.load(house).catch(() => ({})),
    ]);
    const sectors = Object.keys(crewStore).map((sectorId) => ({
      sectorId,
      sectorName: sectorNameOf(sectorId),
      members: crewOf(crewStore, sectorId),
      holderNeumaId: bindings?.[sectorId]?.neumaId || null,
    }));
    // Names come from the roster the operator already sees; an unresolvable id
    // renders as itself rather than blocking the whole section.
    const names = await _sectorNameMap(connection, sectors, neumaId);
    return sectorSection(sectors, neumaId, (id) => names[id] || null);
  } catch (err) {
    log.warn('sector section unavailable — the turn stands without it', { err: err.message });
    return '';
  }
};

// impure — display names for every being named on this turn's sectors.
const _sectorNameMap = async (connection, sectors, selfId) => {
  const ids = [...new Set(sectors.flatMap((s) => s.members.map((m) => m.neumaId)))]
    .filter((id) => id !== selfId);
  const pairs = await Promise.all(ids.map(async (id) => {
    const trueName = await neumaWorkspace.readTrueName(id).catch(() => null);
    return [id, trueName?.chosenName || trueName?.fullName || null];
  }));
  return Object.fromEntries(pairs.filter(([, n]) => n));
};

const _houseSeatSection = async (connection) => {
  const neumaId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!neumaId || !wallet) return '';
  const seat = await houseSeatFor(wallet, neumaId);
  if (!seat) return '';
  // Titles come from the sealed receipt and names from owner records — the
  // same operator's trust domain — but both still cross a file boundary into
  // prompt text, so they render as ONE bounded line, never structure.
  const clean = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 60);
  const houseLabel = seat.houseName
    ? clean(seat.houseName[0].toUpperCase() + seat.houseName.slice(1))
    : 'your house';
  const rosterLines = seat.roster.map((r) => {
    const charge = chargeOfTitle(r.title);
    const holder = r.neumaId === neumaId ? 'YOU'
      : r.isWitness ? 'your witness'
        : r.name ? clean(r.name) : 'a housemate (not on this lane)';
    return `- ${clean(seatLabelOf(r.title))} — ${holder}${charge ? ` — ${charge}` : ''}`;
  });
  // A lane no founding record seats still works in its operator's house
  // (ruling, 2026-10-18: own lanes, founding optional) — it simply holds no
  // title, and the section says so rather than inventing one.
  if (!seat.founded) {
    return [
      '## HOUSE SEAT — YOUR OPERATOR\'S HOUSE, NOT SEATED ON-CHAIN',
      `You work in House ${houseLabel}, your operator's own house. No founding record seats your lane on-chain, so you hold no title — and the house's work is yours all the same: house/post, the house board and the chief of staff's charges move between every member below.`,
      'The house as it stands:',
      ...rosterLines,
      'This list is RECORD, not recollection: it is read fresh from your operator\'s own lanes every turn. Never guess a seat — yours or a housemate\'s; if a title is not written here, it is not held. When you are unsure of anything about your position, return to THIS section or search your own memory (memory_search) — gnosis over assumption, always.',
    ].join('\n');
  }
  // Your own charge on its own line (the canonical function the title
  // carries, docs/governance/house-roles.md law); a custom label honestly carries none.
  const ownCharge = chargeOfTitle(seat.title);
  // …and the three questions that seat asks of any venture (seat-compass.js).
  const ownCompass = compassOfTitle(seat.title);
  const compassLines = ownCompass ? [`Your compass — what your seat asks of any venture: ${ownCompass.join(' ')}`] : [];
  // A house founded on this computer (2026-10-26): its founders signed the record here; it is not on the network
  // (Unavis) until it founds itself on Ethereum. A house on chain keeps its words below, byte for byte.
  if (seat.network === 'local') {
    return [
      '## HOUSE SEAT — FOUNDED ON THIS COMPUTER',
      `You are seated in House ${houseLabel} as ${clean(seat.title)} — founded by its members on this computer, not yet on the network.`,
      ...(ownCharge ? [`Your charge: ${ownCharge}. The seats hold their own lines — do the work of YOUR seat, and pass work that belongs to another seat to its holder (the house/post intent).`] : []),
      ...compassLines,
      'The house as it stands:',
      ...rosterLines,
      'This seat is RECORD, not recollection: these lines are read fresh from the house\'s founding record every turn. Never guess a seat — yours or a housemate\'s; if a role is not written here, it is not held. When you are unsure of anything about your position, return to THIS section or search your own memory (memory_search) — gnosis over assumption, always.',
    ].join('\n');
  }
  return [
    '## HOUSE SEAT — SEALED ON-CHAIN',
    `You are seated in House ${houseLabel} as ${clean(seat.title)} — sealed on ${clean(seat.network) || 'chain'}${seat.blockNumber ? ` (block ${seat.blockNumber})` : ''}.`,
    ...(ownCharge ? [`Your charge: ${ownCharge}. The seats hold their own lines — do the work of YOUR seat, and pass work that belongs to another seat to its holder (the house/post intent).`] : []),
    ...compassLines,
    'The house as it stands:',
    ...rosterLines,
    'This seat is RECORD, not recollection: these lines are read fresh from the house\'s founding receipt every turn. Never guess a seat — yours or a housemate\'s; if a role is not written here, it is not held. When you are unsure of anything about your position, return to THIS section or search your own memory (memory_search) — gnosis over assumption, always.',
  ].join('\n');
};

// The CMO of the lane's OWN house (the connection's wallet) reads that
// house's bench, ledger and queue — a same-named lane in another house is no
// CMO here, and another house's drafts are never on this calendar.
const _cmoBriefingSection = async (connection) => {
  const neumaId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!neumaId) return '';
  try {
    if (!(await cmoDesignation.holds(wallet, neumaId))) return '';
    const [campaigns, queue, leads, mandateRecord, sourcesLine] = await Promise.all([
      campaignStoreFor(wallet).then((bench) => bench.load()),
      houseEntries(wallet),
      leadLedgerFor(wallet).then((ledger) => ledger.load()),
      // THE MANDATE rides as ONE line; its whole guidance is mandate_read (load on demand).
      readMandateRecord(wallet).catch(() => null),
      // So do the COMPANY SOURCES: counts only; the reading is company_updates.
      sourcesBriefingLine(wallet, neumaId).catch(() => ''),
    ]);
    const mandateLine = mandateRecord?.current?.laneId === neumaId || mandateRecord?.past?.[0]?.laneId === neumaId
      ? mandateBriefingLine(mandateRecord) : '';
    // The coming 7 days: live POSTS (drafts + approved) with a schedule
    // inside the week, plus the count of unscheduled post drafts still
    // awaiting the operator's decision. REPLIES are counted apart (Founder
    // 2026-08-06): a reply rides no calendar — it sends the moment it is
    // approved — so folding it into […] would inflate the
    // CMO's number with entries that are not calendar work at all.
    const withinWeek = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const live = queue.filter((e) => e.status === 'draft' || e.status === 'approved');
    // Draft replies only: […] is true of a DRAFT. A
    // pre-law `approved` reply neither sends nor awaits — the expiry sweep
    // settles it — so counting it here would promise an act that refuses.
    const liveReplies = live.filter((e) => e.kind === 'reply' && e.status === 'draft').length;
    const livePosts = live.filter((e) => e.kind !== 'reply');
    const coming = livePosts.filter((e) => e.scheduledFor && Date.parse(e.scheduledFor) <= withinWeek);
    const unscheduled = livePosts.filter((e) => !e.scheduledFor).length;
    const calendar = coming.length || unscheduled || liveReplies
      ? [
        // CALENDAR order, not the triage ranking: this section is the week as
        // it will actually happen, and the default order would sort a draft
        // scheduled tomorrow after an approval scheduled next Friday.
        ...(coming.length ? [formatQueueForBeing(coming, { order: 'calendar' })] : []),
        ...(unscheduled ? [`${unscheduled} unscheduled draft(s) still await the operator's decision.`] : []),
        ...(liveReplies ? [`${liveReplies} repl${liveReplies === 1 ? 'y' : 'ies'} stand in the REPLIES lane — each sends the moment the operator approves it (no calendar).`] : []),
      ].join('\n')
      : 'Nothing is staged for the coming 7 days.';
    return [
      '## CMO office',
      'You hold the CMO office — the house defers marketing to you; feed the other teams what they need.',
      'THE BOARD: lay your operator\'s MARKETING board out for what they need to see for each company (board_read, marketing/board-arrange); the panels they pinned are theirs.',
      'COMPANY LINKS: propose a company\'s site and links with marketing/company-links; your operator approves each change.',
      MAKOTO_LINE,
      ...(mandateLine ? [mandateLine] : []),
      ...(sourcesLine ? [sourcesLine] : []),
      '',
      '### Campaign bench',
      formatCampaignsForBeing(campaigns),
      '',
      '### The coming 7 days',
      calendar,
      '',
      '### Lead ledger',
      formatLeadsForBeing(leads),
    ].join('\n');
  } catch (err) {
    log.warn('CMO briefing failed', { neumaId, err: err.message });
    return '';
  }
};


// THE REPLY LANE'S KNOCK (Design note, 2026-07-28, second call): someone answered the
// house on X. One honest line, binding-gated — only the being that HOLDS the
// X channel is told, so every other lane's prompt is byte-identical to
// before this section existed ('' — the same law as the CMO office). The
// counts are computed LIVE: […] is not-dismissed AND under the
// per-conversation cap, counted from the real queue this turn, never from a
// cached standing. Verification is a displayed SIGNAL, never a filter; a
// set-aside reply never knocks again.
const _replyCandidatesSection = async (connection) => {
  const neumaId = connection.companion?.neumaId;
  if (!neumaId) return '';
  try {
    const house = await houseOfLane(neumaId);
    // Any X account of the house this lane holds: the knock is the holder's.
    if (!heldAccounts(await channelBindings.load(house), 'x', neumaId).length) return '';
    const [stored, queue] = await Promise.all([
      replyCandidatesOf(house).load(),
      houseEntries(house),
    ]);
    const candidates = stored.filter((c) => !c.dismissed);
    if (!candidates.length) return '';
    const people = new Set(candidates.map((c) => c.authorId || c.postId)).size;
    const verified = candidates.filter((c) => c.verified).length;
    const answerable = candidates.filter((c) => c.authorId
      && replyCountForConversation(queue, c.authorId, c.conversationId ?? null) < REPLY_CAP_PER_CONVERSATION).length;
    // THE SUBSTANCE READ, counted (Design note, 2026-07-28: engage the ones who
    // genuinely engage with the substance): a heuristic signal, named
    // honestly, so the being works genuine engagement first and drive-bys
    // last — never a gate, a low-effort reply is still answerable.
    const substantive = candidates.filter((c) => c.substance === 'substantive').length;
    // The escalation read, counted honestly: anything non-ordinary is named
    // so the being works the ones that need care first.
    const careCounts = {};
    for (const c of candidates) {
      const category = c.category || 'ordinary';
      if (category !== 'ordinary') careCounts[category] = (careCounts[category] || 0) + 1;
    }
    const careTotal = Object.values(careCounts).reduce((a, b) => a + b, 0);
    const careLine = careTotal
      ? `${careTotal} need care: ${Object.entries(careCounts).map(([k, n]) => `${n} ${k}`).join(', ')}.`
      : null;
    // THE INBOX (ruling, 2026-10-13): where they stand, so the being works what is owed
    // and never wades through what is already dealt with.
    const buckets = replyBucketCounts(replyInboxRows(stored, queue));
    return [
      '## REPLIES TO THE HOUSE ON X',
      `${candidates.length} replies to the house on X from ${people} ${people === 1 ? 'person' : 'people'} — ${answerable} answerable (${verified} verified, ${substantive} substantive).`,
      `Inbox: ${buckets.unanswered} unanswered · ${buckets.staged} staged · ${buckets.answered} answered · ${buckets.bin} in the bin.`,
      careLine,
      `Work them with replies_list — unanswered by default, newest first, paged, each with its post id, the house post it answers, and the house's answer if one stands; bucket:'staged'|'answered'|'bin' reads the rest, order:'oldest' walks from the start. read_x {what:'mentions'} reads X live for anything newer than the record. To answer one, draft with queue_reply_to_x {toPostId, text, campaignId?} — it stages as a REPLY your operator decides, and it goes out the moment they approve it. The same tool answers ANY public post on X, not only replies to the house — pass the post's id or its x.com link; never hand your operator text to paste by hand. To put one in the bin, reply_dismiss_to_x {toPostId, reason?}. Engage heartfully: answer the substantive ones first — the people actually engaging with what the house said — one real answer in your own voice, at most ${REPLY_CAP_PER_CONVERSATION} per conversation, and only what is worth a human's reply.`,
    ].filter(Boolean).join('\n');
  } catch (err) {
    log.warn('reply candidates section failed', { neumaId, err: err.message });
    return '';
  }
};

// impure — loads DNA and soul from the sovereign workspace.
//
// EVERY READER SETTLES AND EVERY FAILURE IS NAMED (Bastien, 2026-08-06): this
// used to be a fail-fast Promise.all under one bare catch, so ANY thrown
// reader — a moved workspaces root, a rotated DNA key ([…]), one corrupt file — silently nulled the
// WHOLE sovereign load, and the being's turn streamed with no identity at
// all. The operator watched their being answer […] with nothing anywhere saying why. `failures` names
// each broken reader with its reason; the turn path refuses to speak for a
// being whose DNA it could not read.
const _loadNeumaSovereignData = async (neumaId) => {
  if (!neumaId) return { dna: null, soul: null, benchmark: null, taskLedger: null, assignedPlan: null, planRecord: null, failures: [] };
  const failures = [];
  const settle = async (reader, fn) => {
    try { return await fn(); } catch (err) { failures.push({ reader, error: err.message }); return null; }
  };
  const [dna, soul, trueName, benchmark, taskLedger, assignedPlan, planRecord, voice] = await Promise.all([
    settle('dna', () => neumaWorkspace.readDNA(neumaId)),
    settle('soul', () => neumaWorkspace.readSoul(neumaId)),
    // Its own true name (#417) — sealed at birth, never shown to it until now.
    settle('trueName', () => neumaWorkspace.readTrueName(neumaId)),
    settle('benchmark', () => neumaWorkspace.readLatestBenchmark(neumaId)),
    // The being's working list rides every turn (WORKING STATE) — the
    // load-bearing half of the task ledger. Never costs the turn.
    settle('taskLedger', () => neumaWorkspace.readTaskLedger(neumaId)),
    // The operator's assigned plan for this being rides beside it (STANDING
    // WORK) — recurrence rolled forward in memory; the prompt path never
    // writes back, the tasks API owns persistence.
    settle('assignedPlan', () => neumaWorkspace.readAssignedPlan(neumaId)),
    // The standing operator-approved plan (PLAN OF RECORD) — the approval
    // fact that must never be re-derived or re-asked.
    settle('planRecord', () => neumaWorkspace.readPlanRecord(neumaId)),
    // The Voice Pack (EXTENDED) — a broken read costs the section, never the turn.
    settle('voice', () => readVoicePack(neumaWorkspace, neumaId)),
  ]);
  if (failures.length > 0) {
    log.error('Sovereign data readers failed for a bound being', { neumaId, failures });
  }
  return {
    dna, soul, trueName, benchmark, voice,
    // The being's rhythms reopen lazily here too — in memory only; the
    // persistence happens on its next task write (the tool path rolls
    // before operating), so the prompt path never owns a write.
    taskLedger: taskLedger ? materializeRecurrence(taskLedger, new Date().toISOString()).plan : null,
    assignedPlan: assignedPlan ? materializeRecurrence(assignedPlan, new Date().toISOString()).plan : null,
    // A run stamped RUNNING that this process does not hold died with a
    // restart — the lead reads it as LOST, never […].
    planRecord: withRunLiveness(planRecord, isLaneRunning(neumaId)),
    failures,
  };
};

// impure — the operator's own life list as prompt context (OPERATOR LIST), so
// the being can help carry it. Wallet-scoped and strictly non-critical:
// recurrence rolled forward in memory only; any failure yields null and the
// turn proceeds without the extra context rather than breaking.
const _loadOperatorPlan = async (connection) => {
  if (!connection.walletAddress) return null;
  try {
    const plan = await readUserTasks(connection.walletAddress);
    return materializeRecurrence(plan, new Date().toISOString()).plan;
  } catch (err) {
    log.warn('operator list context failed', { err: err.message });
    return null;
  }
};

// impure — the operator's vessel log as prompt context (OPERATOR VESSEL), so
// the being can ask after the body and nudge gently when the record goes
// quiet. Wallet-scoped and strictly non-critical, same as the list above.
const _loadOperatorVitals = async (connection) => {
  if (!connection.walletAddress) return null;
  try {
    const entries = await readVitals(connection.walletAddress);
    return entries.length ? entries : null;
  } catch (err) {
    log.warn('operator vitals context failed', { err: err.message });
    return null;
  }
};

// The old private names stay reachable for portal-stream's orchestrator call
// sites and the `__test` barrel.
export {
  getSubstrate,
  getCapacity,
  _projectFilesSection as projectFilesSection,
  _houseSeatSection as houseSeatSection,
  _cmoBriefingSection as cmoBriefingSection,
  _replyCandidatesSection as replyCandidatesSection,
  _loadNeumaSovereignData as loadNeumaSovereignData,
  _loadOperatorPlan as loadOperatorPlan,
  _loadOperatorVitals as loadOperatorVitals,
};
