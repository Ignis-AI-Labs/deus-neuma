// comfyui-workbench-view.js — the FR-37 card's state law, pure.
//
// The card NEVER guesses: every phase below is derived from the supervisor's
// status snapshot (the backend's /api/v1/image-forge/status), which is the
// single source of truth. `failed` is a VIEW word: the supervisor's primitive
// state stays honest (stopped + lastError); the card derives the failure face
// from that pair so a launch that died is never a hung "launching…".

/**
 * @param {object|null|undefined} status supervisor snapshot, or null while reading
 * @returns {{phase: 'reading'|'not-installed'|'ready'|'launching'|'failed'|'foreign'|'stopped',
 *   line: string, canOpen: boolean, canStop: boolean, stopWord: 'STOP'|'RELEASE'|null}}
 */
export const deriveForgeCard = (status) => {
  if (!status) {
    return { phase: 'reading', line: 'reading engine status…', canOpen: false, canStop: false, stopWord: null };
  }
  if (!status.install?.installed) {
    return {
      phase: 'not-installed',
      line: status.install?.reason || 'ComfyUI is not installed',
      canOpen: false, canStop: false, stopWord: null,
    };
  }
  if (status.state === 'ready') {
    const tenancy = status.adopted
      ? 'adopted — models freed on idle; the process is not ours to stop'
      : `supervised by NEUMA (pid ${status.pid ?? '—'})`;
    return {
      phase: 'ready',
      line: `engine ready on 127.0.0.1:${status.port} — ${tenancy}`,
      canOpen: true, canStop: true, stopWord: status.adopted ? 'RELEASE' : 'STOP',
    };
  }
  if (status.state === 'launching') {
    return {
      phase: 'launching',
      line: `launching on 127.0.0.1:${status.port}…`,
      canOpen: false, canStop: false, stopWord: null,
    };
  }
  // stopped from here down — a named lastError is the failure face (RETRY).
  if (status.lastError?.error) {
    return { phase: 'failed', line: status.lastError.error, canOpen: true, canStop: false, stopWord: null };
  }
  if (status.foreign) {
    return {
      phase: 'foreign',
      line: `something already answers port ${status.port} but is not supervised — opening will verify its launch flags first`,
      canOpen: true, canStop: false, stopWord: null,
    };
  }
  return {
    phase: 'stopped',
    line: `engine stopped — opening the workbench launches it on 127.0.0.1:${status.port}`,
    canOpen: true, canStop: false, stopWord: null,
  };
};

/** The workbench URL for a status snapshot. Pure. Loopback by construction. */
export const workbenchUrl = (status) => `http://127.0.0.1:${status?.port ?? 8190}/`;

// ── the AI activity rail ───────────────────────────────────────────────────
// ComfyUI's own canvas can never show the operator a being's render: the engine
// routes each job's execution events to the submitting client_id alone, and our
// lane holds that socket. So the rail is fed by the backend's /activity
// snapshot, and this is its display law — pure, so it is testable without one.

const PHASE_WORD = Object.freeze({
  queued: 'QUEUED',
  rendering: 'RENDERING',
  done: 'DONE',
  error: 'FAILED',
  refused: 'REFUSED',
  stopped: 'STOPPED',
});

/**
 * One activity record → its row. Pure.
 * @param {object} record a /activity entry
 * @returns {{jobId: string, phase: string, word: string, what: string, who: string,
 *   pipeline: string, percent: (number|null), detail: string,
 *   images: Array<object>, live: boolean, bad: boolean}}
 */
export const toActivityRow = (record) => {
  const phase = record?.phase || 'queued';
  return {
    jobId: record?.jobId ?? '',
    phase,
    word: PHASE_WORD[phase] || phase.toUpperCase(),
    // What the job MAKES, said beside its phase: a clip reads VIDEO from its
    // first beat (the forge stamps the pipeline's kind on the record).
    what: record?.kind === 'video' ? 'VIDEO' : 'IMAGE',
    // Needed to fetch the thumbnail: the image route is lane-scoped.
    laneId: record?.laneId ?? '',
    // The being's own name when we have it; the lane id is the honest fallback,
    // never a guess at who it was.
    who: record?.beingName || record?.laneId || 'a being',
    pipeline: record?.pipelineLabel || record?.pipelineId || '',
    percent: typeof record?.percent === 'number' ? record.percent : null,
    detail: record?.detail || '',
    images: Array.isArray(record?.images) ? record.images : [],
    live: phase === 'queued' || phase === 'rendering',
    bad: phase === 'error' || phase === 'refused',
  };
};

/**
 * The rail's whole view state from an /activity snapshot. Pure.
 *
 * Live rows lead, then the recent tail — the thing happening now is never
 * pushed below history. `idle` drives the empty word, so the rail says why it
 * is empty rather than showing a blank column.
 * @param {{live?: Array, recent?: Array}|null} snapshot
 * @returns {{rows: Array<object>, liveCount: number, idle: boolean}}
 */
export const deriveActivityRail = (snapshot) => {
  const live = Array.isArray(snapshot?.live) ? snapshot.live : [];
  const recent = Array.isArray(snapshot?.recent) ? snapshot.recent : [];
  const rows = [...live, ...recent].map(toActivityRow);
  return { rows, liveCount: live.length, idle: rows.length === 0 };
};
