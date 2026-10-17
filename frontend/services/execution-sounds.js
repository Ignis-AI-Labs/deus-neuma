/** Execution subsections share one cue vocabulary between live acts and settings. */
export const EXECUTION_SOUNDS = Object.freeze({
  build: Object.freeze({ cue: 'actBuild', label: 'Build / compile' }),
  test: Object.freeze({ cue: 'actTest', label: 'Run tests' }),
  check: Object.freeze({ cue: 'actCheck', label: 'Lint / typecheck / format' }),
  install: Object.freeze({ cue: 'actInstall', label: 'Manage dependencies' }),
  git: Object.freeze({ cue: 'actGit', label: 'Git command' }),
  batch: Object.freeze({ cue: 'actBatch', label: 'Multiple command types' }),
  execute: Object.freeze({ cue: 'actExecute', label: 'Other execution' }),
  edit: Object.freeze({ cue: 'actEdit', label: 'Edit file' }),
  write: Object.freeze({ cue: 'actWrite', label: 'Write / create' }),
  read: Object.freeze({ cue: 'actRead', label: 'Read file' }),
  search: Object.freeze({ cue: 'actSearch', label: 'Search' }),
  list: Object.freeze({ cue: 'actList', label: 'List files' }),
  delete: Object.freeze({ cue: 'actDelete', label: 'Delete' }),
  move: Object.freeze({ cue: 'actMove', label: 'Move / rename' }),
});

export const EXECUTION_CUES = Object.freeze(Object.values(EXECUTION_SOUNDS).map(({ cue }) => cue));

/** Human-readable action names on the audition board. */
export const actionCueLabel = (cue) => Object.values(EXECUTION_SOUNDS).find((entry) => entry.cue === cue)?.label
  || ({ actReach: 'Fetch / external read', actSend: 'Send / publish', actForge: 'Generate artifact',
    actMark: 'Record / mark', actSense: 'Inspect state', actFailed: 'Action failed' })[cue] || cue;
