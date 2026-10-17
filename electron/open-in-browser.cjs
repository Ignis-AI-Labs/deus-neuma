// Open-in-browser target — pure derivation of what a right-clicked path may
// become. Only an ABSOLUTE .html/.htm path earns a file:// URL; everything
// else is refused here so main's handler stays a thin shell binding (the
// same pure/thin split as context-menu.cjs). Existence is main's IO check,
// not this module's.

const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * Derive the file:// URL a path may be opened at, or null when the path is
 * not an absolute HTML file path. Pure.
 * @param {unknown} rawPath
 * @returns {string|null}
 */
const browserTargetFor = (rawPath) => {
  if (typeof rawPath !== 'string' || !path.isAbsolute(rawPath)) return null;
  const ext = path.extname(rawPath).toLowerCase();
  if (ext !== '.html' && ext !== '.htm') return null;
  return pathToFileURL(rawPath).toString();
};

module.exports = { browserTargetFor };
