// setup-words — how the model setup is named to a person: each step of the job, and a size.
//
// pure — no IO.

const GB = 1_000_000_000;

/** Bytes as a person reads them. Pure. */
export const size = (n) => (n >= GB ? `${(n / GB).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1_000_000))} MB`);

/** The step the setup job is on (managed-ollama.js `job.step`), named plainly. */
export const STEP_TEXT = Object.freeze({
  download: 'Downloading the model server',
  unpack: 'Unpacking',
  start: 'Starting the model server',
  pull: 'Downloading the model',
  adopt: 'Finishing',
  done: 'Ready',
});
