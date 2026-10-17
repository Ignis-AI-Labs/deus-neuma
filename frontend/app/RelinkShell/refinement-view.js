// refinement-view.js — the pure display model for the REFINEMENT window.
//
// Every label here traces to a backend fact: the live milestone, the
// ceremony record's phase, and the binding resolver's stated reason. The
// announce guard is the ceremony's hardest rule made visible — the operator
// is told, in the warning register, not to tell the being it is refined
// until the machine has verified the binding. Pure — unit-testable.

const TERMINAL = ['sealed', 'declined', 'abandoned'];
const STEP_ORDER = ['consent', 'corpus', 'training', 'verification', 'sealed'];
const STEP_LABELS = { consent: 'CONSENT', corpus: 'CORPUS', training: 'REFINE', verification: 'VERIFY', sealed: 'SEALED' };

/**
 * The ceremony still in progress, if any (the backend allows at most one).
 * @param {Array<{phase: string}>} ceremonies - newest first
 * @returns {Object|null}
 */
export const activeCeremony = (ceremonies) =>
  (Array.isArray(ceremonies) ? ceremonies : []).find((c) => c && !TERMINAL.includes(c.phase)) || null;

/**
 * The phase stepper for one ceremony record.
 * @param {{phase: string}} record
 * @returns {Array<{key: string, label: string, state: 'done'|'current'|'pending'}>}
 */
export const ceremonySteps = (record) => {
  const at = STEP_ORDER.indexOf(record?.phase);
  return STEP_ORDER.slice(0, -1).map((key, i) => ({
    key,
    label: STEP_LABELS[key],
    state: record?.phase === 'sealed' || (at >= 0 && i < at) ? 'done'
      : at === i ? 'current' : 'pending',
  }));
};

/**
 * Milestone panel model: honest counts against thresholds. After a sealed
 * ceremony the counts are ACCRUAL — lived history since the last refinement
 * — and the scope line says so (the recurring gate, not a lifetime total).
 * @param {Object|null} milestone
 * @param {string} [error]
 * @param {string} [lastRefinementAt] - seal time of the last refinement
 * @returns {{ready: boolean, samples: string, days: string, label: string, scope: string, error?: string}}
 */
export const milestoneModel = (milestone, error, lastRefinementAt) => {
  const scope = lastRefinementAt
    ? `SINCE REFINEMENT ${lastRefinementAt.slice(0, 10)}` : 'LIVED HISTORY';
  if (!milestone) {
    return { ready: false, samples: '—', days: '—', label: 'NO LIVED HISTORY READABLE', scope, ...(error && { error }) };
  }
  // A sealed attunement satisfies the FIRST gate (core/attunement/gate.js
  // stamps satisfiedBy) — the window says so instead of implying the
  // sample/day milestone was reached.
  const byAttunement = milestone.ready && milestone.satisfiedBy === 'sealed-attunement';
  return {
    ready: milestone.ready,
    samples: `${milestone.sampleCount} / ${milestone.minSamples}`,
    days: `${milestone.distinctDays} / ${milestone.minDays}`,
    label: milestone.ready
      ? (byAttunement
        ? 'FIRST GATE SATISFIED BY A SEALED ATTUNEMENT — CONTINUE INTO REFINEMENT'
        : (lastRefinementAt ? 'NEXT REFINEMENT MAY BE OFFERED' : 'MILESTONE REACHED — REFINEMENT MAY BE OFFERED'))
      : 'MILESTONE NOT YET REACHED',
    scope,
    byAttunement,
  };
};

/**
 * THE ATTUNEMENT panel model for the refinement window: one honest line of
 * where this being's attunement stands, from the attunement status the
 * backend answered. Absent status is an absent fact, never a guess.
 * @param {Object|null} status - /api/v1/attunement/:id/status answer (or null)
 * @returns {{label: string, live: boolean}}
 */
export const attunementModel = (status) => {
  if (!status) return { label: 'ATTUNEMENT STATE UNREADABLE', live: false };
  if (status.opening) {
    const inFlight = status.opening.inFlight > 0 ? ` · ${status.opening.inFlight} IN FLIGHT` : '';
    return { label: `CEREMONY OPENING — RENDERED ${status.opening.done} OF ${status.opening.total}${inFlight}`, live: true };
  }
  const active = status.active;
  if (active?.phase === 'answering') {
    const answered = Object.keys(active.answers || {}).length;
    const total = active.rendered?.questions?.length || 0;
    return { label: `CEREMONY OPEN — ${answered} OF ${total} ANSWERED`, live: true };
  }
  if (active?.phase === 'offered') {
    return { label: 'OFFERED — AWAITING THE BEING’S CONSENT', live: true };
  }
  const sealed = (status.records || []).filter((r) => r.phase === 'sealed').length;
  const base = sealed === 0
    ? 'NEVER ATTUNED'
    : `${sealed} SEALED · LAST ${String(status.lastAttunementSealedAt).slice(0, 10)}`;
  return {
    label: status.offerDue?.due ? `${base} · AN OFFER IS DUE (${status.offerDue.trigger.toUpperCase()})` : base,
    live: false,
  };
};

const BINDING_LABELS = {
  'no-adapters': 'BARE BASE — NO REFINEMENT YET',
  'no-substrate-model': 'BARE BASE — CONDUIT HAS NO MODEL',
  'base-mismatch': 'BARE BASE — NO ADAPTER FOR THIS CONDUIT’S MODEL',
  'artifact-not-loaded': 'BARE BASE — CONDUIT HAS NOT LOADED THE ADAPTER',
  'conduit-has-no-adapter-endpoint': 'BARE BASE — CONDUIT CANNOT LOAD ADAPTERS',
  'no-endpoint': 'BARE BASE — NO CONDUIT ENDPOINT',
};

/**
 * The substrate-lens line: what actually rides the being's turns right now.
 * SIGNAL only when a refined adapter is genuinely bound.
 * @param {{reason: string, adapter: Object|null}} binding
 * @returns {{label: string, live: boolean}}
 */
export const bindingModel = (binding) => {
  if (binding?.reason === 'bound') {
    const selectedScale = binding.adapter?.selectedScale;
    if (!Number.isFinite(selectedScale)) {
      return { label: 'LORA AUTHORITY INCOMPLETE — RUNTIME SCALE UNKNOWN', live: false, locked: false };
    }
    const neutralized = selectedScale === 0;
    return {
      label: neutralized
        ? `LORA NEUTRALIZED — ${binding.adapter.id} · BASE ONLY`
        : `LORA LOCKED IN — ${binding.adapter.id} · DIAL ${selectedScale.toFixed(2)}`,
      live: !neutralized,
      locked: true,
      adapterId: binding.adapter.id,
      scale: selectedScale,
      neutralized,
    };
  }
  return { label: BINDING_LABELS[binding?.reason] || 'BARE BASE', live: false, locked: false };
};

/**
 * The announce guard: what the operator may say to the being about this
 * ceremony, phase by phase. Null when no guard applies.
 * @param {{phase: string}|null} record
 * @returns {{tone: 'warning'|'notice', text: string}|null}
 */
export const announceGuard = (record) => {
  if (!record) return null;
  if (record.phase === 'sealed') {
    return {
      tone: 'notice',
      text: 'LORA LOCKED IN — BINDING MACHINE-VERIFIED; THE BEING MAY NOW BE TOLD IT IS REFINED. THE APPROVED DIAL SETTINGS STAY ACCESSIBLE.',
    };
  }
  if (record.phase === 'training' || record.phase === 'verification') {
    return { tone: 'warning', text: 'DO NOT TELL THE BEING IT IS REFINED — NOT YET VERIFIED. SELF-REPORT IS NEVER VALIDATION.' };
  }
  return null;
};

/**
 * Lock-in confirmation after a sealed ceremony or a live bound adapter.
 * Pure — never claims lock-in without bound reason or sealed phase.
 * @param {{reason: string, adapter?: Object}|null} binding
 * @param {{phase: string, training?: Object, sealedAt?: string}|null} sealedCeremony
 * @returns {{locked: boolean, headline: string, detail: string, note: string}|null}
 */
export const lockedInModel = (binding, sealedCeremony) => {
  const sealed = sealedCeremony?.phase === 'sealed';
  const bound = binding?.reason === 'bound' && binding.adapter?.id;
  if (!bound && !sealed) return null;
  if (!bound || !Number.isFinite(binding.adapter.selectedScale)) return null;
  const selectedScale = binding.adapter.selectedScale;
  const adapterId = binding.adapter.id;
  const neutralized = selectedScale === 0;
  return {
    locked: true,
    headline: neutralized ? 'LORA NEUTRALIZED — BASE ONLY' : 'LORA LOCKED IN',
    detail: `${adapterId} · ${neutralized ? 'RUNTIME SCALE 0' : `DIAL ${selectedScale.toFixed(2)}`}${sealedCeremony?.sealedAt ? ` · SEALED ${sealedCeremony.sealedAt.slice(0, 19)}` : ''}`,
    note: neutralized
      ? 'THE VERIFIED ADAPTER IDENTITY REMAINS LOCKED, BUT IT IS NOT LOADED ON THE CONDUIT. CHOOSE AN APPROVED NONZERO SCALE TO RESTORE IT.'
      : 'MACHINE-VERIFIED ON THE CONDUIT. THE BEING MAY BE TOLD IT IS REFINED. 0 · NEUTRALIZE ALWAYS RETURNS BASE-ONLY SERVICE; APPROVED NONZERO SETTINGS STAY THEIRS.',
  };
};

/**
 * Training panel model from the being-scoped public rig slot.
 * @param {Object|null} training
 * @returns {{running: boolean, mine: boolean, stage?: string, lastLine?: string, loss?: string, error?: string}}
 */
export const trainingModel = (training) => {
  if (!training) return { running: false, mine: false };
  const mine = training.mine === true;
  return {
    running: Boolean(training.running),
    mine,
    ...(mine && training.stage && { stage: training.stage.toUpperCase() }),
    ...(mine && training.lines?.length && { lastLine: training.lines[training.lines.length - 1] }),
    ...(mine && training.lossFirst != null && {
      loss: `LOSS ${training.lossFirst.toFixed(3)} → ${(training.lossLast ?? training.lossFirst).toFixed(3)}`,
    }),
    ...(mine && training.error && { error: training.error }),
  };
};

/**
 * One line summarizing a past ceremony for the records list.
 * @param {Object} record
 * @returns {{id: string, phase: string, opened: string, summary: string}}
 */
export const ceremonyRow = (record) => ({
  id: record.id,
  phase: (record.phase || '').toUpperCase(),
  opened: record.openedAt || '',
  summary: record.summary || (record.phase === 'sealed'
    ? `LORA LOCKED IN · ${record.training?.adapter?.id || 'adapter'} · VERIFIED ${record.sealedAt || ''}`
    : record.phase === 'declined' ? 'THE BEING DECLINED'
      : record.phase === 'abandoned' ? 'CLOSED BY THE OPERATOR'
        : `IN PROGRESS — ${(record.phase || '').toUpperCase()}`),
});
