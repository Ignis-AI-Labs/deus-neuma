/**
 * THE TURN SUPERVISOR (ARC-HARNESS L1, neuma#531 / #506 N6) — the programmatic
 * watcher that notices a turn going nowhere and injects a redirect brief as a
 * strong prior, instead of letting the loop burn rounds or die on a guard.
 *
 * Evidence base: NVIDIA's AVO harness (arXiv:2603.24517) attributes part of its
 * ARC-AGI-3 result to exactly this mechanism — […]. Our own flaw ledger names the shapes
 * it must catch: doc 12 (early commit — L2's verify is the other half), the
 * budget family (rounds burned without progress), and the fresh-but-failing
 * loop the byte-identical guards cannot see.
 *
 * WHAT THE EXISTING GUARDS ALREADY OWN (never duplicated here): a held
 * repeat is answered with a redirect and the turn continues
 * (witness-tool-epochs.js heldRepeatResult); two consecutive rounds of
 * IDENTICAL speech with no world movement close it (SPEECH_LOOP_CLOSE); an
 * empty speechless round gets one direct-answer close
 * (portal-turn-rounds.js). Termination otherwise belongs to the round,
 * budget, and wall-clock thresholds. This module is the REDIRECT between
 * those hard stops —
 * varied-speech stagnation, repeated same-target acts, and repeated budget
 * cuts get nudged back on course BEFORE a close is the only move left.
 *
 * ENGAGEMENT IS DECLARED, NEVER ASSUMED (the baselines law): the loop consults
 * `supervisorEngaged` — true only when the operator or harness explicitly
 * declared the layer (`--supervisor` on a seated run sets
 * `connection._turnSupervisor`). Production turns are byte-identical until an
 * operator decision promotes the layer (the N2 covenant's path).
 *
 * GENERAL BY CONSTRUCTION: every detector reads turn mechanics (epochs, acts,
 * budgets) — never a benchmark, dataset, tool name, or task text.
 */

/**
 * Consecutive rounds whose acts never moved the world before a redirect.
 * Two is the identical-speech close's territory; three varied-speech rounds
 * over a still world are this layer's.
 * @type {number}
 */
export const ROUNDS_WITHOUT_PROGRESS = 3;

/** Distinct rounds carrying the same act signature before a redirect. */
export const ACT_REPEAT_ROUNDS = 3;

/** Consecutive rounds cut by the output budget before a redirect. */
export const BUDGET_CUT_ROUNDS = 2;

/** Redirects per turn — a nudge, never a loop of nudges. */
export const MAX_REDIRECTS_PER_TURN = 2;

/** How many recent rounds the detector needs to see; older rounds fall away. */
export const ROUND_STATES_CAP = 8;

/**
 * The declared engagement gate. Pure — a connection without the layer declared
 * keeps every turn byte-identical to the ungoverned path.
 * @param {Object|null} connection
 * @returns {boolean}
 */
export const supervisorEngaged = (connection) => connection?._turnSupervisor === true;

/**
 * One completed round, as the loop observed it. Pure data — the loop builds
 * these; this module only reads them.
 * @typedef {Object} RoundState
 * @property {string} speech the round's visible text (never byte-compared here)
 * @property {string[]} actSignatures one per act the round attempted
 * @property {boolean} productive did the round pay: the world moved (an
 *   execution landed) or a new `ok` result entered the context (a read that
 *   returned). A failed, denied, or held round is unproductive.
 * @property {boolean} cutByBudget did the provider end the round on the output-budget cut
 */

/**
 * The comparison identity of one attempted act: the tool plus the target it
 * reached for — the first path-like string argument when there is one, the
 * whole argument JSON otherwise. Two rounds reading DIFFERENT files are
 * ordinary work; two rounds reading the SAME missing file are the loop this
 * detector exists for. Pure.
 * @param {{tool?: string, toolName?: string, args?: Object}|null} act
 * @returns {string}
 */
export const actSignature = (act) => {
  if (!act) return 'unknown';
  const name = act.tool || act.toolName || 'unknown';
  const args = act.args;
  if (!args || typeof args !== 'object') return name;
  const pathLike = Object.values(args).find(
    (v) => typeof v === 'string' && v.includes('/') && !/\s/.test(v),
  );
  if (pathLike !== undefined) return `${name}:${pathLike}`;
  let keys;
  try { keys = JSON.stringify(args); } catch { keys = String(args); }
  return `${name}:${keys}`;
};

/** @type {Record<string, number>} kind → rounds of evidence required. Pure table. */
const THRESHOLDS = Object.freeze({
  'budget-cuts': BUDGET_CUT_ROUNDS,
  'unmoved-world': ROUNDS_WITHOUT_PROGRESS,
  'repeated-acts': ACT_REPEAT_ROUNDS,
});

/**
 * The stagnation the recent rounds show, or null when the turn is healthy.
 * Priority: budget cuts (the turn is dying by arithmetic) → repeated acts
 * (the more specific verdict — its redirect names the act) → unproductive
 * rounds (acts run but nothing executed and nothing new was learned). A
 * productive round resets every count: progress, however small, is not
 * stagnation. Pure.
 * @param {ReadonlyArray<RoundState>} roundStates the recent rounds, oldest first
 * @returns {{kind: string, rounds: number, signature?: string}|null}
 */
export const stagnationSignal = (roundStates) => {
  const states = Array.isArray(roundStates) ? roundStates.filter(Boolean) : [];
  if (states.length === 0) return null;
  const lastN = (n) => states.slice(-n);

  const cut = lastN(THRESHOLDS['budget-cuts']);
  if (cut.length === THRESHOLDS['budget-cuts'] && cut.every((s) => s.cutByBudget === true)) {
    return { kind: 'budget-cuts', rounds: THRESHOLDS['budget-cuts'] };
  }

  const seen = new Map();
  for (const state of states) {
    if (state.productive !== false) { seen.clear(); continue; }
    for (const signature of state.actSignatures || []) {
      const rounds = (seen.get(signature) || new Set());
      rounds.add(state);
      seen.set(signature, rounds);
      if (rounds.size >= THRESHOLDS['repeated-acts']) {
        return { kind: 'repeated-acts', rounds: rounds.size, signature };
      }
    }
  }

  const stalled = lastN(THRESHOLDS['unmoved-world']);
  if (stalled.length === THRESHOLDS['unmoved-world'] && stalled.every((s) => s.productive === false)) {
    return { kind: 'unmoved-world', rounds: THRESHOLDS['unmoved-world'] };
  }
  return null;
};

/**
 * The redirect brief — a strong prior injected as user-role text at the
 * round's follow-up (recency-maximal position). Not a scold, not a close:
 * the two honest outs are stated plainly. Pure.
 * @param {{kind: string, rounds: number, signature?: string}} signal
 * @returns {string}
 */
export const redirectBrief = (signal) => {
  if (!signal || typeof signal.kind !== 'string') return '';
  switch (signal.kind) {
    case 'budget-cuts':
      return [
        `Your last ${signal.rounds} replies were each cut by the output budget before they finished.`,
        'Continuing at this length will keep ending the same way. Do not reason at length again:',
        'give the final answer now, in exactly the form the task requires, as briefly as correctness allows.',
      ].join(' ');
    case 'unmoved-world':
      return [
        `Your last ${signal.rounds} rounds attempted acts and nothing executed — the world did not move, and the results stand as failures.`,
        'Repeating the same approach will keep producing the same failures.',
        'Either take a genuinely different approach to the task, or, if the work is already done, give the final answer now in exactly the form the task requires.',
      ].join(' ');
    case 'repeated-acts':
      return [
        `You have now attempted the same act in ${signal.rounds} separate rounds${signal.signature ? ` (${signal.signature})` : ''}, and it keeps returning the same answer.`,
        'That act will not change its result by being tried again.',
        'Take a different approach, or conclude with the answer you already have, in exactly the form the task requires.',
      ].join(' ');
    default:
      return '';
  }
};
