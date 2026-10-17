// Pure decoding of Git porcelain v1 path fields. Quotes protect literal
// arrows; octal escapes encode UTF-8 bytes, not individual Unicode characters.
import { Buffer } from 'node:buffer';

const C_ESCAPES = Object.freeze({
  a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r',
  '"': '"', '\\': '\\',
});

const unquote = field => {
  if (!field.startsWith('"') || !field.endsWith('"')) return field;
  return field.slice(1, -1).replace(/(?:\\[0-7]{3})+|\\([abtnvfr"\\])/g, (escaped, named) => {
    if (named) return C_ESCAPES[named];
    const bytes = escaped.match(/[0-7]{3}/g).map(octal => Number.parseInt(octal, 8));
    return Buffer.from(bytes).toString('utf8');
  });
};

const destination = field => {
  let quoted = false;
  for (let i = 0; i < field.length; i += 1) {
    if (quoted && field[i] === '\\') { i += 1; continue; }
    if (field[i] === '"') { quoted = !quoted; continue; }
    if (!quoted && field.startsWith(' -> ', i)) return field.slice(i + 4);
  }
  return field;
};

/**
 * Decode a porcelain path, selecting the destination only for rename/copy rows.
 * @param {string} xy two-character porcelain status
 * @param {string} field the complete path field after the status separator
 * @returns {string} the actual repository-relative filename
 */
export const porcelainPath = (xy, field) => unquote(/[RC]/.test(xy) ? destination(field) : field);
