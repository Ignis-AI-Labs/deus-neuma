const MODES = Object.freeze({
  undercurrent: Object.freeze({
    off: 'OFF — Recent thoughts stay in the being’s own store; they are not added to conversation prompts.',
    shadow: 'SHADOW — Measure which recent thoughts would be included, without adding them to conversation prompts.',
    live: 'LIVE — Include the being’s own recent thoughts in conversation prompts, as quotations rather than instructions.',
  }),
  depthFilter: Object.freeze({
    off: 'OFF — Do not measure which memories the depth filter would select. This does not turn off memory storage.',
    shadow: 'SHADOW — Measure which memories the depth filter would select, without changing what reaches the being. A live filtering mode is not built.',
  }),
  memoryLinks: Object.freeze({
    off: 'OFF — Recalled memories reach the being as short passages, as they always have.',
    live: 'LIVE — Recalled memories reach the being as links with the key points that tied them to the message; the being opens the full memory when it needs it. Uses less context every turn.',
  }),
});

const REASONS = Object.freeze({
  'substrate-busy': 'the machine’s model engine was busy',
  'substrate-recently-active': 'the model engine was used too recently; waiting for its idle period',
  'portal-open': 'the being’s chat window was open',
  'substrate-not-lit': 'the model engine is not running — scheduled meditation never starts it',
  'substrate-not-ours': 'the model engine is not managed by this app',
  'turns-in-flight': 'a conversation was still being answered',
  'training-lease-held': 'training has reserved the model engine',
  'env-locked': 'meditation is disabled by the app’s launch settings',
});

const OUTCOMES = Object.freeze({
  synthesis: 'REFLECTION SAVED', rest: 'CHOSE TO REST', empty: 'NOTHING NEW TO REFLECT ON',
  yielded: 'PAUSED FOR OTHER WORK', unclear: 'REPLY COULD NOT BE INTERPRETED', failed: 'CYCLE FAILED',
});

/** Explain only the selected influence mode; never imply an unavailable capability. */
export const mindModeExplanation = (gate, mode) => MODES[gate]?.[mode] || 'Mode information is unavailable.';

/** Keep unknown diagnostic codes out of the primary sentence; callers retain the ID in a title. */
export const meditationReason = (reason) => REASONS[reason] || 'the cycle could not start; details are unavailable';

/** Describe the recorded result without exposing private reflection contents. */
export const meditationRunLabel = (run) => run.outcome === 'deferred'
  ? `WAITING — ${meditationReason(run.reason)}`
  : `${OUTCOMES[run.outcome] || 'RESULT UNAVAILABLE'}${run.notes ? ` · ${run.notes} NOTE${run.notes > 1 ? 'S' : ''}` : ''}`;
