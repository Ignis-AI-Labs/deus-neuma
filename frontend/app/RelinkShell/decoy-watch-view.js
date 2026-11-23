// decoy-watch-view — the display law of the SECURITY window's DECOYS section:
// what its one line says, and what each decoy's row reads. Pure; the IO lives
// in DecoyWatch.jsx, the rendering in DecoyWatchBody.jsx.

// How the watch sees, in the operator's words.
const MODE_WORDS = Object.freeze({
  inotify: { text: 'SEES AN OPEN AT ONCE', tone: 'on' },
  atime: { text: 'SEES A READ WITHIN A SECOND', tone: 'on' },
  blind: { text: 'CANNOT SEE READS ON THIS DISK', tone: 'alert' },
  down: { text: 'THE WATCH IS DOWN', tone: 'alert' },
  idle: { text: 'NOTHING TO WATCH' },
});

const STATUS_WORDS = Object.freeze({
  planted: 'PLANTED',
  skipped: 'SKIPPED',
  retired: 'RETIRED',
  none: 'NOT PLANTED',
});

const plantedCount = (state) => (state?.decoys ?? []).filter((d) => d.status === 'planted').length;

/** Does the section wait on the operator? A frozen program does. */
export const decoysWait = (state) => (state?.frozen?.length ?? 0) > 0;

/**
 * The section's line: its state and counts, in words.
 * @param {?object} state the decoy watch's status, or null while it loads
 * @returns {Array<string | {text: string, tone?: 'on' | 'alert'}>}
 */
export const decoyStats = (state) => {
  if (!state) return ['—'];
  if (!state.supported) return ['LINUX ONLY FOR NOW'];
  if (!state.enabled) return ['OFF'];
  const frozen = state.frozen?.length ?? 0;
  return [
    { text: 'ON', tone: 'on' },
    `${plantedCount(state)} OF ${state.decoys.length} PLANTED`,
    MODE_WORDS[state.mode] ?? state.mode.toUpperCase(),
    frozen ? { text: `${frozen} FROZEN`, tone: 'alert' } : null,
  ].filter(Boolean);
};

/** One decoy as a row: its name, its state, and where it stands or why not. */
export const decoyRows = (state) => (state?.decoys ?? []).map((d) => ({
  id: d.id,
  name: d.name,
  status: STATUS_WORDS[d.status] ?? d.status.toUpperCase(),
  planted: d.status === 'planted',
  where: d.files?.length ? d.files.join(' · ') : (d.reason ?? '—'),
}));

/** One frozen program as a row. */
export const frozenRows = (state) => (state?.frozen ?? []).map((f) => ({
  pid: f.pid,
  program: f.script ? `${f.exe ?? f.comm} running ${f.script}` : (f.exe ?? f.comm),
  at: f.at,
}));
