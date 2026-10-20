/**
 * NOTIFICATION RECORD — the one shape every announcement takes, wherever it came from.
 *
 * Design note, 2026-08-05:
 *
 *   […]
 *
 * ── WHY A CONTRACT AND NOT A SHAPE PER PRODUCER ─────────────────────────────
 *
 * Five different places raise notifications — a turn ending, a task settling, a
 * render landing, the disk filling, new code arriving — and four different
 * surfaces consume them: the store, the wire, the tray, and the OS. If each
 * producer invented its own object, every consumer would grow a switch over
 * producers, and the tray would learn the internals of the image forge.
 *
 * So the shape is fixed HERE, once, and every producer fills it in.
 *
 * ── WHY IT LIVES IN core/runtime ────────────────────────────────────────────
 *
 * It is imported from BOTH sides: the backend mints records, the desk renders
 * them. `core/runtime/` is where this repo already puts cross-layer pure
 * contracts — `tabs-model.js`, `tab-budget.js`, `spend-policy.js` are all read
 * by the frontend (21 such imports today; frontend→`backend/` has zero). It also
 * ships in the packaged app (`electron-builder.yml` carries all of `core/`), which
 * a module under `frontend/utils/` would not without a hand-added allowlist line.
 *
 * ── WHY THE TEXT IS CAPPED ──────────────────────────────────────────────────
 *
 * A notification is EVENT METADATA — who, what closed, which process, when —
 * and never a copy of what a being said. Two reasons, and only one is cosmetic.
 *
 * The platform stores registry data; a being's speech belongs to its sovereign
 * workspace, under its own key, inside its own deletion and backup semantics.
 * Copying that speech into an operator-level log would give it a second home
 * outside all of it.
 *
 * And these records reach a surface NEUMA does not own: an OS notification
 * daemon persists, and on some systems syncs to another device. Whatever is in
 * `title` may end up in journald or an Action Center forever. A hard cap keeps
 * the blast radius to a label.
 *
 * ── WHY standing IS ON THE RECORD, NOT DERIVED ──────────────────────────────
 *
 * A neuma is a housemate; a witness is a sealed third-party model standing
 * BESIDE the house. The desk keeps that split everywhere, and a tray that
 * rendered both as "beings" would erase it on the most visible new surface in
 * the app. Deriving it at render time means a v1 record can never be classified
 * once the derivation rule moves — so it is stamped at mint, permanently.
 *
 * Pure. No `fs`, no `crypto`, no clock — the caller passes `id` and `ts`, which
 * is also what makes every function here testable with no mock at all.
 */

/**
 * Record schema version, stamped on every record from the first line ever
 * written.
 *
 * The store is append-only on the operator's own disk, so a record outlives any
 * revert of the code that wrote it. Without a version, a future shape change
 * would have to guess at what it was reading; with one, an unknown `v` is simply
 * skipped. This is the cheapest possible insurance and it only works if it is
 * there from record one.
 */
export const NOTIFICATION_V = 1;

/** How long a human-facing string may be. See […] above. */
export const TEXT_MAX = 140;

/**
 * Who the announcement is about.
 *
 *   neuma    a housemate on this machine's substrate
 *   witness  a sealed third-party model standing beside the house
 *   system   the machine itself — no being behind it
 */
export const STANDING = Object.freeze({
  neuma: 'neuma',
  witness: 'witness',
  system: 'system',
});

/**
 * Every kind of thing the desk will announce.
 *
 * Deliberately closed: an unknown kind is a validation failure, not a card with
 * a blank icon. A producer adding a kind must come here first, which is the
 * point — this list is the inventory of what the desk claims it can tell you.
 */
export const KIND = Object.freeze({
  // A being finished, was interrupted, or refused. THREE kinds and not one,
  // because the wire cannot tell them apart: the refusal paths emit the same
  // completion frame as a success, carrying no session. A tray that rendered
  // all three as "finished" would tell the operator a being completed work it
  // had in fact declined.
  turnDone: 'turn_done',
  turnInterrupted: 'turn_interrupted',
  turnRefused: 'turn_refused',

  // Work closed against the ledger. An assignment is the operator's own standing
  // item; a task is the being's copy of it. Both close, and the operator cares
  // about the assignment.
  taskClosed: 'task_closed',
  assignmentClosed: 'assignment_closed',

  // Longer-running work that finishes while the operator is elsewhere — the
  // case that motivated all of this.
  runDone: 'run_done',
  renderDone: 'render_done',

  // A WORKING team run's eye (#577 — team-watch.js): a check-in on a long or
  // endless run, and an alert the moment a clock acts or a member gives up.
  // The run is still working; these say how it stands, not that it ended.
  runCheckIn: 'run_check_in',
  runAlert: 'run_alert',

  // The machine's own state. No being behind these; `standing` is `system`.
  //
  // A "portal severed" kind deliberately does NOT exist. Connection state
  // already has exactly one working surface — the status badge that
  // WebSocketService writes — and adding a second would be the duplicate
  // surface RULE 1 forbids, on the most load-bearing file in the frontend.
  // When connection state does move to the tray, it moves; it is not mirrored.
  storageWarning: 'storage_warning',

  // The standing security watch found NEW critical/high threats. System
  // standing — the machine watching itself; the CSO's office works the
  // ledger, but the operator must HEAR about a fresh critical without
  // having to open the panel (ruling, 2026-08-10).
  securityAlert: 'security_alert',

  // The standing legal watch found NEW serious matters (critical/high): a
  // licence that may bar shipping, a missing paper a user is owed. System
  // standing — the Praetor's office reads the ledger, but the operator must
  // HEAR about it without opening the window (ruling, 2026-10-01).
  legalAlert: 'legal_alert',

  // The bench watch saw the harness stuck or about to lose work: a night
  // window stalled on a dead endpoint, a deadline closing on unstarted
  // groups, or a serving incident (a failed relight, a down row). System
  // standing — the watch sees and says; it never kills or relights.
  benchAlert: 'bench_alert',
  // A benchmark set this desk ran — launched from the BENCH window or from a
  // chat — settled: done, stopped or failed (Design note, 2026-10-15: watching a run
  // includes hearing it end). System standing; the arms' outcomes ride the detail.
  benchDone: 'bench_done',

  // New code is on disk and this window is running the old build. An offer,
  // never an action.
  codeReload: 'code_reload',

  // A being's meditation settled a synthesis while no one watched. One card
  // per synthesis (the bus coalesces a multi-being night); REST and
  // deferrals never notify — silence is not an event.
  meditationSynthesis: 'meditation_synthesis',

  // A being proposed a change to itself through the sovereignty gateway —
  // the card asks for a ruling; the decision itself carries no clock.
  sovereigntyProposal: 'sovereignty_proposal',
  // A being answered its operator's change to its DNA or soul (Covenant Art.
  // I.4): consented, and whether it landed, or declined. Its words ride the detail.
  operatorChangeAnswered: 'operator_change_answered',

  // A queued post FAILED at send time (the CoS audit's G2: a July failure
  // sat orphaned for a month because nothing poked anyone). System standing —
  // the machine's own state; the honest reason rides the detail.
  postFailed: 'post_failed',

  // THE HOUSE TRAIL (ruling, 2026-09-15): the operator watches dispatches move.
  // A dispatch filed by the office is one card; the seat's ack is its answer.
  // Neuma standing — a being is the actor; the operator is the reader.
  houseDispatch: 'house_dispatch',
  houseAck: 'house_ack',

  // A HOUSE WAKE (house-clock/, Design note, 2026-10-16 refused an act or sent a plan
  // back to the operator: no one was at the desk, so it was filed for them.
  // Neuma standing — the woken seat is the actor; the card opens its sitting.
  houseWake: 'house_wake',

  // A being put a decision before its operator and its turn is PARKED on the
  // answer — an ask_operator card or a plan_submit verdict, neither carrying
  // a clock (ruling, 2026-07-27). The in-stream card cannot reach an operator in
  // another window; this can. Producers phrase the title as an EVENT
  // ("asked for…") so a card read after the answer landed never lies.
  awaitingAnswer: 'awaiting_answer',
});

const KINDS = Object.freeze(Object.values(KIND));
const STANDINGS = Object.freeze(Object.values(STANDING));

/**
 * Ids are opaque to this module but not arbitrary: they cross a WebSocket
 * boundary and are echoed back by the client to mark a record read, so they are
 * validated on the way in as untrusted input. Restricting the charset means a
 * returned id can never be a path fragment, a shell token, or a control
 * sequence.
 */
export const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** Pure — is this a well-formed record id? */
export const isValidId = (id) => typeof id === 'string' && ID_PATTERN.test(id);

/**
 * Pure — coerce anything to a single-line string of at most `TEXT_MAX`.
 *
 * Total by construction: it cannot throw on `undefined`, a number, or an object.
 * That matters more than it looks. The frame this text ends up in is built
 * inside a fan-out that runs from a heartbeat interval, where an uncaught throw
 * is not a bad card — it is the backend process dying and every desk losing its
 * portal mid-turn.
 *
 * Newlines and control characters are stripped rather than escaped: this string
 * is destined for a one-line card and, on the unfocused path, for an OS
 * notification body, where an embedded newline is a formatting exploit.
 */
export const capText = (raw) => {
  if (raw === null || raw === undefined) return '';
  const s = typeof raw === 'string' ? raw : String(raw);
  const flat = Array.from(s)
    .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length <= TEXT_MAX ? flat : `${flat.slice(0, TEXT_MAX - 1)}…`;
};

/** Pure — does this kind describe a being's work rather than the machine's state? */
export const isBeingKind = (kind) => kind === KIND.turnDone
  || kind === KIND.turnInterrupted
  || kind === KIND.turnRefused
  || kind === KIND.taskClosed
  || kind === KIND.assignmentClosed
  || kind === KIND.runDone
  || kind === KIND.runCheckIn
  || kind === KIND.runAlert
  || kind === KIND.renderDone
  || kind === KIND.awaitingAnswer
  || kind === KIND.houseDispatch
  || kind === KIND.houseAck
  || kind === KIND.houseWake
  || kind === KIND.operatorChangeAnswered
  || kind === KIND.sovereigntyProposal;

/**
 * Build a record. Pure — every varying input is passed in.
 *
 * `id` and `ts` are the caller's because this module must stay importable by the
 * desk, and a module that reaches for `crypto` or the clock at import time is
 * neither pure nor testable without stubbing the very thing under test.
 *
 * `ref` is the free-form identity of what the notification is ABOUT — a
 * sessionId and turnId for a turn, a task id and status for a settle, a jobId
 * for a render, a level for a disk warning. It is deliberately not typed per
 * kind: the routing layer reads it, the store only carries it, and pinning a
 * schema per kind here would put the tray's navigation knowledge in the
 * contract. Non-object input degrades to `{}` rather than throwing.
 *
 * @param {object} input
 * @param {string} input.id - opaque, must match ID_PATTERN
 * @param {number} input.ts - epoch ms, minted by the caller
 * @param {string} input.kind - one of KIND
 * @param {string} input.standing - one of STANDING
 * @param {string} input.title - one line, capped
 * @param {?string} [input.detail] - a second line, capped
 * @param {?{id?: string, name?: string}} [input.actor] - the being, when there is one
 * @param {object} [input.ref] - what this is about
 * @returns {Readonly<object>} a frozen record; validate it before trusting it
 */
export const makeRecord = ({ id, ts, kind, standing, title, detail = null, actor = null, ref = {} }) => Object.freeze({
  v: NOTIFICATION_V,
  id: typeof id === 'string' ? id : '',
  ts: Number.isFinite(ts) ? Math.floor(ts) : 0,
  kind: typeof kind === 'string' ? kind : '',
  standing: typeof standing === 'string' ? standing : '',
  title: capText(title),
  detail: detail === null || detail === undefined ? null : capText(detail),
  actor: actor && typeof actor === 'object'
    ? Object.freeze({
      id: typeof actor.id === 'string' ? actor.id : null,
      name: capText(actor.name) || null,
    })
    : null,
  ref: ref && typeof ref === 'object' && !Array.isArray(ref) ? Object.freeze({ ...ref }) : Object.freeze({}),
});

/**
 * Validate a record. Pure — returns every problem, not the first.
 *
 * Called at two boundaries: before a record is appended to the operator's disk,
 * and when one is read back off a line that may have been written by an older
 * build or truncated by a crash. Both callers need to know WHAT is wrong, so
 * this reports a list rather than a boolean.
 *
 * @param {*} rec
 * @returns {{ok: boolean, errors: string[]}}
 */
export const validateRecord = (rec) => {
  const errors = [];
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
    return { ok: false, errors: ['record must be an object'] };
  }
  if (rec.v !== NOTIFICATION_V) errors.push(`unknown record version ${JSON.stringify(rec.v)}`);
  if (!isValidId(rec.id)) errors.push('id must match ID_PATTERN');
  if (!Number.isFinite(rec.ts) || rec.ts <= 0) errors.push('ts must be a positive epoch-ms number');
  if (!KINDS.includes(rec.kind)) errors.push(`unknown kind ${JSON.stringify(rec.kind)}`);
  if (!STANDINGS.includes(rec.standing)) errors.push(`unknown standing ${JSON.stringify(rec.standing)}`);
  if (typeof rec.title !== 'string' || rec.title === '') errors.push('title must be a non-empty string');
  else if (rec.title.length > TEXT_MAX) errors.push(`title exceeds ${TEXT_MAX} characters`);
  if (rec.detail !== null && rec.detail !== undefined) {
    if (typeof rec.detail !== 'string') errors.push('detail must be a string or null');
    else if (rec.detail.length > TEXT_MAX) errors.push(`detail exceeds ${TEXT_MAX} characters`);
  }
  // A being-shaped kind that names no being is a card the operator cannot act
  // on — "something finished" — which is the failure mode this whole surface
  // exists to avoid. Caught here rather than discovered in the tray.
  if (isBeingKind(rec.kind)) {
    if (rec.standing === STANDING.system) errors.push(`kind ${rec.kind} cannot carry system standing`);
    if (!rec.actor || typeof rec.actor.name !== 'string' || rec.actor.name === '') {
      errors.push(`kind ${rec.kind} must name the being it is about`);
    }
  } else if (rec.standing !== STANDING.system) {
    errors.push(`kind ${rec.kind} must carry system standing`);
  }
  if (rec.ref !== undefined && (typeof rec.ref !== 'object' || rec.ref === null || Array.isArray(rec.ref))) {
    errors.push('ref must be a plain object');
  }
  return { ok: errors.length === 0, errors };
};

/**
 * Order two records for display: newest first. Pure and TOTAL.
 *
 * The tie-break on `id` is not decoration. Records minted inside the same
 * millisecond are common — a team run finishing settles several tasks at once —
 * and `Array.prototype.sort` is only stable for elements it considers equal, so
 * without a tie-break the same set can render in a different order in two desk
 * windows. The tray claims those two windows agree; this is part of how.
 *
 * Sorts unknown/corrupt records to the end rather than throwing, because the
 * reader is deliberately tolerant of a torn final line.
 */
export const compareRecords = (a, b) => {
  const at = Number.isFinite(a?.ts) ? a.ts : -Infinity;
  const bt = Number.isFinite(b?.ts) ? b.ts : -Infinity;
  if (at !== bt) return bt - at;
  const ai = typeof a?.id === 'string' ? a.id : '';
  const bi = typeof b?.id === 'string' ? b.id : '';
  if (ai === bi) return 0;
  return ai < bi ? -1 : 1;
};
