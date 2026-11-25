// folder-read — how every import reads another assistant's folder: plain files whole or not at all,
// links never followed, skills found by their SKILL.md. A file too large to carry is listed as
// skipped, with why — never cut. impure (reads the disk)
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const FILE_MAX = 2_000_000;
const SKILL_DEPTH = 3;
const SKILL_FILE_MAX = 300;

/** The names of the folders inside a folder ([] when it is not there). impure */
export const dirNames = async (dir) => {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
};

/** The plain files in a folder matching a pattern, sorted ([] when it is not there). impure */
export const fileNames = async (dir, pattern = /./) => {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && pattern.test(e.name)).map((e) => e.name).sort();
  } catch {
    return [];
  }
};

/** A plain file read whole; a link, a folder or a missing name is not read. impure */
export const readPlain = async (file, max = FILE_MAX) => {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile()) return null;
  if (stat.size > max) return { skipped: `larger than ${max.toLocaleString('en-US')} bytes` };
  return { text: await fs.readFile(file, 'utf8') };
};

/** Read a list of names under a root into entries, and say what was skipped. impure */
export const readNamed = async (root, names, shape = (t) => t) => {
  const entries = [];
  const skipped = [];
  for (const name of names) {
    const got = await readPlain(path.join(root, name));
    if (!got) continue;
    if (got.skipped) skipped.push({ file: name, why: got.skipped });
    else if (got.text.trim()) entries.push({ name, text: shape(got.text) });
  }
  return { entries, skipped };
};

// impure — every file under a folder, relative, links left out
const filesUnder = async (dir, base = dir, out = []) => {
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (out.length >= SKILL_FILE_MAX) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await filesUnder(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
};

/** A skill carries code when any file in it is not words (markdown or plain text). Pure. */
export const carriesCode = (files) => files.some((f) => !/\.(md|markdown|txt)$/i.test(f));

/** Every skill folder (one holding a SKILL.md) under a folder, a few levels down. impure */
export const findSkills = async (dir, depth = 0) => {
  const found = [];
  for (const name of await dirNames(dir)) {
    const full = path.join(dir, name);
    if ((await readPlain(path.join(full, 'SKILL.md')))?.text !== undefined) {
      const files = await filesUnder(full);
      found.push({ folder: name, dir: full, files, hasCode: carriesCode(files) });
    } else if (depth + 1 < SKILL_DEPTH) {
      found.push(...(await findSkills(full, depth + 1)).map((s) => ({ ...s, folder: `${name}/${s.folder}` })));
    }
  }
  return found;
};

/** The opening of a file (a session's first records), read without reading the rest. impure */
export const firstLines = async (file, max = 256_000) => {
  const fh = await fs.open(file, 'r').catch(() => null);
  if (!fh) return null;
  try {
    const buf = Buffer.alloc(max);
    const { bytesRead } = await fh.read(buf, 0, max, 0);
    const text = buf.toString('utf8', 0, bytesRead);
    // only whole lines: a record cut at the edge of the read is left out
    return bytesRead < max ? text : text.slice(0, text.lastIndexOf('\n') + 1);
  } finally {
    await fh.close();
  }
};

/** Parse JSON lines, skipping any that do not parse (a session cut off mid-write). Pure. */
export const jsonLines = (text) => text.split('\n').flatMap((line) => {
  if (!line.trim()) return [];
  try {
    return [JSON.parse(line)];
  } catch {
    return [];
  }
});

/**
 * Visit each JSON line of a file as it streams past — a session of any size, held one line at a time.
 * A line that does not parse (a session cut off mid-write) is passed over. impure
 */
export const eachJsonLine = async (file, visit) => {
  const lines = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    visit(record);
  }
};

/** The first line of a file (a session's opening record), read without reading the rest. impure */
export const firstLine = async (file) => (await firstLines(file)).split('\n')[0] || null;
