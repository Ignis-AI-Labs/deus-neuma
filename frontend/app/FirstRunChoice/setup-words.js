// setup-words — how the model setup is named to a person: each step of the job, and a size.
//
// pure — no IO.

const GB = 1_000_000_000;

/** Bytes as a person reads them. Pure. */
// nothing is 0 MB: a plan with nothing to download read […] (2026-10-23)
export const size = (n) => (n >= GB ? `${(n / GB).toFixed(1)} GB` : `${n > 0 ? Math.max(1, Math.round(n / 1_000_000)) : 0} MB`);

/** The step the setup job is on (managed-ollama.js or managed-engine.js `job.step`), named plainly. */
export const STEP_TEXT = Object.freeze({
  check: 'Reading this computer',
  download: 'Downloading the model server',
  runtime: 'Downloading the CUDA runtime',
  unpack: 'Unpacking',
  start: 'Starting the model server',
  pull: 'Downloading the model',
  projector: 'Downloading the vision projector',
  drafter: 'Downloading the drafter',
  verify: 'Checking the model answers',
  adopt: 'Finishing',
  done: 'Ready',
});
