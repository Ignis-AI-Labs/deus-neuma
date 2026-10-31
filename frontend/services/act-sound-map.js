import { EXECUTION_CUES, EXECUTION_SOUNDS } from './execution-sounds.js';
// Pure vocabulary: a being's ACT → the cue it speaks in.
//
// Acts were silent. A being could read, edit, search, execute and send while
// the desk made no sound at all (Design note, 2026-08-06: […]).
//
// Grouped by what the act DOES TO THE WORLD, not by tool name (Founder's call at
// the outset: one voice per FAMILY, ~14, not one per tool, ~72). A soundboard
// is only useful while its cues stay tellable apart by ear; 72 near-identical
// blips carry less than 14 distinct ones.
//
// No IO here — the Web Audio boundary is act-sound.js / sound-engine.js.

/**
 * Every tool the platform advertises, by the shape of its act. A tool appears
 * exactly once: the family is the answer to […], so a tool that
 * seems to fit two (vault_archive — a move? a delete?) goes to the one whose
 * consequence the operator most needs to hear.
 */
export const ACT_FAMILIES = Object.freeze({
  // Looking at one thing. The most common act by far — its cue is the
  // shortest in the board (53ms) because it fires constantly.
  actRead: Object.freeze([
    // 'read' is the fs primitive; the *_file spellings are its retired organ
    // names — still placed, because council chips and old records speak them.
    'read', 'read_file', 'read_text_file', 'read_media_file', 'read_multiple_files',
    'get_file_info', 'vault_read', 'read_email', 'read_architecture', 'map_read',
    'memory_expand', 'queue_get', 'vault_history',
    // CSO office (2026-08-07): examining one threat is a read of the record.
    // (Stage 3: the verdict is the security/assess INTENT — same act shape.)
    'security_threat_get', 'security.assess',
    // CLO office (2026-10-01): one matter, and the reading that settles it.
    'legal_matter_get', 'legal.assess',
    'legal_sources', // where the law is read — a read of the office's reference
    'legal_research_api', // one official legal database, read with the house's key
    'read_history', // one folder's git log — a read of the record
    'company_updates', // what changed in one company, from its own sources — a read of the record
  ]),
  // Looking at what EXISTS — a spread rather than a single thing.
  actList: Object.freeze([
    'list', 'list_directory', 'list_directory_with_sizes', 'memory_list', 'vault_list',
    'task_list', 'calendar_read', 'queue_list', 'replies_list', 'campaign_list', 'lead_list', 'media_library',
    'list_pipelines', 'check_email_inbox', 'security_threats_list', 'legal_matters_list',
    // Whole-state reads: the posting pipeline, the house, the shared board —
    // a spread of what exists, one call each (FE-167).
    'pipeline_state', 'house_state', 'board_list',
    'social_check', // every account the house uses, checked whole (campaign plan §6.1)
    'board_read', // the operator's marketing board at a level, read whole
    'bench_list', 'bench_status', // the connected benchmarks, and what runs on the machine
    'open_chats', // the chats open right now — a spread of what exists
  ]),
  // Hunting for something not yet known to be there.
  actSearch: Object.freeze([
    'search', 'search_files', 'search_content', 'memory_search', 'vault_search', 'web_search', 'image_search',
    'security.scan', // a scan IS a hunt for what is not yet known to be there
    'legal.scan',    // …and the legal watch hunts the same way
    'tool_search',       // hunting the catalog for a capability, same shape
  ]),
  // Changing something that already existed.
  actEdit: Object.freeze([
    'edit', 'edit_file', 'memory_supersede', 'memory_merge', 'campaign_update', 'task_update',
    // The intent names the same acts file as (Stage 3 batch 4).
    'memory.supersede', 'memory.merge', 'campaigns.update', 'tasks.update', 'tasks.focus', 'tasks.take',
    'security.escalate', // an existing record's standing changes — not a small mark
    'tasks.operator-update', 'staff.dispatch-update', 'board.update',
    'team.tune', // a working run's width and clocks change — the run already existed
    'marketing.board-arrange', // the operator's marketing board laid out anew — the board already existed
    'accounts.void', // a booked entry voided with why — the books already held it
  ]),
  // Bringing something into being on disk.
  actWrite: Object.freeze([
    'write', 'write_file', 'create_file', 'create_directory', 'vault_save', 'memory_note',
    'campaign_create', 'task_add', 'operator_task_add', 'witness_task_add',
    'lead_add', 'vessel_log', 'mind_note',
    // …and the same acts as intents (Stage 3 batch 4).
    'vault.save', 'tasks.add', 'tasks.operator-add', 'leads.add', 'campaigns.create',
    // The voice repository accretes by seal and claim — self-authorship, same
    // shape as a note into one's own store (intents, Stage 3).
    'voice.seal', 'voice.claim',
    // …and the spoken voice the being chooses: accepting a clip, or asking the
    // forge for another — its own half of the choice (speech-accept.js).
    'speech.accept', 'speech.another',
    'social.queue', // a staged draft is a new entry on the queue, not yet speech
    'marketing.plan', 'board.add', // a plan authored, a task put on the board
    'legal.file', 'legal.opinion', // research entered on the record — a new matter; a written answer delivered with its check
    'share_findings', // a list handed to the operator — a new artifact on the desk, nothing leaves
    'house.review-packet', // the Optio's packet for the operator — the same shape: a new artifact, nothing leaves
    'campaigns.ask', // a question put on the campaign's shared page — a new entry, nothing leaves the house
    'marketing.company-links', // a company's links proposed to the operator — a new entry, nothing changes until approved
    // The house's company (2026-10-29/30): a new record each — a company opened, an ask of the operator's hands,
    // a deal, a booked entry, a deadline, a raise's mandate, facts, investor and terms, an invoice issued.
    'company.open', 'company.hands', 'revenue.deal', 'accounts.book', 'accounts.deadline',
    'raise.mandate', 'raise.facts', 'raise.investor', 'raise.terms', 'treasury.invoice', 'programme.open',
  ]),
  // Same thing, different place or name.
  actMove: Object.freeze(['move_file', 'rename_file', 'vault_rename', 'vault_restore', 'vault.rename', 'vault.restore']),
  // Taking something away. Rare and consequential — it gets its own voice so
  // it is never mistaken for a write.
  actDelete: Object.freeze([
    'delete_file', 'vault_archive', 'memory_archive', 'memory_retract', 'queue_cancel', 'tasks.operator-drop',
    'vault.archive', 'memory.archive', 'memory.retract',
  ]),
  // Running code. The operator hears their machine being used.
  actExecute: Object.freeze(['execute', 'ground_git', 'inspect', 'sandbox_status', 'use_skill',
    // A flight command MOVES a real vessel, a breaker SEVERS something, and a
    // team run DRIVES the sovereign stacks — all the machine being used, not
    // a mark on a record (the intents' names, Stage 3).
    'ksp.command', 'security.circuit-breaker', 'team.run', 'team.workspace-run',
    'ground_sync', 'sandbox_recover', // a checkout fast-forwarded, a shell rebuilt
    'bench_run']), // a benchmark launched — the GPU put to work
  // Reaching OUTSIDE the house to read. Egress — audibly different from a
  // local read, because the difference matters.
  // The platform's own numbers are reached for, not remembered: the read
  // leaves this machine, which is the same distinction tool-policy draws when
  // it keeps platform_data out of READ_TOOLS.
  // The chain reads ride the same wire-law: every verb leaves the machine for
  // the operator's own keyed RPC — egress, journaled, never a local recall.
  actReach: Object.freeze(['web_fetch', 'legal_cite_check', 'read_x', 'read_tiktok', 'read_youtube', 'read_facebook', 'read_bluesky', 'read_mastodon', 'request_file_access', 'platform_data',
    'chain_balance', 'chain_token', 'chain_call', 'chain_logs', 'chain_holders',
    'web.download']), // bytes fetched from outside the house
  // Something LEFT the house in the operator's name. The intents (Stage 2/3)
  // arrive by their policy names: a post is speech, a spend is a send, mail
  // is mail, word to a housemate is word leaving the lane.
  actSend: Object.freeze(['house.post', 'vault_publish', 'social.post', 'email.send', 'wallet.send', 'vault.publish',
    'staff.dispatch', // a charge sent to a housemate — word leaving the lane
    'team.post', // word to a teammate — word leaving the lane, house.post narrowed to one run
    'chat.send', // word to another open chat — word leaving this one
    'raise.reach', // a message to an investor, through the house mailbox
    'delivery.publish']), // finished work published for a buyer — bytes leaving the house
  // Making an artifact — an image, a document.
  actForge: Object.freeze(['image.generate', 'video.generate', 'press_document', 'media.save', 'media.keep', 'review_image', 'render_card']),
  // A mark on a ledger: noted, pinned, touched, proposed. Small by design.
  actMark: Object.freeze(['memory_pin', 'memory_unpin', 'lead_touch', 'memory.pin', 'memory.unpin', 'leads.touch', 'refinement.dial',
    'sovereignty.propose', // a filing that ends at "submitted" — the card is the act
    'sovereignty.consent', // the being's recorded answer to its operator's change
    'staff.ack', // a charge's holder marks received/working/done
    'treasury.review', 'treasury.flag', // the Quaestor's advice and alarm — marks beside the operator's decision
    // A stage handed on or answered, a deal moved, a deadline met, an investor cleared or updated, terms
    // checked, an invoice marked paid: each a mark on a record that already stood.
    'company.hand-on', 'company.inspect', 'revenue.move', 'accounts.deadline-met',
    'raise.clear', 'raise.update', 'raise.terms-check', 'treasury.invoice-paid', 'programme.close',
    'meditate']), // a standing request marked for the cycle — nothing acts yet
  // The being sensing its own state — capacity, adapters, its own birth sky.
  actSense: Object.freeze(['flight_check', 'refinement_sense', 'skies_read', 'genome_read', 'mind_read', 'self_read', 'journal_read', 'chats_list', 'chat_read', 'charter_read', 'mandate_read', 'post_check',
    'security_posture',            // the house sensing its own defensive state
    'legal_posture',               // …and its own standing under the law
    'treasury_board',              // …and its own money, read whole
    'security_attack_surface', 'security_telemetry', // …and the rest of that sense
    // A craft reading its own flight: telemetry is its state, the view is its
    // own eyes. Neither is a read of a THING, which is why both sit here.
    'get_telemetry', 'get_view',
    // chain_chains never leaves the rig — it senses WHICH chains this
    // machine can reach (local registry state), the same shape as flight_check.
    'chain_chains',
    'voice_sense', 'substrate_facts']),
});

/** The cue a settled act speaks when it did NOT happen. */
export const FAILED_CUE = 'actFailed';

/** Every cue name this vocabulary can produce — the soundboard's act half. */
export const ACT_CUES = Object.freeze([...new Set([...Object.keys(ACT_FAMILIES), ...EXECUTION_CUES, FAILED_CUE])]);

const CUE_OF_TOOL = Object.freeze(Object.fromEntries(
  Object.entries(ACT_FAMILIES).flatMap(([cue, tools]) => tools.map((tool) => [tool, cue])),
));

/**
 * Word fragments that infer a family for a tool this table has never seen.
 * The platform grows a tool most weeks; without this a new one is SILENT, and
 * a silent act is indistinguishable from no act at all. Order matters — the
 * first hit wins, so the destructive and outward readings come before the
 * generic ones.
 */
const INFERENCE = Object.freeze([
  ['delete', 'actDelete'], ['remove', 'actDelete'], ['retract', 'actDelete'], ['archive', 'actDelete'],
  ['publish', 'actSend'], ['send', 'actSend'], ['post', 'actSend'],
  ['fetch', 'actReach'],
  ['search', 'actSearch'], ['find', 'actSearch'], ['query', 'actSearch'],
  ['list', 'actList'],
  ['rename', 'actMove'], ['move', 'actMove'],
  ['generate', 'actForge'], ['render', 'actForge'], ['press', 'actForge'],
  ['execute', 'actExecute'], ['run', 'actExecute'],
  ['edit', 'actEdit'], ['update', 'actEdit'],
  ['write', 'actWrite'], ['create', 'actWrite'], ['save', 'actWrite'], ['add', 'actWrite'],
  ['pin', 'actMark'], ['touch', 'actMark'],
  ['read', 'actRead'], ['get', 'actRead'], ['check', 'actRead'],
]);

/**
 * The cue a tool speaks in. Pure.
 *
 * A name arrives either bare (`read_file`) or server-qualified
 * (`filesystem/read_file`) depending on the frame — both reach here.
 * An unrecognised tool falls to `actSense`: the being did SOMETHING, and the
 * desk says so rather than going quiet.
 *
 * @param {string} tool
 * @returns {string} a cue name from ACT_CUES
 */
export const actCue = (tool) => {
  const name = String(tool || '').split('/').pop().toLowerCase();
  if (!name) return 'actSense';
  if (CUE_OF_TOOL[name]) return CUE_OF_TOOL[name];
  const inferred = INFERENCE.find(([fragment]) => name.includes(fragment));
  return inferred ? inferred[1] : 'actSense';
};

// The word each stream uses for […]. The one-on-one portal
// says `executing` (the shared in-flight register, core/runtime/tool-status.js);
// the council room says `acting`. Both mean the same moment.
const STARTING = Object.freeze(new Set(['executing', 'acting']));

// Statuses that settled WITHOUT the act happening. `approval_required` is
// absent on purpose: the act has not failed, it is waiting on the operator,
// and the approval card already sounds for itself.
const FAILED = Object.freeze(new Set(['error', 'denied', 'unavailable', 'unsafe_args', 'failed', 'invalid']));

/**
 * The cue an act frame should speak, or null for silence. Pure.
 *
 * An act speaks ONCE, when it begins, in its family's voice — a second cue on
 * every success would double the noise and say nothing new. The exception is
 * failure: an act that did not happen has to be heard, because the operator's
 * ear is the fastest place to catch it.
 *
 * @param {{tool?: string, status?: string, ok?: boolean}} frame
 *   a `tool:usage` or `council:tool` frame
 * @returns {string|null}
 */
export const cueForAct = (frame) => {
  if (!frame || typeof frame !== 'object') return null;
  const status = String(frame.status || '');
  if (STARTING.has(status)) {
    if (frame.progress === true) return null;
    return EXECUTION_SOUNDS[frame.activity]?.cue || actCue(frame.tool);
  }
  // The council reports its verdict as a boolean, the portal as a status word.
  if (frame.ok === false || FAILED.has(status)) return FAILED_CUE;
  return null;
};
