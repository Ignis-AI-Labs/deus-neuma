/**
 * User files — the witness's OWN local filesystem, browsable from the desk.
 *
 * The third pillar of user-owned data (after the realm chats and the neuma's
 * sovereign workspace). This is the user's real disk: they pick the folders
 * to work in (the "roots"), and the explorer browses + edits ANYTHING inside
 * them. The neuma never sees this — it is the user's own workspace.
 *
 * The ONLY hard guard is containment: every operation resolves the target,
 * follows symlinks, and confirms it is still inside one of the chosen roots,
 * so neither `..` nor a symlink can escape. Within a root, the user owns it
 * all (their machine), so there is no content denylist — but writes still
 * stay root-contained and require an existing parent.
 *
 * Roots are cached here and set by user-files-settings.js at boot / when the
 * witness opens or removes a folder. IO is isolated and marked.
 */
import fs from 'fs/promises';
import { assertRenameName } from './rename-name.js';
import { realpathSync, statSync } from 'fs';
import path from 'path';
import { MAX_TEXT_BYTES, looksBinary, isLossyAsUtf8, lossyCharCount, lossyVerdict } from './text-encoding-law.js';

let roots = [];

export const getRoots = () => [...roots];
export const setRoots = (next) => {
  roots = (Array.isArray(next) ? next : []).map((r) => path.resolve(r));
};



/** True if `real` is the root itself or strictly inside it. */
const within = (real, root) => real === root || real.startsWith(root + path.sep);

/**
 * Resolve a path and confirm it is contained within one of the chosen roots,
 * following symlinks so neither `..` nor a symlink can escape. Returns the
 * real, absolute path. Throws on any escape or bad input.
 * @param {string} target - absolute path from the client (always re-validated)
 * @returns {string} the canonical real path, guaranteed inside a root
 */
export const containWithinRoots = (target) => {
  if (typeof target !== 'string' || !path.isAbsolute(target)) {
    throw new Error('Path must be absolute');
  }
  const resolved = path.resolve(target);
  const bases = roots.map((r) => path.resolve(r));
  // Lexical containment first (catches `..` and partial-name siblings).
  if (!bases.some((b) => within(resolved, b))) {
    throw new Error('Path outside allowed roots');
  }
  // Then resolve symlinks and re-check, so a link inside a root can't point out.
  let real = resolved;
  try {
    real = realpathSync(resolved);
  } catch {
    real = resolved; // path may not exist yet (e.g. a fresh write target) — lexical check stands
  }
  if (!bases.some((b) => within(real, b))) {
    throw new Error('Symlink target outside allowed roots');
  }
  return real;
};

/**
 * A listing entry's kind, and the order kinds sort in: directories first, then
 * ordinary files, then special entries (FIFOs, sockets, devices). The old
 * contract was dirs-then-files, so this is a superset of it — a client that
 * knows only the first two kinds keeps its exact previous ordering.
 */
const ENTRY_RANK = Object.freeze({ dir: 0, file: 1, special: 2 });

/** The error a caller gets for a path that exists but cannot be served as
 *  text. Coded so a route can answer 422 without matching on prose. */
export const notATextFile = (what) =>
  Object.assign(new Error(`Not a text file: ${what}`), { code: 'NOT_A_TEXT_FILE' });

/**
 * List a directory's immediate children, dirs first, then files, then special
 * entries (alpha within each kind).
 * @param {string} dirPath - absolute path inside a root
 * @returns {Promise<Array<{name, path, type, size, mtime, hidden}>>}
 */
// impure
export const listDir = async (dirPath) => {
  const real = containWithinRoots(dirPath);
  const entries = await fs.readdir(real, { withFileTypes: true });
  // The stats run TOGETHER, not entry by entry — a wide folder (dotfiles are
  // shown by law, so .git and node_modules list too) paid one awaited stat
  // per row, serialized, and a 30k-entry dir froze the tree for seconds
  // (audit, 2026-09-02).
  const out = await Promise.all(entries.map(async (e) => {
    const full = path.join(real, e.name);
    let size = 0;
    let mtime = null;
    // A symlink is followed, so a linked directory sorts and expands as one;
    // a broken or unreadable link falls back to the dirent's own answer.
    let stat = null;
    try {
      stat = await fs.stat(full);
      size = stat.size;
      mtime = stat.mtime.toISOString();
    } catch { /* broken symlink / permission — list it with zeros */ }
    const isDir = stat ? stat.isDirectory() : e.isDirectory();
    const isFile = stat ? stat.isFile() : e.isFile();
    // A FIFO, socket or device is NAMED rather than dropped: a folder holding
    // one used to render as if the entry did not exist at all.
    const type = isDir ? 'dir' : isFile ? 'file' : 'special';
    return { name: e.name, path: full, type, size, mtime, hidden: e.name.startsWith('.') };
  }));
  return out.sort((a, b) =>
    ENTRY_RANK[a.type] - ENTRY_RANK[b.type] || a.name.localeCompare(b.name)
  );
};

/**
 * Read a text file's contents for the editor. Flags binary/oversize instead
 * of dumping bytes into the editor.
 *
 * A file that is not valid UTF-8 comes back READ-ONLY (`lossy: true`) with its
 * content decoded as Latin-1 so the operator can still see and identify it.
 * Latin-1 is chosen because it is TOTAL — every byte 0x00–0xFF maps to a
 * codepoint, so the decode never fails and never invents a replacement
 * character. It is emphatically NOT a claim about the file's real encoding:
 * charset detection needs statistics, and a confident wrong guess (measured:
 * `euc-jp` cleanly decodes a Windows-1252 file and eats its smart quotes) is
 * worse than an honest "unknown". The editor says so on screen.
 *
 * @param {string} filePath - absolute path inside a root
 * @returns {Promise<{content: string|null, binary: boolean, size: number,
 *   truncated: boolean, lossy: boolean, lossyChars: number, mtimeMs: number}>}
 */
// impure
export const readFile = async (filePath) => {
  const real = containWithinRoots(filePath);
  const st = await fs.stat(real);
  if (!st.isFile()) throw notATextFile(st.isDirectory() ? 'directory' : 'special entry');
  // mtimeMs is stated BEFORE the content read: a write landing between the two
  // makes the buffer look newer than its stamp, so a later conditional save
  // refuses — the safe direction (#235).
  const base = { binary: false, size: st.size, truncated: false, lossy: false, lossyChars: 0, mtimeMs: st.mtimeMs };
  if (st.size > MAX_TEXT_BYTES) return { ...base, content: null, truncated: true };
  const buf = await fs.readFile(real);
  if (looksBinary(buf)) return { ...base, content: null, binary: true };
  // Not UTF-8: hand it over to be READ, never to be written back. The save path
  // is an unconditional full-content overwrite (see #235), so a buffer that was
  // never faithful to disk must not be allowed to reach it.
  if (isLossyAsUtf8(buf)) {
    return { ...base, content: buf.toString('latin1'), lossy: true, lossyChars: lossyCharCount(buf) };
  }
  return { ...base, content: buf.toString('utf8') };
};

/**
 * Write a file's contents (the editor's Save). Stays root-contained; the
 * parent directory must already exist (no implicit tree creation).
 * @param {string} filePath - absolute path inside a root
 * @param {string} content - utf8 text
 * @param {number} [expectedMtimeMs] - the mtimeMs the caller's buffer was read
 *   at; when given, the write refuses (code CONFLICT) if disk has moved since
 * @returns {Promise<{size: number, mtime: string, mtimeMs: number}>}
 */
// impure
export const writeFile = async (filePath, content, expectedMtimeMs) => {
  if (typeof content !== 'string') throw new Error('Content must be a string');
  const real = containWithinRoots(filePath);
  const parent = path.dirname(real);
  const pst = await fs.stat(parent).catch(() => null);
  if (!pst || !pst.isDirectory()) throw new Error('Parent directory does not exist');
  // CONDITIONAL SAVE (#235). The editor's buffer is a reading of the file at
  // one instant; anything written to disk after that instant was never in the
  // buffer, and a full-content save would destroy it silently. A caller that
  // states the mtime its buffer was read at gets a refusal instead — the
  // operator then chooses. Callers that state nothing (a being's tool call,
  // gated by ACTS approval, not by this) keep the unconditional path. The
  // stat-to-write window remains — this is a stale-buffer guard, not a CAS.
  if (expectedMtimeMs != null) {
    if (typeof expectedMtimeMs !== 'number' || !Number.isFinite(expectedMtimeMs)) {
      throw new Error('expectedMtimeMs must be a finite number');
    }
    const now = await fs.stat(real).catch(() => null);
    if (!now || !now.isFile()) {
      throw Object.assign(new Error('The file was removed while it was open.'), { code: 'CONFLICT' });
    }
    if (now.mtimeMs !== expectedMtimeMs) {
      throw Object.assign(new Error('The file changed on disk after it was opened.'), { code: 'CONFLICT' });
    }
  }
  // DEFENCE IN DEPTH (#239). The editor keeps SAVE disabled on a non-UTF-8
  // file, but a disabled button is not a guarantee: every write through this
  // module lands here (today that is the desk's PUT /write route — a being's
  // write_file rides the MCP filesystem child process and never enters this
  // module, which carries its own copy of this defect). Refuse to overwrite a
  // file whose bytes on disk cannot survive a UTF-8 round trip, because this
  // write is full-content: it would replace every untouched legacy byte in the
  // file with U+FFFD, irreversibly.
  //
  // The guard examines at most the first MAX_TEXT_BYTES. It previously SKIPPED
  // files above that bound entirely, leaving the destruction fully live above
  // 2 MiB (validated on #239: a 2,097,220-byte Latin-1 file became 10 bytes
  // with no refusal). A lossy byte anywhere in the prefix already refuses;
  // bytes past the prefix stay unexamined — the accepted residue of bounding
  // the guard's cost. Binary files are excluded — writeBinary is their path,
  // and text-over-binary is a deliberate replacement, not an encoding accident.
  const existing = await fs.stat(real).catch(() => null);
  if (existing?.isFile() && existing.size > 0) {
    const verdict = await lossyVerdict(real, existing.size);
    if (verdict) {
      throw new Error(
        `This file is not UTF-8. Saving would destroy ${verdict.prefixed ? 'at least ' : ''}`
        + `${verdict.count} character(s) that cannot be re-encoded, `
        + 'including ones you did not touch.',
      );
    }
  }
  await fs.writeFile(real, content, 'utf8');
  const st = await fs.stat(real);
  return { size: st.size, mtime: st.mtime.toISOString(), mtimeMs: st.mtimeMs };
};

// ---------------------------------------------------------------------------
// THE TWO-WAY BRIDGE (Design note, 2026-07-28: drag files from the OS file manager
// into the Explorer, and back out. Same containment law as everything above
// — the dropped bytes land only inside an open root, and only root-contained
// bytes leave.
// ---------------------------------------------------------------------------

/**
 * The name an upload may land under (pure). A browser sends the file's name
 * from the witness's own machine — trusted as intent, never as a PATH:
 * separators, traversal, dot-names and empties are refused outright rather
 * than quietly rewritten, because a silently renamed drop is a file the
 * witness cannot find.
 * @param {unknown} rawName
 * @returns {string}
 */
export const sanitizeUploadName = (rawName) => {
  const name = String(rawName || '').trim();
  if (!name) throw new Error('the upload needs a file name');
  if (name !== path.basename(name) || name.includes('\\')) {
    throw new Error(`the name must be a plain file name, not a path: ${name}`);
  }
  if (name === '.' || name === '..' || name.startsWith('..')) {
    throw new Error(`refusing the name: ${name}`);
  }
  return name;
};

/**
 * The collision form (pure): `report.pdf` → `report (2).pdf`, dotfiles
 * keep their leading dot (`.env` → `.env (2)`), and the original is never
 * rewritten — the witness's own disk-manager grammar.
 * @param {string} name - already sanitized
 * @param {number} n - collision ordinal, n >= 2
 * @returns {string}
 */
export const suffixedName = (name, n) => {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  return `${stem} (${n})${ext}`;
};

/** The largest single upload the bridge carries. Bytes, honest at the door. */
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Land one dropped file's bytes inside an open root (impure). The directory
 * must exist and be root-contained; the name is sanitized; a name already
 * taken lands under its suffixed form — a drop NEVER clobbers (the OS file
 * manager asks before overwriting; the bridge's answer is that nothing is
 * ever destroyed by a drag).
 * @param {string} dirPath - absolute directory inside a root
 * @param {string} rawName - the file's name as the OS reported it
 * @param {Buffer} bytes
 * @returns {Promise<{path: string, name: string, renamed: boolean, size: number}>}
 */
export const writeBinary = async (dirPath, rawName, bytes) => {
  if (!Buffer.isBuffer(bytes)) throw new Error('the upload carried no bytes');
  if (bytes.length > UPLOAD_MAX_BYTES) {
    throw new Error(`the file is ${(bytes.length / 1024 / 1024).toFixed(1)}MB — the bridge carries up to ${UPLOAD_MAX_BYTES / 1024 / 1024}MB`);
  }
  const name = sanitizeUploadName(rawName);
  const dir = containWithinRoots(dirPath);
  const st = await fs.stat(dir).catch(() => null);
  if (!st || !st.isDirectory()) throw new Error('the drop target is not an existing folder');
  let candidate = name;
  let n = 1;
  // Bounded walk: an occupied name steps to its next ordinal. A folder full
  // of collisions ends in an honest refusal, never a hang.
  while (await fs.stat(path.join(dir, candidate)).catch(() => null)) {
    n += 1;
    if (n > 99) throw new Error(`too many files named like ${name} here — rename one first`);
    candidate = suffixedName(name, n);
  }
  const target = path.join(dir, candidate);
  // wx, not w: between the stat and the write a same-named file appearing
  // must fail loudly, never overwrite.
  await fs.writeFile(target, bytes, { flag: 'wx' });
  return { path: target, name: candidate, renamed: candidate !== name, size: bytes.length };
};

/**
 * Resolve a downloadable file (impure): contained, existing, a FILE (never
 * a directory — a recursive archive of someone's folder is not a download).
 * The route streams from the returned real path.
 * @param {string} filePath
 * @returns {Promise<{real: string, size: number}>}
 */
export const resolveBinaryFile = async (filePath) => {
  const real = containWithinRoots(filePath);
  const st = await fs.stat(real).catch(() => null);
  if (!st) throw new Error('Path does not exist');
  if (!st.isFile()) throw new Error('Not a file');
  return { real, size: st.size };
};

/** True if `real` is one of the open roots (which must never be mutated). */
const isOpenRoot = (real) => roots.map((r) => path.resolve(r)).includes(real);

/**
 * Create a new empty file or directory. Root-contained; the parent must exist
 * and the target must not (no clobbering).
 * @param {string} targetPath - absolute path inside a root
 * @param {'file'|'dir'} kind
 * @returns {Promise<{path: string, type: 'file'|'dir'}>}
 */
// impure
export const createEntry = async (targetPath, kind) => {
  if (kind !== 'file' && kind !== 'dir') throw new Error('kind must be "file" or "dir"');
  const real = containWithinRoots(targetPath);
  const parent = path.dirname(real);
  const pst = await fs.stat(parent).catch(() => null);
  if (!pst || !pst.isDirectory()) throw new Error('Parent directory does not exist');
  if (await fs.stat(real).catch(() => null)) throw new Error('A file or folder with that name already exists');
  if (kind === 'dir') await fs.mkdir(real);
  else await fs.writeFile(real, '', { flag: 'wx' });
  return { path: real, type: kind };
};

/**
 * Rename or move a file/directory. Both ends stay root-contained, the target's
 * parent must exist, and the target must not already exist. An open root itself
 * cannot be renamed.
 * @param {string} fromPath - absolute path inside a root
 * @param {string} toPath - absolute path inside a root
 * @returns {Promise<{path: string, type: 'file'|'dir'}>}
 */
// impure
export const renamePath = async (fromPath, toPath) => {
  if (typeof toPath === 'string') assertRenameName(path.basename(toPath), process.platform);
  const from = containWithinRoots(fromPath);
  const to = containWithinRoots(toPath);
  if (isOpenRoot(from)) throw new Error('Cannot rename an open root folder');
  const fst = await fs.stat(from).catch(() => null);
  if (!fst) throw new Error('Source does not exist');
  const parent = path.dirname(to);
  const pst = await fs.stat(parent).catch(() => null);
  if (!pst || !pst.isDirectory()) throw new Error('Target parent directory does not exist');
  if (await fs.stat(to).catch(() => null)) throw new Error('A file or folder with that name already exists');
  await fs.rename(from, to);
  return { path: to, type: fst.isDirectory() ? 'dir' : 'file' };
};

/**
 * Delete a file or directory (recursive for directories). Root-contained; an
 * open root itself cannot be deleted.
 * @param {string} targetPath - absolute path inside a root
 * @returns {Promise<{deleted: string}>}
 */
// impure
export const deletePath = async (targetPath) => {
  const real = containWithinRoots(targetPath);
  if (isOpenRoot(real)) throw new Error('Cannot delete an open root folder');
  const st = await fs.stat(real).catch(() => null);
  if (!st) throw new Error('Path does not exist');
  await fs.rm(real, { recursive: st.isDirectory(), force: false });
  return { deleted: real };
};

// ---------------------------------------------------------------------------
// Focus plumbing (D3/D9) — the chokepoint and the roots mutation lock.
// ---------------------------------------------------------------------------

/**
 * THE focus-path chokepoint (D3, echo amendment). A desk window's focus is a
 * CLIENT-SUPPLIED path and therefore untrusted at every backend boundary;
 * every consumer (terminal `?cwd=`, map `?folder=`, `/folder-info`) resolves
 * it through THIS function — never through containWithinRoots directly — so
 * the containment stance lives in exactly one place: string, absolute,
 * inside one of the opened roots after symlink resolution, and an existing
 * directory. Anything else is null and the caller refuses or degrades — a
 * hostile path is never served, spawned into, or scanned. Focus never widens a
 * neuma sandbox or grants live-write authority (D8). For a sealed witness it
 * may select only the source of a filtered disposable coding snapshot.
 * @param {unknown} rawPath - client-supplied focus path (untrusted)
 * @returns {string|null} the canonical real directory path, or null
 */
// impure — resolves symlinks against the live roots and stats the target
export const resolveFocusPath = (rawPath) => {
  if (typeof rawPath !== 'string' || !path.isAbsolute(rawPath)) return null;
  let real;
  try {
    real = containWithinRoots(rawPath);
  } catch {
    return null;
  }
  try {
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
};

// impure — serialize every roots mutation (D9). setRoots + saveFileSettings
// is a read-modify-write over module state plus one settings file; two desk
// windows racing it lose updates. Callers wrap the WHOLE read-modify-write
// so each mutation sees the roots the previous one left. Mirrors the
// per-wallet store queue in user-projects.js — roots are process-global, so
// one queue guards them all; the queue survives a failed mutation (errors
// still surface to the caller).
let rootsMutation = Promise.resolve();
export const withRootsLock = (task) => {
  const run = rootsMutation.then(task, task);
  rootsMutation = run.catch(() => {});
  return run;
};
