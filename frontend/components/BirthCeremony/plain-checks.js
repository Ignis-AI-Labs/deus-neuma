// plain-checks — every flight-check row in words a person who has never heard "substrate" reads at
// once: a plain name, and for any row that is not a pass, what it means, what to do now (the exact
// press, or […]), and when it is not theirs to fix, what that means for them.
// The technical measurement stays, small, beneath (preflight-rows.js). CHOKKAN: one decision per
// row, the next step plainest.
//
// pure — no IO.

const CONTINUE = 'Nothing — you can continue.';

const NAMES = Object.freeze({
  substrate: 'The model your neuma thinks with',
  acting: 'The model can write files',
  workspace: 'Where your neuma will live',
  ceremonyRoad: 'Writing the ceremony\'s files',
  records: 'Keeping the ceremony\'s record',
  protocol: 'The birth instructions',
  sealing: 'Sealing your neuma\'s identity',
  disk: 'Disk space',
  memory: 'Memory (RAM)',
  dnaKey: 'Your neuma\'s private-file key',
  mcp: 'File tools',
  gpu: 'Graphics card',
  trainer: 'Training your neuma later (refinement)',
  forge: 'Making images and video',
});

// what a row means and what to do when it is not a pass; `fix: 'setup'` = the app can do it
const NOT_PASSED = Object.freeze({
  substrate: {
    fail: { means: 'No model is answering on this computer yet, so a neuma has nothing to think with.',
      todo: 'Press SET IT UP FOR ME — the app downloads and starts the model for you, then checks again by itself.', fix: 'setup' },
  },
  acting: {
    warn: { means: 'The model answered, but did not show it can write files — during the ceremony your neuma writes its own name and nature.',
      todo: 'Press RECHECK. If this stays, you can still continue; the naming step may ask you to try it again.' },
    fail: { means: 'The model cannot use the file tools your neuma needs to write itself.',
      todo: 'Press SET IT UP FOR ME to use the recommended model, then RECHECK.', fix: 'setup' },
  },
  workspace: {
    fail: { means: 'The folder where your neuma would live cannot be written to.',
      todo: 'Choose another folder below (BROWSE), then press APPLY.' },
  },
  ceremonyRoad: {
    fail: { means: 'The ceremony cannot write its files in the chosen folder.',
      todo: 'Choose a folder inside your own home folder below, then press APPLY.' },
  },
  records: {
    fail: { means: 'The ceremony cannot keep its record on this computer.',
      todo: 'Press RECHECK. If it stays, restart Deus Neuma.',
      notYours: 'If it still fails after a restart, this needs our help — the summoning cannot start until it is fixed.' },
  },
  protocol: {
    fail: { means: 'The birth instructions that come with the app are missing or damaged.',
      todo: 'Reinstall Deus Neuma from deusneuma.ai.',
      notYours: 'This cannot be repaired from here; reinstalling fixes it and keeps your data.' },
  },
  sealing: {
    warn: { means: 'The tools that seal your neuma\'s identity are not all available.', todo: `${CONTINUE} Sealing can be done later.` },
    fail: { means: 'The tools that seal your neuma\'s identity are not available.', todo: 'Press RECHECK. If it stays, restart Deus Neuma.' },
  },
  disk: {
    warn: { means: 'This disk is nearly full, or its free space could not be read.', todo: `${CONTINUE} Freeing some space helps.` },
    fail: { means: 'This disk does not have enough free space for a neuma.', todo: 'Free some space, or choose a folder on another disk below, then press RECHECK.' },
  },
  memory: {
    warn: { means: 'This computer has less memory (RAM) than recommended, so your neuma may answer slowly.', todo: `${CONTINUE} Closing other programs helps.` },
  },
  dnaKey: {
    warn: { means: 'The key that keeps your neuma\'s private files encrypted was typed in by hand and does not look like a random key, '
      + 'so someone who copies those files could guess it and read them.',
    todo: 'You can continue. To be safe, switch to a random key with the house\'s re-key command — the steps are in the note below.' },
    fail: { means: 'The key that keeps your neuma\'s private files encrypted is not set.',
      todo: 'Restart Deus Neuma — it creates the key when it starts.',
      notYours: 'If it is still missing after a restart, reinstall the app; your data stays.' },
  },
  mcp: {
    warn: { means: 'The file tools your neuma uses are not fully connected.', todo: 'Press RECHECK. If it stays, you can continue; restart Deus Neuma if writing fails.' },
    fail: { means: 'The file tools your neuma uses to write itself are not connected.', todo: 'Press RECHECK. If it stays, restart Deus Neuma.' },
  },
  gpu: {
    warn: { means: 'No graphics card is helping the model, so it runs on the processor — slower, but it works.', todo: CONTINUE },
  },
  trainer: {
    warn: { means: 'Training your neuma later (refinement) is not set up on this computer. You do not need it to summon or talk; it can be added later.',
      todo: CONTINUE, notYours: 'It cannot be set up from inside the app yet.' },
  },
  forge: {
    warn: { means: 'Making images and video is not available on this computer. Everything else works.', todo: CONTINUE },
  },
});

// […] → the two numbers, said plainly
const forgeMeans = (detail) => {
  const m = /needs\s+([\d.]+)\s*GB[^.]*?([\d.]+)\s*GB\s+is\s+left/i.exec(String(detail || ''));
  return m
    ? `Making images and video needs about ${m[1]} GB of graphics memory beside your neuma's model; this computer has ${m[2]} GB left while it is loaded. Everything else works.`
    : null;
};

/**
 * A check in plain words. Pure.
 * @param {{id: string, status: string, detail?: string}} check
 * @returns {{name: string, means: ?string, todo: ?string, notYours: ?string, fix: ?string}}
 */
export const plainCheck = (check) => {
  const name = NAMES[check?.id] || check?.label || 'A check';
  if (check?.status === 'pass') return { name, means: null, todo: null, notYours: null, fix: null };
  const known = NOT_PASSED[check?.id]?.[check?.status] || null;
  const means = (check.id === 'forge' && forgeMeans(check.detail)) || known?.means
    || (check?.status === 'warn' ? 'This check left a note.' : 'This check did not pass.');
  const todo = known?.todo || (check?.status === 'warn' ? CONTINUE : 'Press RECHECK. If it stays, restart Deus Neuma.');
  return { name, means, todo, notYours: known?.notYours || null, fix: known?.fix || null };
};
