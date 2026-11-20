// One durable replacement for key and wallet records. The destination never
// disappears between writes, and a pre-existing temporary path is never followed.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const syncDir = (dir) => {
  if (process.platform === 'win32') return;
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};

// impure (fs, randomness) — build beside the destination, verify, then rename.
const replace = (file, payload) => {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  let fd = null;
  let renamed = false;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, payload);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    if (!fs.readFileSync(tmp).equals(payload)) throw new Error(`atomic-file: read-back differs for ${file}`);
    fs.renameSync(tmp, file);
    renamed = true;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* the original failure is more useful */ }
    }
    if (!renamed) {
      try { fs.unlinkSync(tmp); } catch { /* creation failed or cleanup already ran */ }
    }
  }
};

/**
 * impure (fs) — atomically replace a record, optionally retaining one verified copy.
 * @param {string} file
 * @param {string|Buffer|Uint8Array} contents
 * @param {{backup?: boolean}} [opts]
 */
const writeFileAtomic = (file, contents, { backup = false } = {}) => {
  const payload = Buffer.from(contents);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  replace(file, payload);
  if (backup) replace(`${file}.bak`, payload);
  syncDir(dir);
};

module.exports = { writeFileAtomic };
