// managed-ollama-errors — what a person is told when the model setup cannot finish by itself: one
// plain sentence ending in the one thing to do, with the technical cause kept apart as the detail
// (the screen shows it second, behind "details"). Pure.
//
// The setup tries again by itself first (a download up to three times, the whole job twice), so a
// person reads one of these only once retrying has not helped.

/** A failure the setup knows by name: a code, its technical message, and optionally its own plain words. Pure. */
export const setupFailure = (code, message, plain = null) => Object.assign(new Error(message), { code, ...(plain ? { plain } : {}) });

const TRY_AGAIN = 'then press TRY AGAIN';
const PLAIN = Object.freeze({
  DOWNLOAD_DAMAGED: `The model server download kept arriving damaged, so it was not used. Check the internet connection, ${TRY_AGAIN}.`,
  DOWNLOAD_PAGE: `The download came back as a web page instead of the file. A work or hotel network can do this: try another connection, ${TRY_AGAIN}.`,
  DOWNLOAD_SIZE: `The download came back the wrong size. A work or hotel network can do this: try another connection, ${TRY_AGAIN}.`,
  DOWNLOAD_HTTP: `The download could not be reached. Check the internet connection, ${TRY_AGAIN}; it picks up where it stopped.`,
  DOWNLOAD_NETWORK: `The download stopped before it finished. Check the internet connection, ${TRY_AGAIN}; it picks up where it stopped.`,
  UNPACK: `The model server could not be unpacked. Make sure the disk has free space, ${TRY_AGAIN}.`,
  SERVER_START: `The model server did not start. Restart Deus Neuma, ${TRY_AGAIN}.`,
  SERVER_OLD: `The model server answering here is too old for this model. Close any other Ollama, ${TRY_AGAIN}.`,
  PULL_FAILED: `The model download stopped before it finished. Check the internet connection, ${TRY_AGAIN}; it picks up where it stopped.`,
  MODEL_SILENT: `The model is downloaded but did not answer a test message. Close other programs to free memory, ${TRY_AGAIN}.`,
});
const DEFAULT = `Setting up the model did not finish. Press TRY AGAIN.`;

// A failure that trying again cannot mend: the setup stops at once and says so
const FINAL = new Set(['UNSUPPORTED', 'DISK_SPACE', 'DOWNLOAD_DAMAGED', 'DOWNLOAD_PAGE', 'DOWNLOAD_SIZE']);

/** Is this failure one the setup should not retry by itself? Pure. */
export const isFinal = (err) => FINAL.has(err?.code);

/**
 * The words for a failure. Pure.
 * @param {unknown} err
 * @returns {{error: string, detail: string|null}}
 */
export const plainFailure = (err) => {
  const detail = String(err?.message || err || '').trim() || null;
  const error = err?.plain || PLAIN[err?.code] || DEFAULT;
  return { error, detail: detail === error ? null : detail };
};
