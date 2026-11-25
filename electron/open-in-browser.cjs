// Open-in-browser target — pure derivation of what a right-clicked path may
// become. Only an ABSOLUTE .html/.htm path earns a file:// URL; everything
// else is refused here so main's handler stays a thin shell binding (the
// same pure/thin split as context-menu.cjs). Existence is main's IO check,
// not this module's.

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { isUncPath, withinRoot } = require('./local-paths.cjs');

/**
 * Derive the file:// URL a path may be opened at, or null when the path is
 * not an absolute HTML file path. Pure.
 * @param {unknown} rawPath
 * @param {Array<string>} roots the desk's currently open roots
 * @returns {string|null}
 */
const browserTargetFor = (rawPath, roots = []) => {
  if (typeof rawPath !== 'string' || !path.isAbsolute(rawPath) || isUncPath(rawPath)) return null;
  if (!Array.isArray(roots) || roots.length === 0 || !roots.some((root) => withinRoot(rawPath, root, path))) return null;
  const ext = path.extname(rawPath).toLowerCase();
  if (ext !== '.html' && ext !== '.htm') return null;
  return pathToFileURL(rawPath).toString();
};

// impure — the same gate after resolving the real file and real roots.
const browserRealTargetFor = (rawPath, roots = []) => {
  if (!browserTargetFor(rawPath, roots)) return null;
  try {
    const realFile = fs.realpathSync(rawPath);
    const realRoots = roots.map((root) => fs.realpathSync(root));
    if (!fs.statSync(realFile).isFile()) return null;
    return browserTargetFor(realFile, realRoots);
  } catch {
    return null;
  }
};

module.exports = { browserTargetFor, browserRealTargetFor };
