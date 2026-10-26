/**
 * THE NATIVE FILESYSTEM ORGAN — file access as a core component of the
 * platform, not a connected integration.
 *
 * Until 2026-08-15 the being's file tools lived in a spawned
 * @modelcontextprotocol/server-filesystem child over stdio. When that child
 * died — a power-loss reboot was enough — every file tool answered
 * "Not connected" while the backend stood perfectly healthy (Cael,
 * mid-work, on the benchmarks migration). Founder's law from that failure:
 * fundamental capabilities beings EXPECT — file access first among them —
 * are organs of the platform, in-process, with no transport to lose. MCP
 * remains the door for genuinely external, operator-added servers.
 *
 * The pinned package stays the SECURITY AUTHORITY: its lib.js executes here
 * unchanged — validatePath (allowed-roots wall, symlink resolution to real
 * targets, parent checks for files being created) and the exclusive-create /
 * atomic-rename write discipline. Handlers below mirror the package's own
 * dist/index.js registrations one for one, so the tool surface a being
 * learned is identical to the letter. What is deleted is ONLY the process
 * boundary: no spawn, no stdio, no 30s connect timeout, no dead-child class
 * of failure.
 *
 * Per-being confinement (lanes, denied paths, budgets, ACTS approval) stands
 * IN FRONT of this organ in tool-sandbox.js, exactly as it stood in front of
 * the child. edit_file and delete_file stay platform hands
 * (platform-hands.js) — the organ's edit_file exists for surface parity and
 * direct platform callers only.
 *
 * impure (real fs) except where marked.
 */

import fs from 'fs/promises';
import path from 'path';
import { inflateRawSync } from 'zlib';
import { pdfRead, pdfText } from './pdf-text.js';
import { docxText } from '../../core/documents/docx-text.js';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import {
  applyFileEdits, formatSize, getFileStats, headFile,
  readFileContent, tailFile,
  validatePath, writeFileContent,
} from '@modelcontextprotocol/server-filesystem/dist/lib.js';
import { getNativeFilesystemRoots, runningAs, setNativeFilesystemRoots } from './native-fs-roots.js';
import { checkPathAccess, secretLinkReason } from './sandbox-path-policy.js';
import { otherHouseInWalk, readablePath } from './fs-read-clearance.js';

// The organ matches directory_tree excludes with the SAME minimatch the
// package's own search path uses — resolved from the package's dependency
// tree, not the app's (the two carry different majors).
const { minimatch } = createRequire(
  createRequire(import.meta.url).resolve('@modelcontextprotocol/server-filesystem/dist/lib.js')
)('minimatch');

// --- Result shapes -----------------------------------------------------------

/** MCP-shaped success payload — pure. */
const said = (text) => ({ content: [{ type: 'text', text }], structuredContent: { content: text } });

/** MCP-shaped refusal, as the SDK surfaces a handler throw — pure. */
const refused = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

/**
 * The package matcher compares the FULL relative path. `*.js` therefore
 * misses `src/a.js`, and a bare name misses everything not at the root.
 * A pattern with no slash becomes a name search at any depth.
 * Pure.
 * @param {unknown} pattern
 * @returns {string}
 */
export const nameSearchGlob = (pattern) => {
  const raw = typeof pattern === 'string' ? pattern.trim() : '';
  if (!raw) return '**/*';
  if (raw.includes('/') || raw.includes('\\')) return raw;
  if (raw.startsWith('**')) return raw;
  if (['*', '?', '['].some(token => raw.includes(token))) return `**/${raw}`;
  return `**/*${raw}*`;
};


// --- Handlers (one per catalog entry, mirroring dist/index.js) ---------------

const MEDIA_MIME_TYPES = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.flac': 'audio/flac',
});

/** Pure — the mime a path's extension names, or null for anything unlisted
 *  (which is treated as text, the way it always was). */
export const mediaMimeFor = (filePath) =>
  MEDIA_MIME_TYPES[path.extname(String(filePath || '')).toLowerCase()] || null;

/** Pure — is this a path the EYE can take? Narrower than the media list:
 *  audio has no vision path, and SVG/GIF/BMP are not accepted by the sight
 *  store, so routing them to it would promise a look that never happens. */
export const isSightablePath = (filePath) =>
  ['image/png', 'image/jpeg', 'image/webp'].includes(mediaMimeFor(filePath));

const readTextFile = async (args) => {
  const validPath = await readablePath(args.path);
  if (args.head && args.tail) {
    throw new Error('Cannot specify both head and tail parameters simultaneously');
  }
  // ONE VERB FOR "READ THIS PATH" (Design note, 2026-08-29: […]).
  //
  // Reading an image as UTF-8 returns nothing usable, and it did so SILENTLY —
  // no error, no hint the file was even an image. A being was left reasoning
  // about why its read came back empty. So a read of an image is simply a look
  // at it: the bytes go out as an image block, which the sandbox turns into
  // sight (fs-sight.js). head/tail are meaningless on an image and are
  // ignored rather than refused — asking for the first 20 lines of a PNG is a
  // wrong question, not a fatal one.
  if (isSightablePath(validPath)) return readMediaFile({ path: validPath });
  // A PDF or a Word document reads as its words (pdf-text.js, docx-text.js), never as decoded bytes; a PDF's scanned pages go to the eye.
  const asWords = /\.pdf$/i.test(validPath) ? pdfText
    : /\.docx$/i.test(validPath) ? async (p) => docxText(await fs.readFile(p), inflateRawSync) : null;
  if (Number.isInteger(args.offset) || Number.isInteger(args.limit)) {
    return said(lineRange(asWords ? await asWords(validPath) : await readFileContent(validPath), args));
  }
  if (asWords) return asWords === pdfText ? pdfRead(validPath, args) : said(await asWords(validPath));
  const content = args.tail ? await tailFile(validPath, args.tail)
    : args.head ? await headFile(validPath, args.head)
    : await readFileContent(validPath);
  return said(content);
};

// pure — a 1-based line range ({offset, limit}) with a header naming where it
// sits, so a being that searched for a line can read just its neighbourhood.
const lineRange = (text, { offset, limit }) => {
  const lines = text.split('\n');
  const from = Math.min(Math.max(1, Number.isInteger(offset) ? offset : 1), lines.length);
  const to = Number.isInteger(limit) && limit > 0 ? Math.min(lines.length, from + limit - 1) : lines.length;
  const more = to < lines.length ? `; continue at offset ${to + 1}` : '; end of file';
  return `[lines ${from}–${to} of ${lines.length}${more}]\n${lines.slice(from - 1, to).join('\n')}`;
};

const readMediaFile = async (args) => {
  const validPath = await readablePath(args.path);
  const mimeType = MEDIA_MIME_TYPES[path.extname(validPath).toLowerCase()] || 'application/octet-stream';
  const data = (await fs.readFile(validPath)).toString('base64');
  const contentItem = mimeType.startsWith('image/') ? { type: 'image', data, mimeType }
    : mimeType.startsWith('audio/') ? { type: 'audio', data, mimeType }
    : { type: 'resource', resource: { uri: pathToFileURL(validPath).href, mimeType, blob: data } };
  return { content: [contentItem], structuredContent: { content: [contentItem] } };
};

const readMultipleFiles = async (args) => {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (paths.length === 0) throw new Error('At least one file path must be provided');
  const results = await Promise.all(paths.map(async (filePath) => {
    try {
      const valid = await readablePath(filePath);
      // A batch read is a TEXT gesture — it joins many files into one string,
      // and an image has no place in that. Rather than returning the same
      // silent nothing the single read used to, it says what the file is and
      // names the one gesture that can show it.
      if (isSightablePath(valid)) {
        return `${filePath}: this is an image — read it on its own to look at it.\n`;
      }
      const content = await readFileContent(valid);
      return `${filePath}:\n${content}\n`;
    } catch (error) {
      return `${filePath}: Error - ${error instanceof Error ? error.message : String(error)}`;
    }
  }));
  return said(results.join('\n---\n'));
};

const writeFile = async (args) => {
  const validPath = await validatePath(args.path, getNativeFilesystemRoots());
  await writeFileContent(validPath, args.content);
  return said(`Successfully wrote to ${args.path}`);
};

const editFile = async (args) => {
  const validPath = await validatePath(args.path, getNativeFilesystemRoots());
  return said(await applyFileEdits(validPath, args.edits, args.dryRun ?? false));
};

const createDirectory = async (args) => {
  const validPath = await validatePath(args.path, getNativeFilesystemRoots());
  await fs.mkdir(validPath, { recursive: true });
  return said(`Successfully created directory ${args.path}`);
};

const listDirectory = async (args) => {
  const validPath = await validatePath(args.path, getNativeFilesystemRoots());
  const entries = await fs.readdir(validPath, { withFileTypes: true });
  if (entries.length === 0) {
    return said(`(empty directory — 0 entries at ${validPath}. The path exists and is readable. This is not a refusal, not a hidden folder, and not a policy deny.)`);
  }
  return said(entries
    .map((entry) => `${entry.isDirectory() ? '[DIR]' : '[FILE]'} ${entry.name}`)
    .join('\n'));
};


const listDirectoryWithSizes = async (args) => {
  const validPath = await validatePath(args.path, getNativeFilesystemRoots());
  const entries = await fs.readdir(validPath, { withFileTypes: true });
  const detailed = await Promise.all(entries.map(async (entry) => {
    const stats = await fs.stat(path.join(validPath, entry.name)).catch(() => null);
    return {
      name: entry.name,
      isDirectory: entry.isDirectory(),
      size: stats?.size ?? 0,
    };
  }));
  const sorted = [...detailed].sort((a, b) => (
    args.sortBy === 'size' ? b.size - a.size : a.name.localeCompare(b.name)
  ));
  const lines = sorted.map((entry) =>
    `${entry.isDirectory ? '[DIR]' : '[FILE]'} ${entry.name.padEnd(30)} ${entry.isDirectory ? '' : formatSize(entry.size).padStart(10)}`);
  const files = detailed.filter((e) => !e.isDirectory);
  const summary = [
    '',
    `Total: ${files.length} files, ${detailed.length - files.length} directories`,
    `Combined size: ${formatSize(files.reduce((sum, e) => sum + e.size, 0))}`,
  ];
  return said([...lines, ...summary].join('\n'));
};

// pure — the exclude semantics directory_tree has always walked with: a glob
// matches the relative path as written; a bare name matches at any depth.
const isExcluded = (relativePath, patterns) => patterns.some((pattern) => (
  pattern.includes('*')
    ? minimatch(relativePath, pattern, { dot: true })
    : minimatch(relativePath, pattern, { dot: true })
      || minimatch(relativePath, `**/${pattern}`, { dot: true })
      || minimatch(relativePath, `**/${pattern}/**`, { dot: true })
));

const directoryTree = async (args) => {
  const rootPath = args.path;
  const excludePatterns = Array.isArray(args.excludePatterns) ? args.excludePatterns : [];
  const buildTree = async (currentPath) => {
    const validPath = await validatePath(currentPath, getNativeFilesystemRoots());
    const entries = await fs.readdir(validPath, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      const relativePath = path.relative(rootPath, path.join(currentPath, entry.name));
      if (isExcluded(relativePath, excludePatterns)) continue;
      const entryData = { name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' };
      if (entry.isDirectory()) {
        entryData.children = await buildTree(path.join(currentPath, entry.name));
      }
      result.push(entryData);
    }
    return result;
  };
  return said(JSON.stringify(await buildTree(rootPath), null, 2));
};

const moveFile = async (args) => {
  const validSource = await validatePath(args.source, getNativeFilesystemRoots());
  const validDest = await validatePath(args.destination, getNativeFilesystemRoots());
  await fs.rename(validSource, validDest);
  return said(`Successfully moved ${args.source} to ${args.destination}`);
};

const copyFile = async (args) => {
  const validSource = await validatePath(args.source, getNativeFilesystemRoots());
  const validDest = await validatePath(args.destination, getNativeFilesystemRoots());
  await fs.cp(validSource, validDest, { recursive: true, errorOnExist: true, force: false, filter: (src) => !secretLinkReason(src) });
  return said(`Successfully copied ${args.source} to ${args.destination}`);
};


// search_files bounds — the name walk once had NONE: every entry re-crossed
// the wall one at a time, node_modules and .git included, every hit returned.
// A being's […] ran 37s over this repo
// alone and minutes over a home folder — the turn sat on […] (live 2026-09-25). Same cut law as content search: every cut is
// reported, never silent; an explicit excludePatterns (even []) replaces the
// default excludes.
const NAME_SEARCH = Object.freeze({ MAX_ENTRIES: 50000, MAX_RESULTS: 200 });

// impure (owner reads) — the sandbox judged only a search's root; a walk judges every entry, as named
// and as resolved, by the same deny law and the other-house wall, so a secret or another house's data is
// never read or listed. node_modules is denied as noise, not secret: excludePatterns opens it.
const withheldByPolicy = (...paths) => paths.some((p) => {
  const verdict = checkPathAccess(p);
  return (!verdict.allowed && verdict.deniedPattern !== 'node_modules/') || otherHouseInWalk(p);
});
const withheldNote = (n) => `[${n} path(s) withheld by the secret-path policy — never read or listed]`;

const searchFiles = async (args) => {
  const rootPath = await validatePath(args.path, getNativeFilesystemRoots());
  const pattern = nameSearchGlob(args.pattern);
  const excludePatterns = Array.isArray(args.excludePatterns) ? args.excludePatterns : CONTENT_SEARCH_EXCLUDES;
  const results = [];
  let walked = 0;
  let withheld = 0;
  let stopped = null;
  const walk = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (stopped) return;
      if (walked >= NAME_SEARCH.MAX_ENTRIES) { stopped = 'entries'; return; }
      walked += 1;
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootPath, fullPath);
      if (isExcluded(relativePath, excludePatterns)) continue;
      let validPath;
      try { validPath = await validatePath(fullPath, getNativeFilesystemRoots()); } catch { continue; }
      if (withheldByPolicy(...new Set([fullPath, validPath]))) { withheld += 1; continue; }
      if (minimatch(relativePath, pattern, { dot: true })) {
        results.push(fullPath);
        if (results.length >= NAME_SEARCH.MAX_RESULTS) { stopped = 'results'; return; }
      }
      if (entry.isDirectory()) await walk(validPath);
    }
  };
  await walk(rootPath);
  const notes = [];
  if (stopped === 'results') notes.push(`[stopped at ${NAME_SEARCH.MAX_RESULTS} matches — narrow the pattern or the path]`);
  if (stopped === 'entries') notes.push(`[stopped after walking ${NAME_SEARCH.MAX_ENTRIES} entries — search a narrower directory]`);
  if (withheld > 0) notes.push(withheldNote(withheld));
  if (excludePatterns.length > 0) {
    notes.push(`[excluded from this walk: ${excludePatterns.join(', ')} — pass excludePatterns: [] to search them]`);
  }
  const body = results.length > 0
    ? results.join('\n')
    : `No files matching ${JSON.stringify(args.pattern)} under ${rootPath} (searched as ${JSON.stringify(pattern)}). This is a name search, not grep — use fs/search with content: true for text inside files.`;
  return said([body, ...notes].join('\n'));
};

// search_content bounds — a grep that cannot become a resource sink: bounded
// file size, bounded results, bounded walk, truncated output lines. Every cut
// is reported in the result, never silent.
const CONTENT_SEARCH = Object.freeze({
  MAX_FILE_BYTES: 4 * 1024 * 1024,
  DEFAULT_MAX_RESULTS: 100,
  RESULT_CEILING: 500,
  MAX_FILES: 25000,
  MAX_LINE_CHARS: 300,
  BINARY_SNIFF_BYTES: 8192,
});
// Dependency and VCS internals drown every real match; an explicit
// excludePatterns (even []) replaces this default entirely.
const CONTENT_SEARCH_EXCLUDES = Object.freeze(['node_modules', '.git']);

// pure — one line-matcher from the pattern args; an invalid regex throws here
// and surfaces as the tool's isError result.
const buildLineMatcher = ({ pattern, regex, ignoreCase }) => {
  if (regex) {
    const re = new RegExp(pattern, ignoreCase ? 'i' : '');
    return (line) => re.test(line);
  }
  if (ignoreCase) {
    const needle = pattern.toLowerCase();
    return (line) => line.toLowerCase().includes(needle);
  }
  return (line) => line.includes(pattern);
};

const searchContent = async (args) => {
  if (typeof args.pattern !== 'string' || args.pattern.length === 0) {
    throw new Error('pattern must be a non-empty string');
  }
  const rootPath = await validatePath(args.path, getNativeFilesystemRoots());
  const matches = buildLineMatcher(args);
  const excludePatterns = Array.isArray(args.excludePatterns) ? args.excludePatterns : CONTENT_SEARCH_EXCLUDES;
  const maxResults = Math.min(Math.max(1, Math.trunc(args.maxResults) || CONTENT_SEARCH.DEFAULT_MAX_RESULTS), CONTENT_SEARCH.RESULT_CEILING);
  const hits = [];
  let oversize = 0;
  let withheld = 0;
  let scanned = 0;
  let stopped = null;

  const scanFile = async (filePath) => {
    const stats = await fs.stat(filePath).catch(() => null);
    if (!stats) return;
    if (stats.size > CONTENT_SEARCH.MAX_FILE_BYTES) { oversize += 1; return; }
    const buffer = await fs.readFile(filePath).catch(() => null);
    if (!buffer || buffer.subarray(0, CONTENT_SEARCH.BINARY_SNIFF_BYTES).includes(0)) return;
    const lines = buffer.toString('utf-8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!matches(lines[i])) continue;
      const line = lines[i].length > CONTENT_SEARCH.MAX_LINE_CHARS
        ? `${lines[i].slice(0, CONTENT_SEARCH.MAX_LINE_CHARS)}…` : lines[i];
      hits.push(`${filePath}:${i + 1}: ${line}`);
      if (hits.length >= maxResults) { stopped = 'results'; return; }
    }
  };

  const walk = async (dir) => {
    const entries = (await fs.readdir(dir, { withFileTypes: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (stopped) return;
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootPath, fullPath);
      if (isExcluded(relativePath, excludePatterns)) continue;
      // Symlinks are never followed (Dirent type checks) and every entry
      // re-crosses the wall — a link out of the roots is skipped exactly as
      // the name search skips it.
      let validPath;
      try { validPath = await validatePath(fullPath, getNativeFilesystemRoots()); } catch { continue; }
      if (withheldByPolicy(...new Set([fullPath, validPath]))) { withheld += 1; continue; }
      if (entry.isDirectory()) { await walk(validPath); continue; }
      if (!entry.isFile()) continue;
      if (args.filePattern && !minimatch(relativePath, args.filePattern, { dot: true })
        && !minimatch(entry.name, args.filePattern, { dot: true })) continue;
      if (scanned >= CONTENT_SEARCH.MAX_FILES) { stopped = 'files'; return; }
      scanned += 1;
      await scanFile(validPath);
    }
  };
  await walk(rootPath);

  const notes = [];
  if (stopped === 'results') notes.push(`[stopped at ${maxResults} matching lines — narrow the pattern or raise maxResults]`);
  if (stopped === 'files') notes.push(`[stopped after scanning ${CONTENT_SEARCH.MAX_FILES} files — search a narrower directory]`);
  if (oversize > 0) notes.push(`[skipped ${oversize} file(s) over ${formatSize(CONTENT_SEARCH.MAX_FILE_BYTES)}]`);
  if (withheld > 0) notes.push(withheldNote(withheld));
  if (excludePatterns.length > 0) {
    notes.push(`[excluded from this walk: ${excludePatterns.join(', ')} — an excluded folder is not empty; it was skipped by search policy]`);
  }
  const body = hits.length > 0 ? hits.join('\n') : `No matches found in ${rootPath}`;
  return said(notes.length > 0 ? [body, ...notes].join('\n') : body);

};

const getFileInfo = async (args) => {
  const info = await getFileStats(await validatePath(args.path, getNativeFilesystemRoots()));
  return said(Object.entries(info).map(([key, value]) => `${key}: ${value}`).join('\n'));
};

const listAllowedDirectories = async () =>
  said(`Allowed directories:\n${getNativeFilesystemRoots().join('\n')}`);

const HANDLERS = Object.freeze({
  read_file: readTextFile,
  read_text_file: readTextFile,
  read_media_file: readMediaFile,
  read_multiple_files: readMultipleFiles,
  write_file: writeFile,
  edit_file: editFile,
  create_directory: createDirectory,
  list_directory: listDirectory,
  list_directory_with_sizes: listDirectoryWithSizes,
  directory_tree: directoryTree,
  move_file: moveFile,
  copy_file: copyFile,

  search_files: searchFiles,
  search_content: searchContent,
  get_file_info: getFileInfo,
  list_allowed_directories: listAllowedDirectories,
});

// --- The client-shaped face --------------------------------------------------

/**
 * The organ wearing the face of a connected MCP Client — `callTool({name,
 * arguments})` and `close()` — so mcpService can hold it in the same clients
 * map and every consumer works identically whether a server is a process or
 * an organ. A failure is an `isError` RESULT (exactly how the SDK reports a
 * handler throw); there is no transport left to fail, so nothing here can
 * ever answer "Not connected".
 */
export const nativeFilesystemClient = Object.freeze({
  // impure — executes real filesystem operations behind lib.js validation
  async callTool({ name, arguments: args }) {
    const handler = HANDLERS[name];
    if (!handler) return refused(`Unknown filesystem tool: ${name}`);
    try {
      return await handler(args ?? {});
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      if (/\bENOENT\b/.test(raw) || /no such file/i.test(raw)) {
        return refused(`${raw} — the path does not exist. This is not a policy deny and not an ignored folder.`);
      }
      if (/Access denied/i.test(raw) && /outside allowed/i.test(raw)) {
        return refused(`${raw} — the path exists or not, you may not reach it from this ground. This is a grant wall, not an empty folder.`);
      }
      // THE THIRD WALL (ruling, 2026-08-30). The two above are the platform's own
      // and can be appealed to the operator; this one cannot. A being watching
      // `/root/Downloads` fail with a bare EACCES re-listed its roots, saw the
      // folder still granted, and tried the same path again — reasonable both
      // times, because nothing said which wall had refused.
      if (/\b(EACCES|EPERM)\b/.test(raw) || /permission denied/i.test(raw)) {
        return refused(`${raw} — this is the OPERATING SYSTEM refusing, not a missing grant. `
          + `${runningAs()} has no permission on that path, so asking your operator for access `
          + 'cannot open it and retrying will fail identically. Say so plainly; if you were '
          + 'guessing at the path, ask for one they can actually reach.');
      }
      return refused(raw);
    }
  },

  async close() {
    // Emptying the roots refuses every path from here on: the organ is closed,
    // and the wall it leaves behind must not admit anything.
    await setNativeFilesystemRoots([]);
  },
});
