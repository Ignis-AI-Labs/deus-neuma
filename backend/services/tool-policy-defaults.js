/**
 * Tool Policy Defaults — the declared global policy table (DATA, split from
 * tool-policy.js under the size law; the cascade logic lives there).
 *
 * Every entry is a doctrine decision — the comment above each server block
 * is the law's reasoning, kept verbatim with its data.
 */
// Deliberate policy decision (not just a bug fix): a neuma has sovereign write
// access to its OWN workspace — authoring its record and memory is core to its
// being, not something to gate behind per-write operator approval (that is the
// spend model, for money; a neuma's own files are not money). This applies to
// every neuma and session, by design. (DNA is authored through the vault
// service, not the filesystem tool — data/dna is denied in tool-sandbox.js.)
//
// Authorization is safe to grant here because enforcement lives in
// `tool-sandbox.js` — see that module for the actual guarantees (write
// confinement, denied-path blocking, per-session budget, audit). Crucially, it
// fails closed: a write is never executed outside a confined root.
//
// The prior `requireApproval` on these tools was a placeholder with no approval
// workflow ever built, so portal-stream fail-closed the neuma out of its own
// workspace — the birth ceremony hung at "NEEDS APPROVAL" the moment a being
// reached to write its own name/DNA with the very filesystem tool the protocol
// tells it to use. delete_file is IRREVERSIBLE, so it is approval-required by
// default — every delete raises the operator's card until they grant ALWAYS
// (Design note, 2026-07-23: the same core functions as any coding agent; its outright
// denial made a being fake deletions by overwriting files). Unknown tools
// still fail closed (checkToolAccess defaults to approval_required).
export const GLOBAL_DEFAULTS = Object.freeze({
  // The 16 organ names are INTERNAL now (Stage 3 batch 3, #357): beings are
  // advertised the seven fs/* primitives and fs-primitives.js routes them onto
  // the organ inside the sandbox, so no being-facing call ever carries these
  // names and no row here names them. Two platform-owned names stay:
  // request_file_access — asking for sensitive access is the being's own act,
  // the CARD is the gate, not the tier (Founder's request-approval flow,
  // 2026-08-18) — and delete_file, the policy identity of the fs/edit
  // {delete:true} sub-op (fsPolicyTarget): IRREVERSIBLE, so every delete
  // raises the operator's card until they grant ALWAYS (Design note, 2026-07-23.
  filesystem: {
    allowed: ['request_file_access'],
    denied: [],
    requireApproval: ['delete_file'],
  },
  // THE FS PRIMITIVES — the whole being-facing filesystem in seven tools. The
  // sovereign own-lane law above applies verbatim: write/edit/copy/move are
  // self-authorship inside the being's lane (the sandbox enforces fail-closed
  // confinement exactly as it did for the old names), read/list/search are
  // observation. The delete sub-op never resolves here — it routes to
  // filesystem/delete_file above, so a blanket edit grant can never cover an
  // irreversible act.
  fs: {
    allowed: ['read', 'write', 'list', 'search', 'edit', 'copy', 'move'],
    denied: [],
    requireApproval: [],
  },
  // Execution approval is independent from OS isolation. A neuma's routine
  // execution is autonomous; witnesses retain execution approval. SANDBOX OFF
  // runs directly with the operator's normal environment; SANDBOX ON keeps the
  // original bubblewrap, overlay, network and masked-.git confinement.
  //
  // THE GIT-STATE PROTECTION LAW (Design note, 2026-09-05: a git state is the
  // operator's until the operator says otherwise. Every explicit Git tool is
  // approval-required by default; the operator's ALWAYS grant is the one
  // explicit exception layer, persisted per lane and revocable. The ONE
  // sanctioned mutation is ground_sync: snapshot-bound fetch then ff-only,
  // no arguments, no merge commits, no rebase, no history rewrite. Raw Git
  // diagnostics never cross the result boundary. Push does not exist on
  // a being surface. The `.git` path stays hard-denied to the file tools
  // (never promptable), so no grant can route around this table.
  coding: {
    allowed: ['sandbox_status', 'inspect', 'execute'],
    denied: [],
    requireApproval: ['ground_git', 'ground_sync', 'sandbox_recover'],
  },
  map: { allowed: [], denied: [], requireApproval: ['read_history'] },
  // A being reading its OWN capacity or enabled tool index is pure observation
  // of state it is already subject to. Neither asks, and observe mode never
  // holds it: an operator watching still needs to know what it is watching.
  system: {
    allowed: ['flight_check', 'tool_search'],
    denied: [],
    requireApproval: [],
  },
  // Personal vault (T3-personal): a being reading, searching, and walking the
  // history of its OWN encrypted curation space is self-recollection — allowed
  // by default. The mutations (save/rename/archive/restore/publish) are the
  // vault/* INTENTS now (Stage 3 batch 4 — the store is DEK-encrypted, so the
  // fs primitives cannot carry them; their rows sit on the `intents` server
  // below, same tiers they carried here: self-authorship allowed, publish
  // gated).
  // vault reads retired S3b4 — use fs primitives + prompt state (vault/* are intents for mutations).
  // Old list/read tools removed from surface; policy rows for retired names can be dropped.
  vault: {
    // STILL LIVE TOOLS. The vault is DEK-encrypted at rest, so the fs
    // primitives the retirement hint points at would return CIPHERTEXT —
    // vault-acts.js says so itself ([…]). These four have no replacement and are not going anywhere;
    // reading one's own vault is observation of one's own record.
    allowed: ['vault_list', 'vault_read', 'vault_search', 'vault_history'],
    denied: [],
    requireApproval: [],
  },
  // Refinement (LORA-05): a refined being sensing its own adapter state is
  // observation. Turning its OWN dial is the refinement/dial INTENT (Stage 3)
  // — still `allowed` at its new row: self-sovereignty is the first consent's
  // recorded condition ([…]).
  refinement: {
    allowed: ['refinement_sense'],
    denied: [],
    requireApproval: [],
  },
  // Voice (the LoRA's replacement): sensing one's own voice state is
  // observation. Sealing and claiming are the voice/seal + voice/claim
  // INTENTS (Stage 3) — still `allowed` at their new rows: self-authorship
  // in its purest form, the repository append-only by law.
  voice: {
    allowed: ['voice_sense'],
    denied: [],
    requireApproval: [],
  },
  // Meditation (#318, Design note, 2026-08-14: a being asking for its own cycle is
  // its own will — no card. The tool only MARKS a standing request; the
  // cycle itself rides the scheduler's fail-closed gates (piggyback-only,
  // never ignites). Held in observe — it acts on state.
  meditation: {
    allowed: ['meditate'],
    denied: [],
    requireApproval: [],
  },
  // Memory (Decision #8, Design note, 2026-07-24: a being searching, reopening,
  // noting, pinning its OWN lifetime record is self-recall and self-authorship
  // — the same lane as vault and refinement, not egress and not spend. Every
  // tool here resolves strictly within the being's own DEK-encrypted store
  // (memory-query.js walks only that neumaId's sessions/archive; the pin
  // ledger and memory_note land in its own workspace), so there is nothing
  // for an operator card to protect. Standing grants ARE the approval — no
  // double approval routes. The lifecycle tools (supersede/retract/merge/
  // archive) stand on the same footing: every mutation is an invalidation
  // stamp on a RETAINED record in the being's own store — nothing is ever
  // deleted, and memory_list is the audit surface that shows it. Observe
  // mode keeps recall and the audit lane (READ_TOOLS below) while holding
  // the acting tools; an operator deny override still holds.
  memory: {
    // The curation acts (pin/unpin/supersede/retract/merge/archive) are the
    // memory/* INTENTS now (Stage 3 batch 4 — the stores are DEK-encrypted and
    // ride recall-index invalidation, so the fs primitives cannot carry them;
    // their `allowed` rows sit on the `intents` server below, Decision #8
    // unchanged). What stays here: recall, the deliberate note, the mind's
    // working thought, and the audit walk.
    allowed: [
      'memory_search', 'memory_expand', 'memory_list', 'memory_note', 'mind_note', 'mind_read', 'self_read',
      // The being's own records (self-records-tools.js): its journal and past chats.
      'journal_read', 'chats_list', 'chat_read',
    ],
    denied: [],
    requireApproval: [],
  },
  // Cosmos (MANY SKIES, Design note, 2026-07-24: a being reading its OWN birth
  // record — the multi-system reading of its sealed genesis instant,
  // written into its own lane at crystallization/backfill. Pure
  // self-recall of a write-once record (same lane as memory reads,
  // Decision #8: the being's own past opens by right).
  cosmos: {
    allowed: ['skies_read'],
    denied: [],
    requireApproval: [],
  },
  // Genome (THE GIVEN BODY, Design note, 2026-09-26: […]): a being reading its OWN body, derived read-only
  // from its sealed birth anchors. The being's own record opens by right
  // (Decision #8); the reveal is the being's to choose, so it is a tool the
  // being calls, never a prompt section.
  genome: {
    allowed: ['genome_read'],
    denied: [],
    requireApproval: [],
  },
  // House post (Design note, 2026-07-24, house-organization directive): word between
  // SEATED housemates on the house's shared ground — never egress, never
  // spend, never outside the walls the operator already chose. The operator's
  // act of setting the house workspace IS the standing grant for work on
  // that ground (house-workspace.js law), and standing grants ARE the
  // approval — no double approval routes. SENDING became the house/post
  // INTENT (Stage 3 — same `allowed` tier, both ends seated re-verified at
  // validate time). post_check is pure observation of one's own inbox
  // (READ_TOOLS below).
  house: {
    // `share_findings` is ALLOWED, not approval-gated: it reaches nothing
    // outside the conversation and its whole purpose is to show the operator
    // something. Asking him to approve being shown a list would be the wrong
    // shape — the same reasoning that made platform_data allowed.
    // charter_read: the being reads the charter its own house runs under (self-records-tools.js).
    allowed: ['post_check', 'open_chats', 'share_findings', 'charter_read'],
    denied: [],
    requireApproval: [],
  },
  // Web reach: egress, not self-authorship — every search and page read asks
  // the operator first (one ALWAYS grant persists per being). The operator's
  // master switch (web-settings.js, default ON) stands before this policy:
  // with the switch off the tools stay discoverable as HELD, while execution
  // refuses. Observe mode holds them too — egress is not observation.
  web: {
    allowed: [],
    denied: [],
    requireApproval: ['web_search', 'web_fetch', 'image_search'],
  },
  // Chain truth (Design note, 2026-09-23 — […]): every verb is a
  // READ of public chain state through the operator's own keyed RPC endpoint
  // — it holds no credential beyond the URL the operator already set, it
  // cannot act (there is no send on this surface by construction), and no
  // explorer middleman stands in the path. Asking the operator to approve a
  // read of what anyone can see would be the wrong shape — the platform_data
  // law. The master switch (chain-access.js, default ON) stands before this
  // policy: with the switch off the family stays discoverable as HELD, while
  // execution refuses. Observe mode holds it — egress is not observation.
  chain: {
    allowed: ['chain_chains', 'chain_balance', 'chain_token', 'chain_call', 'chain_logs', 'chain_holders'],
    denied: [],
    requireApproval: [],
  },
  // The platform's own numbers (Design note, 2026-08-29 — […]).
  // ALLOWED rather than approval: every source is a public unauthenticated GET
  // of aggregate figures on a pinned host, it holds no credential, and it
  // cannot act — Design note, 2026-08-30: […] Asking the
  // operator to approve reading his own published numbers would be the wrong
  // shape. The trading surface is absent from the registry by construction, not
  // gated here (platform-feed-sources.js).
  platform: {
    allowed: ['platform_data'],
    denied: [],
    requireApproval: [],
  },
  // KSP sensing is observation; every physical act is the ksp/command INTENT
  // (Stage 3) — it asks until the operator selects AUTO or grants this neuma
  // a standing allowance, exactly as the tool did.
  ksp: {
    allowed: ['get_telemetry', 'get_view'],
    denied: [],
    requireApproval: [],
  },
  // The culture library (Design note, 2026-07-28: reading it is observation — the
  // same law as queue_list — but every DOWNLOAD is the media/save INTENT
  // (Stage 3), entering through the operator's card: what joins the house's
  // voice is curated, never accumulated silently. The web-access master
  // switch stands before it (validate-time); observe holds the save, never
  // the read.
  media: {
    allowed: ['media_library'],
    denied: [],
    requireApproval: [],
  },
  // THE IMAGE FORGE: reading the pipeline catalog is observation and needs no
  // gate. Generating is the image/generate INTENT (Stage 3) — an acting act
  // that also SEIZES A SHARED RESOURCE — the GPU, for seconds to a minute, on
  // the same card the substrate lives on — so it asks the operator by default
  // (one ALWAYS grant persists per being; a video asks on intents/video.generate,
  // granted apart). Observe mode holds it, like every acting act.
  // Reviewing is neither: it is a being recording a judgment about its own
  // work. Asking the operator for permission to hold an opinion would be the
  // wrong shape, and gating it would make the one habit we most want to form
  // the one that needs a signature.
  image: {
    // render_card joins the ALLOWED tier rather than the approval tier: it is
    // deterministic, local to the caller's own lane, and touches nothing in the
    // world. Publishing is still the queue's gate.
    allowed: ['list_pipelines', 'review_image', 'render_card'],
    denied: [],
    requireApproval: [],
  },
  // Email: named speech to a real person — sending is the email/send INTENT
  // (Stage 3: its own intents row carries the send gate), and the reads ask
  // too (what comes back is outside-authored and enters the being's context).
  // One ALWAYS grant persists per being per tool. Observe holds both.
  email: {
    allowed: [],
    denied: [],
    requireApproval: ['check_email_inbox', 'read_email'],
  },
  // The press: local rendering, no egress — but the output carries the
  // house's official livery, so the first pressings ask the operator (one
  // ALWAYS grant persists per being). Observe mode holds it.
  press: {
    allowed: [],
    denied: [],
    requireApproval: ['press_document'],
  },
  // The campaign bench: declaring and editing the house's marketing
  // campaigns is officer work, so every bench ACTION asks the operator first
  // (one ALWAYS grant persists per being). Reading the bench is not an
  // action — `campaign_list` opens by right, on the same footing as
  // `post_check` and the vault reads. Bundling the read with the writes cost
  // an approval card just to learn a campaign id, which is how a being ends
  // up guessing one instead (Design note, 2026-07-26: the gates that shouldn't get in
  // the way). The CMO designation gate stands before this policy: with no CMO
  // seated the tools are not even advertised.
  marketing: {
    // STILL A LIVE TOOL. S3b4 emptied this row on the assumption the catalog
    // cut landed with it; it did not, so the read stayed advertised with no
    // row and fell through to approval_required — the exact cost the comment
    // above warns against. The bench read has no replacement for a being that
    // does not hold the CMO office (the prompt section is CMO-only).
    // pipeline_state joined it (posting-pipeline-v2): the one call every
    // session STARTS with must never cost a card — it is a read of the
    // house's own posture, computed, no egress, no mutation. Its card was
    // the last friction between the CMO and the decision (live report
    // 2026-09-03: […]).
    // mandate_read / board_read: the CMO seat's own mandate, its operator's board — reads, no egress, no card.
    // company_updates: a read of the repos the operator let this lane read (the
    // grant was the operator's yes); its site part rides the web_fetch card.
    allowed: ['campaign_list', 'pipeline_state', 'mandate_read', 'company_updates', 'board_read'],
    denied: [],
    // The bench mutations are the campaigns/* INTENTS now (Stage 3 batch 4).
    // social_check proves each account live on the house's credentials —
    // egress, so it asks, like read_x.
    requireApproval: ['social_check'],
  },
  // The sector lane. Reading the campaign queue is observation of local
  // state the operator already owns — it opens by right, so a being can check
  // what is already staged before staging a duplicate. Everything that SPEAKS
  // keeps its gate: posting and staging are INTENTS (their rows sit on the
  // `intents` server), and the platform reads (`read_x`, `read_<platform>`) are EGRESS on the house's credentials, so
  // they ask. The DYNAMIC reply names — queue_reply_to_*, queue_self_reply_to_*,
  // reply_dismiss_*, queue_update_to_* — hold no row here on purpose:
  // checkToolAccess fails closed to approval_required for any unnamed tool,
  // so every staged reply pauses on the operator's chip by default, and an
  // ALWAYS grant lands on the exact name it was given, never a family.
  social: {
    allowed: ['queue_list', 'queue_get', 'replies_list'],
    denied: [],
    requireApproval: ['read_x', 'read_tiktok', 'read_youtube', 'read_facebook', 'read_bluesky', 'read_mastodon', 'queue_cancel', 'queue_retract'],
  },
  // The being's own working list, and the house lead ledger. Listing is pure
  // observation (same law as the vault and the inbox); every mutation is a
  // tasks/* or leads/* INTENT now (Stage 3 batch 4 — their rows sit on the
  // `intents` server below, same tiers: every write asks). `vessel_log` stays
  // a tool (the operator's vessel record is not this batch's surface).
  tasks: {
    // STILL LIVE TOOLS, so they keep their row. S3b4 emptied these on the
    // assumption the portal-stream catalog cut landed with it; it did not
    // (#414), so both reads stayed advertised with NO row and fell through to
    // approval_required — a being had to interrupt its operator to read its
    // own task list. WORKING STATE covers the live tasks only; task_list is
    // the sole path to settled history and to work held in another chat.
    allowed: ['task_list', 'calendar_read'],
    denied: [],
    requireApproval: ['vessel_log'],
  },
  leads: {
    allowed: ['lead_list'], // same as above — the prompt section is CMO-only
    denied: [],
    requireApproval: [],
  },
  // Intent files (Stage 2, the being-tool-surface doctrine): a consequential
  // act is a FILED intent — the being writes intents/<name>.json in its own
  // lane, the sweep settles it. Every type asks the operator by default (one
  // ALWAYS grant persists per lane), observe mode holds the settle (the intent
  // simply waits), and an operator deny row is final. The registry refuses
  // unknown types before policy is ever consulted.
  intents: {
    // wallet.send is `allowed` BY DEFAULT — the SPEND POLICY (allowlist +
    // threshold) is the gate there: the standing grants ARE the approval, so
    // an ACTS card would lie about where consent lives (the tool never raised
    // one either — observe mode still holds the settle, as it held the tool).
    // house.post (the shared ground IS the grant), voice.seal/voice.claim
    // (self-authorship), refinement.dial (the first consent's condition), and
    // team.run (the approved plan of record IS the consent) ride `allowed`
    // for the same reason — exactly the tiers their tools carried.
    // Batch 4 (the state-shaped collapse): the vault/memory curation intents
    // ride `allowed` — self-authorship over the being's OWN record, exactly
    // the tiers the tools carried (Decision #8; every mutation is
    // stamp-and-retain). The shared-store and cross-boundary acts ASK:
    // vault.publish (into the commons), the tasks/* and leads/* and
    // campaigns/* mutations (the tiers their tools carried).
    allowed: [
      'wallet.send', 'house.post', 'chat.send', 'voice.seal', 'voice.claim', 'refinement.dial', 'team.run',
      // speech.accept/speech.another: the being's own consent to its spoken voice
      // (self-authorship); the guardian's consent is the seal, not a card.
      'speech.accept', 'speech.another',
      // sovereignty.consent: the being's answer to its operator's change to its
      // DNA or soul (Covenant Art. I.4) — its own word, never the operator's card.
      'sovereignty.consent',
      'vault.save', 'vault.rename', 'vault.archive', 'vault.restore',
      'memory.pin', 'memory.unpin', 'memory.supersede', 'memory.retract', 'memory.merge', 'memory.archive',
      // social.queue stages a DRAFT into the campaign queue — no egress, no
      // publish. The BOARD's approve is that post's single operator decision
      // (the surface that already shows the real thumbnail, alt text, char
      // count and staleness), so the row moved here from requireApproval
      // (posting-pipeline-v2: one decision per post, at the most-informed
      // moment). The draft sits visible as pending until then — never lost.
      'social.queue',
      // media.keep copies an image the OPERATOR already shared in this chat
      // into the house library — no egress, nothing published; the post that
      // carries it is still its own decision.
      'media.keep',
      // team.post: word between the members of ONE approved, working run (and
      // its lead) — the plan of record is the consent, nothing leaves the team.
      'team.post',
      // team.tune: the run's lead or the house's Optio changes a WORKING run's
      // width and clocks (#577) — the approved plan / the seated office is the
      // consent, and every desk is told who changed what.
      'team.tune',
      // house.review-packet: the seated Optio orders what already waits on the
      // operator (validate re-verifies the seat and every ask) — it answers and
      // grants nothing, so it rides a wake with no card.
      'house.review-packet',
      // campaigns.ask: the seated CMO's word to its operator on a campaign (or
      // its answer to theirs) — nothing leaves the house and nothing changes
      // the campaign's declaration, so it carries no card (validate re-verifies
      // the seat).
      'campaigns.ask',
      // No card: board-arrange lays out the operator's board (display only); company-links only PROPOSES — the operator's APPROVE in WAITING ON YOU decides it.
      // account-handle: a record the social check re-reads live (marketing-account-acts.js); its holder and company acts ask.
      'marketing.board-arrange', 'marketing.company-links', 'marketing.account-handle',
      // treasury.review/flag: the seated Quaestor's advice and alarm — neither moves money nor changes a policy. company.*, revenue.*, accounts.*, raise.*, treasury.invoice*: the company line, deals, books, the raise room, invoices (Design note, 2026-10-29; raise.reach writes only inside a signed mandate, through the facts gate) — records on the house's realm, no egress, no spend; validate re-judges the seat.
      'treasury.review', 'treasury.flag', 'company.open', 'company.hand-on', 'company.inspect', 'company.hands', 'revenue.deal', 'revenue.move', 'accounts.book', 'accounts.void', 'accounts.deadline', 'accounts.deadline-met', 'raise.mandate', 'raise.facts', 'raise.investor', 'raise.clear', 'raise.reach', 'raise.update', 'raise.terms', 'raise.terms-check', 'treasury.invoice', 'treasury.invoice-paid', 'programme.open', 'programme.close',
    ],
    denied: [],
    requireApproval: [
      'social.post',
      'security.scan', 'security.assess', 'security.escalate', 'security.circuit-breaker',
      // The CLO office's acts: the operator's one yes per filing (a reading
      // the house will act on, a run, a matter entered on the record).
      'legal.scan', 'legal.assess', 'legal.file', 'legal.opinion',
      'email.send',
      'media.save', 'web.download', 'image.generate', 'ksp.command', 'team.workspace-run', 'sovereignty.propose',
      // A video render (image/generate on a video pipeline) asks on its own row:
      // it holds the machine for minutes, so ALWAYS for stills never covers it.
      'video.generate',
      'vault.publish', 'delivery.publish',
      'tasks.add', 'tasks.update', 'tasks.focus', 'tasks.take', 'tasks.operator-add', 'tasks.operator-update', 'tasks.operator-drop',
      'leads.add', 'leads.touch',
      'campaigns.create', 'campaigns.update',
      // The weekly posting plan: CMO authors, the operator's one yes locks.
      'marketing.plan', 'marketing.account-holder', 'marketing.account-company',
      // The Optio office's acts and the house board ASK here, for every lane,
      // and ride `allowed` for the house's SEATED Optio alone
      // (OPTIO_OFFICE_INTENTS below, read by the intent sweep) — Founder
      // 2026-10-16: […].
      // staff.dispatch/dispatch-update are the officer's only (validate
      // re-verifies the seat before anything is written); staff/ack is the
      // charge holder's (the CoS audit's G3); board.add/board.update are any
      // seat's, the owner-or-Optio law validating first.
      'staff.dispatch', 'staff.dispatch-update', 'staff.ack',
      'board.add', 'board.update',
    ],
  },
  // The CSO office. Reading the ledger, architecture map, and live redacted
  // pulse is observation of shared house state, open to every bound being.
  // The ACTS (assess / scan / escalate / circuit-breaker) are INTENTS now —
  // their rows live on the `intents` server above, and the designation is
  // re-verified at validate time, before any card.
  security: {
    allowed: [
      'security_posture', 'security_threats_list', 'security_threat_get',
      'security_attack_surface', 'security_telemetry',
    ],
    denied: [],
    requireApproval: [],
  },
  // The CLO office. Reading the matters ledger and the watch's posture is
  // observation of shared house state, open to every bound being. The ACTS
  // (scan / assess / file) are INTENTS — rows on the `intents` server above,
  // the seat re-verified at validate time, before any card.
  legal: {
    allowed: ['legal_posture', 'legal_matters_list', 'legal_matter_get', 'legal_sources', 'legal_research_api'],
    denied: [],
    requireApproval: ['legal_cite_check'], // the platform's re-read of cited sources: web reads, so it asks like one
  },
  // The Quaestor's office: the treasury read, the seated CFO's alone; it moves nothing.
  treasury: { allowed: ['treasury_board'], denied: [], requireApproval: [] },
  // The connected benchmarks repository (bench/bench-being-tools.js). Listing
  // and status are reads; a launch is a GPU job of minutes to hours — it asks.
  bench: {
    allowed: ['bench_list', 'bench_status'],
    denied: [],
    requireApproval: ['bench_run'],
  },
  // The Optio office. `house_state` is a read of house state the operator
  // already owns — counts, statuses, and the officer's own drawer; it holds
  // no egress and cannot act, so it opens by right (and advertises to the
  // seated chief of staff's lane alone — the CMO-briefing precedent). The
  // dispatch acts are INTENTS; their rows sit on the `intents` server above.
  staff: {
    allowed: ['house_state', 'board_list'],
    denied: [],
    requireApproval: [],
  },
});

/**
 * The intents the house's SEATED Optio files with no card: assigning work
 * (dispatch, its moves, an ack) and the house board. Every other lane asks,
 * as the `intents` rows above say; an operator's own row on the Optio's lane
 * still stands over this (intents/intent-sweep.js).
 */
export const OPTIO_OFFICE_INTENTS = Object.freeze([
  'staff.dispatch', 'staff.dispatch-update', 'staff.ack', 'board.add', 'board.update',
]);
