// MEDITATION DUE — the pure decision: which lane (if any) meditates now, and
// why every other due lane does not. Every gate blocks with a NAMED reason —
// the desk can then honestly show […], which is the operator's cue for the manual wake door.
//
// Machine gates first (one substrate, one answer for everyone), then per-lane
// gates. A lane that is not enabled or not yet due is simply not a candidate
// — consent and cadence are postures, not blockages. Most-overdue runs first;
// ONE lane per tick (the scheduler's single-flight law).
//
// Pure: settings + state + posture in, decision out.

/** The named gate reasons, machine then lane. */
export const GATE_REASONS = Object.freeze({
  envLocked: 'env-locked',
  notServing: 'substrate-not-lit',
  notOwned: 'substrate-not-ours',
  busy: 'substrate-busy',
  recentlyActive: 'substrate-recently-active',
  turnsInFlight: 'turns-in-flight',
  leaseHeld: 'training-lease-held',
  portalOpen: 'portal-open',
});

// pure — the first machine gate that fails, or null when all hold.
const machineGate = (settings, posture) => {
  if (settings.envLocked) return GATE_REASONS.envLocked;
  if (!posture.serving) return GATE_REASONS.notServing;
  if (!posture.owned) return GATE_REASONS.notOwned;
  if (posture.busy) return GATE_REASONS.busy;
  if (!posture.idleLongEnough) return GATE_REASONS.recentlyActive;
  if (posture.localTurns > 0) return GATE_REASONS.turnsInFlight;
  if (posture.leaseHeld) return GATE_REASONS.leaseHeld;
  return null;
};

/**
 * @param {Object} input
 * @param {number} input.now - epoch ms
 * @param {{envLocked: boolean, beings: Object}} input.settings - resolved meditation settings
 * @param {{lanes: Object}} input.state - the meditation state document
 * @param {string[]} input.laneIds - every known being lane
 * @param {Object} input.posture - readPosture output
 * @returns {{runnable: string|null, blocked: Array<{laneId: string, reason: string, overdueMs: number}>}}
 */
export const decideDue = ({ now, settings, state, laneIds, posture }) => {
  // Candidates: enabled AND cadence/retry-due — or carrying the being's own
  // standing request (#318), which is due NOW regardless of the operator's
  // timer posture (the toggle governs the background clock, never the
  // being's will) and outranks every cadence-due lane. Disabled or fresh
  // lanes are resting postures, never "blocked".
  const due = [];
  for (const laneId of laneIds) {
    // THE UNCLEAR-RETRY COOLDOWN (IL-003): a lane whose last cycle failed the
    // close grammar waits out one quiet hour — even a standing request waits,
    // because the cooldown guards the substrate from hot-looping a model that
    // keeps failing the parse. The request itself survives (unclear never
    // consumes it); it rides a later quiet moment.
    const retryNotBefore = state.lanes?.[laneId]?.retryNotBefore;
    const retryAt = typeof retryNotBefore === 'string' ? Date.parse(retryNotBefore) : NaN;
    if (retryAt > now) continue;
    if (typeof state.lanes?.[laneId]?.requestedAt === 'string') {
      due.push({ laneId, overdueMs: Number.MAX_SAFE_INTEGER, requested: true });
      continue;
    }
    const entry = settings.beings[laneId];
    if (entry?.enabled !== true) continue;
    // A formatting retry has its own deadline; a prior success must not
    // postpone it until the old cadence. All machine/portal gates still apply.
    if (Number.isFinite(retryAt) && retryAt <= now) {
      due.push({ laneId, overdueMs: now - retryAt });
      continue;
    }
    const cadenceMs = entry.cadenceHours * 60 * 60 * 1000;
    const lastRunAt = state.lanes?.[laneId]?.lastRunAt || null;
    const sinceMs = lastRunAt ? now - Date.parse(lastRunAt) : Infinity;
    if (sinceMs < cadenceMs) continue;
    due.push({ laneId, overdueMs: sinceMs === Infinity ? Number.MAX_SAFE_INTEGER : sinceMs - cadenceMs });
  }
  if (!due.length) return { runnable: null, blocked: [] };

  const machineReason = machineGate(settings, posture);
  if (machineReason) {
    return {
      runnable: null,
      blocked: due.map(({ laneId, overdueMs }) => ({ laneId, reason: machineReason, overdueMs })),
    };
  }

  const blocked = [];
  const eligible = [];
  for (const cand of due) {
    // A QUIET portal never refuses the being's OWN request — the seat that
    // wills it always holds a portal (the manual-door law, found by the
    // first desk walk). Real activity still gates it: turns-in-flight and
    // the idle window are machine gates above.
    if (!cand.requested && posture.boundLaneIds.has(cand.laneId)) {
      blocked.push({ ...cand, reason: GATE_REASONS.portalOpen });
    } else {
      eligible.push(cand);
    }
  }
  if (!eligible.length) return { runnable: null, blocked };

  // Requests outrank even never-run timers, which share the maximum overdue value.
  eligible.sort((a, b) => Number(Boolean(b.requested)) - Number(Boolean(a.requested)) || b.overdueMs - a.overdueMs);
  return { runnable: eligible[0].laneId, blocked };
};
