/**
 * The one-flag CLI reader the ignition scripts share.
 *
 * Hoisted because it was copied verbatim into three siblings and mapview kept
 * saying so. Pure.
 */

/**
 * Read `--name value` from argv.
 * @param {string} name flag name without the dashes
 * @param {string|null} [fallback] returned when the flag is absent or has no value
 * @param {string[]} [argv] defaults to process.argv
 * @returns {string|null}
 */
export const arg = (name, fallback = null, argv = process.argv) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

/** True when a bare `--name` flag is present. */
export const flag = (name, argv = process.argv) => argv.includes(`--${name}`);
