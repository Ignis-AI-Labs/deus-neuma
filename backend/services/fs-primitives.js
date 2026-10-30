/**
 * THE FS PRIMITIVES — the whole filesystem surface a being ever sees, collapsed
 * to five: fs/read, fs/write, fs/edit, fs/list, fs/search.
 *
 * Stage 3 batch 3 of docs/planning/proposals/being-tool-surface-primitives.md
 * (#357). The 16 organ names (read_file … search_content) become INTERNAL: the
 * organ's catalog and handlers are untouched, the sandbox still confines and
 * journals the real names, and this module is the only translation layer —
 * being-facing name + args in, organ name + args out. A being that reaches for
 * a retired spelling gets a plain hint naming the primitive, not a bare
 * "unavailable" (FS_RETIRED_HINTS).
 *
 * One carve-out with the force of law: a delete is irreversible, so
 * fs/edit {delete:true} keeps its OWN policy identity — `fsPolicyTarget` maps
 * it to the surviving `filesystem/delete_file` requireApproval row, and the
 * operator's card and ALWAYS grant land on exactly that row.
 *
 * Pure, except withFsRouting which is as impure as the callTool it wraps.
 */

const PATH_ALIASES = Object.freeze(['path', 'file', 'filepath', 'file_path', 'filename']);
const DIR_ALIASES = Object.freeze(['path', 'directory', 'dir', 'folder', 'location']);
const CONTENT_ALIASES = Object.freeze(['content', 'text', 'body', 'contents', 'data']);

// The organ reads these as image/audio content blocks (native-filesystem.js
// MEDIA_MIME_TYPES) — fs/read routes them to the media hand by extension.
// SVG is source text: the vision bridge cannot consume image/svg+xml blocks.
const MEDIA_EXTS = Object.freeze(new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
  '.mp3', '.wav', '.ogg', '.flac',
]));

const firstString = (args, keys) => {
  for (const k of keys) {
    const v = args?.[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
};

const mediaExt = (p) => {
  const i = p.lastIndexOf('.');
  return i > 0 ? p.slice(i).toLowerCase() : '';
};

const ok = (tool, args) => ({ ok: true, server: 'filesystem', tool, args });
const fail = (error) => ({ ok: false, error });

const routeRead = (args) => {
  if (Array.isArray(args?.paths) && args.paths.length > 0) {
    return ok('read_multiple_files', { paths: args.paths.filter((p) => typeof p === 'string' && p) });
  }
  const p = firstString(args, PATH_ALIASES);
  if (!p) return fail('fs/read needs a path — {"path": "..."} for one file, {"paths": [...]} for several');
  if (args.info === true) return ok('get_file_info', { path: p });
  if (MEDIA_EXTS.has(mediaExt(p))) return ok('read_media_file', { path: p });
  const extra = {};
  if (Number.isInteger(args.head)) extra.head = args.head;
  if (Number.isInteger(args.tail)) extra.tail = args.tail;
  if (Number.isInteger(args.offset)) extra.offset = args.offset;
  if (Number.isInteger(args.limit)) extra.limit = args.limit;
  if (typeof args.pages === 'string' || Number.isInteger(args.pages)) extra.pages = String(args.pages);
  return ok('read_text_file', { path: p, ...extra });
};

const routeWrite = (args) => {
  const p = firstString(args, [...PATH_ALIASES, ...DIR_ALIASES.slice(1)]);
  if (!p) return fail('fs/write needs a path — {"path": "...", "content": "..."}');
  if (args.directory === true || p.endsWith('/')) return ok('create_directory', { path: p });
  const content = firstString(args, CONTENT_ALIASES);
  if (content === null) {
    return fail('fs/write needs content — {"path": "...", "content": "..."}. For a directory: {"path": "...", "directory": true}');
  }
  return ok('write_file', { path: p, content });
};

const routeEdit = (args) => {
  const p = firstString(args, [...PATH_ALIASES, 'source', 'from', 'src']);
  if (args?.delete === true) {
    return p ? ok('delete_file', { path: p }) : fail('fs/edit delete needs a path — {"path": "...", "delete": true}');
  }
  const dest = firstString(args, ['destination', 'to', 'target']);
  if (dest) {
    if (!p) return fail('fs/edit move/copy needs the source path — {"path": "...", "destination": "..."}');
    return ok(args.copy === true ? 'copy_file' : 'move_file', { source: p, destination: dest });
  }
  if (Array.isArray(args?.edits)) {
    if (!p) return fail('fs/edit needs a path — {"path": "...", "edits": [...]}');
    const out = { path: p, edits: args.edits };
    if (args.dryRun === true) out.dryRun = true;
    return ok('edit_file', out);
  }
  return fail('fs/edit needs one of: {"path", "edits": [{"oldText", "newText"}]}, {"path", "destination"} (move), {"path", "destination", "copy": true}, or {"path", "delete": true} (asks your operator)');
};

const routeList = (args) => {
  const p = firstString(args, DIR_ALIASES);
  if (!p || p === 'roots') return ok('list_allowed_directories', {});
  if (args.tree === true) {
    const out = { path: p };
    if (Array.isArray(args.excludePatterns)) out.excludePatterns = args.excludePatterns;
    return ok('directory_tree', out);
  }
  if (args.sizes === true) {
    const out = { path: p };
    if (args.sortBy === 'size' || args.sortBy === 'name') out.sortBy = args.sortBy;
    return ok('list_directory_with_sizes', out);
  }
  return ok('list_directory', { path: p });
};

const routeSearch = (args) => {
  const pattern = firstString(args, ['pattern', 'query', 'text', 'name', 'term', 'glob']);
  if (!pattern) return fail('fs/search needs a pattern — {"pattern": "..."} matches NAMES; add "content": true to grep INSIDE files');
  const p = firstString(args, DIR_ALIASES);
  if (args.content === true) {
    const out = { pattern };
    if (p) out.path = p;
    if (args.regex === true) out.regex = true;
    if (args.ignoreCase === true) out.ignoreCase = true;
    if (typeof args.filePattern === 'string' && args.filePattern) out.filePattern = args.filePattern;
    if (Array.isArray(args.excludePatterns)) out.excludePatterns = args.excludePatterns;
    if (Number.isInteger(args.maxResults)) out.maxResults = args.maxResults;
    return ok('search_content', out);
  }
  const out = { pattern };
  if (p) out.path = p;
  if (Array.isArray(args.excludePatterns)) out.excludePatterns = args.excludePatterns;
  return ok('search_files', out);
};

const ROUTERS = Object.freeze({
  read: routeRead, write: routeWrite, edit: routeEdit, list: routeList, search: routeSearch,
});

/**
 * Translate one being-facing call into the organ call that executes it. Pure.
 * Non-fs calls pass through untouched, so the wrapper below can sit on the
 * whole sandboxed-call path. A malformed fs call is a ROUTING refusal — it
 * never reaches the sandbox or the organ.
 * @param {string} serverName
 * @param {string} toolName
 * @param {Object} [args]
 * @returns {{ok: true, server: string, tool: string, args: Object} | {ok: false, error: string}}
 */
export const routeFsCall = (serverName, toolName, args = {}) => {
  if (serverName !== 'fs') return { ok: true, server: serverName, tool: toolName, args };
  const router = ROUTERS[toolName];
  if (!router) return fail(`fs/${toolName} is not a tool — the fs tools are: fs/read, fs/write, fs/edit, fs/list, fs/search`);
  return router(args && typeof args === 'object' ? args : {});
};

// A directory handed to the text reader comes back from the organ as a raw
// EISDIR — name the hand the being actually wanted instead of leaving it to
// guess from a syscall message.
const EISDIR_HINT = '— that is a directory, not a file. Use fs/list {"path": "..."} to see inside it';

/**
 * Wrap a sandboxed callTool(server, tool, args) so fs/* calls route to the
 * organ INSIDE the sandbox — confinement, budget, journal, and the encoding
 * wall all judge the routed call exactly as they judged the old names.
 * Routing refusals return an organ-shaped isError result, never a throw, so
 * the lane reports them like any server refusal.
 */
export const withFsRouting = (callTool) => async (serverName, toolName, args = {}) => {
  const routed = routeFsCall(serverName, toolName, args);
  if (!routed.ok) return { isError: true, content: [{ type: 'text', text: routed.error }] };
  const result = await callTool(routed.server, routed.tool, routed.args);
  if (routed.tool === 'read_text_file' && result?.isError) {
    const text = (result.content || []).map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n');
    if (/EISDIR|illegal operation on a directory/i.test(text)) {
      return { isError: true, content: [{ type: 'text', text: `${text} ${EISDIR_HINT}` }] };
    }
  }
  return result;
};

/**
 * The policy identity of a call. Everything fs/* resolves under the `fs`
 * server rows EXCEPT the delete sub-op: fs/edit {delete:true} is the
 * irreversible act, and it keeps the `filesystem/delete_file`
 * requireApproval row so the card and any ALWAYS grant say "delete" — never
 * a blanket edit grant silently covering deletes. Pure.
 */
export const fsPolicyTarget = (serverName, toolName, args) =>
  (serverName === 'fs' && toolName === 'edit' && args?.delete === true
    ? { server: 'filesystem', tool: 'delete_file' }
    : { server: serverName, tool: toolName });

/** The retired organ spellings, each mapped to the primitive that absorbed it. */
export const FS_RETIRED_HINTS = Object.freeze({
  read_file: 'read_file is retired — use fs/read {"path": "..."}',
  read_text_file: 'read_text_file is retired — use fs/read {"path": "..."} ("head"/"tail" for a slice)',
  read_media_file: 'read_media_file is retired — use fs/read {"path": "..."} (image/audio returns as media)',
  read_multiple_files: 'read_multiple_files is retired — use fs/read {"paths": ["...", "..."]}',
  get_file_info: 'get_file_info is retired — use fs/read {"path": "...", "info": true}',
  write_file: 'write_file is retired — use fs/write {"path": "...", "content": "..."}',
  create_directory: 'create_directory is retired — use fs/write {"path": "...", "directory": true}',
  edit_file: 'edit_file is retired — use fs/edit {"path": "...", "edits": [{"oldText": "...", "newText": "..."}]}',
  move_file: 'move_file is retired — use fs/edit {"path": "...", "destination": "..."}',
  copy_file: 'copy_file is retired — use fs/edit {"path": "...", "destination": "...", "copy": true}',
  delete_file: 'delete_file is retired — use fs/edit {"path": "...", "delete": true} (asks your operator)',
  list_directory: 'list_directory is retired — use fs/list {"path": "..."}',
  list_directory_with_sizes: 'list_directory_with_sizes is retired — use fs/list {"path": "...", "sizes": true}',
  directory_tree: 'directory_tree is retired — use fs/list {"path": "...", "tree": true}',
  list_allowed_directories: 'list_allowed_directories is retired — use fs/list {} (or {"path": "roots"})',
  search_files: 'search_files is retired — use fs/search {"path": "...", "pattern": "..."}',
  search_content: 'search_content is retired — use fs/search {"path": "...", "pattern": "...", "content": true}',
});

/** The hint for a retired spelling, or null for a name that never was an fs tool. Pure. */
export const fsRetiredHint = (toolName) => FS_RETIRED_HINTS[toolName] || null;

const fsTool = (name, description, properties) => Object.freeze({
  server: 'fs',
  name,
  description,
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze(properties) }),
});

const STR = Object.freeze({ type: 'string' });

/** The five — the entire being-facing filesystem catalog. */
export const FS_PRIMITIVE_TOOLS = Object.freeze([
  fsTool('read',
    'Read a file. {"path"} reads it as text (PDFs and Word .docx as their words — a PDF\'s scanned pages are put in front of your eyes as images, and "pages": "N-M" picks a PDF\'s pages; SVG returns source XML; raster image/audio paths return as media; '
    + '{"path", "info": true} returns size/timestamps instead of content). {"paths": [...]} reads several at once. '
    + 'Read only what you need: "offset"/"limit" read a line range (find the lines first with fs/search content: true); '
    + '"whole": true reads ALL of it when someone asks for the whole document — you are told if it does not fit the room left.',
    {
      path: STR,
      paths: Object.freeze({ type: 'array', items: STR, description: 'Read several files in one call' }),
      head: Object.freeze({ type: 'number', description: 'Only the first N lines' }),
      tail: Object.freeze({ type: 'number', description: 'Only the last N lines' }),
      offset: Object.freeze({ type: 'integer', description: 'First line to read (1-based)' }),
      limit: Object.freeze({ type: 'integer', description: 'How many lines to read from offset' }),
      pages: Object.freeze({ type: 'string', description: 'A PDF\'s pages to read: "3" or "3-6"' }),
      whole: Object.freeze({ type: 'boolean', description: 'Read the entire file (when the whole document is asked for)' }),
      info: Object.freeze({ type: 'boolean', description: 'Metadata (size, modified) instead of content' }),
    }),
  fsTool('write',
    'Write a file — creates or fully overwrites. {"path", "content"}. For a directory: {"path", "directory": true}. '
    + 'Your own lane is always yours to write; paths outside it ask your operator.',
    {
      path: STR,
      content: Object.freeze({ type: 'string', description: 'The full text the file will hold' }),
      directory: Object.freeze({ type: 'boolean', description: 'Create the path as a directory instead' }),
    }),
  fsTool('edit',
    'Change what exists: {"path", "edits": [{"oldText", "newText"}]} rewrites exact passages; {"path", "destination"} moves. '
    + '{"path", "delete": true} deletes ONE file — irreversible, asks your operator each time until they grant ALWAYS.',
    {
      path: STR,
      edits: Object.freeze({
        type: 'array',
        items: Object.freeze({
          type: 'object',
          properties: Object.freeze({
            oldText: Object.freeze({ type: 'string', description: 'Text to search for — must match exactly' }),
            newText: Object.freeze({ type: 'string', description: 'Text to replace it with' }),
          }),
          required: Object.freeze(['oldText', 'newText']),
        }),
      }),
      dryRun: Object.freeze({ type: 'boolean', description: 'Preview the diff without writing' }),
      destination: STR,
      copy: Object.freeze({ type: 'boolean', description: 'Copy to destination instead of moving' }),
      delete: Object.freeze({ type: 'boolean', description: 'Delete the file at path (asks your operator)' }),
    }),
  fsTool('list',
    'See inside a directory: {"path"} names its entries ([FILE]/[DIR]); "sizes": true adds sizes; "tree": true recurses. '
    + 'No path (or "roots") lists the folders you may reach.',
    {
      path: Object.freeze({ type: 'string', description: 'Directory to list — omit (or "roots") for your reachable folders' }),
      sizes: Object.freeze({ type: 'boolean', description: 'Include entry sizes' }),
      tree: Object.freeze({ type: 'boolean', description: 'Recurse into subdirectories' }),
      excludePatterns: Object.freeze({ type: 'array', items: STR, description: 'Names/globs to skip (tree only)' }),
    }),
  fsTool('search',
    'Find by NAME (glob, recursive): {"path", "pattern"}. Add "content": true to search INSIDE files — '
    + 'faster than walking directories when you know the text but not the file.',
    {
      path: Object.freeze({ type: 'string', description: 'Where to search — defaults to your ground' }),
      pattern: Object.freeze({ type: 'string', description: 'Name glob, or the text to find when content is true' }),
      content: Object.freeze({ type: 'boolean', description: 'Search INSIDE files instead of by name' }),
      regex: Object.freeze({ type: 'boolean', description: 'Treat the pattern as a regular expression (content mode)' }),
      ignoreCase: Object.freeze({ type: 'boolean', description: 'Case-insensitive (content mode)' }),
      filePattern: Object.freeze({ type: 'string', description: 'Only scan files matching this glob (content mode)' }),
      maxResults: Object.freeze({ type: 'number', description: 'Stop after this many matching lines (content mode)' }),
    }),
]);

/**
 * The being-facing transform of the organ's catalog: every `filesystem` entry
 * is internal now — out — and the five primitives stand in their place.
 * Callers add the platform's own filesystem-server tools (request_file_access)
 * separately, exactly as before. Pure.
 */
/**
 * THE NAMING HOLDS ONE ACT (Design note, 2026-10-14: a naming stage listed a folder
 * […] and reasoned for minutes): the naming is offered
 * the write hand alone — the name is written, nothing is explored. Pure.
 */
export const namingTools = (tools) => (tools || []).filter((t) => t?.server === 'fs' && t?.name === 'write');

export const withFsPrimitives = (tools) => [
  ...(tools || []).filter((t) => t?.server !== 'filesystem'),
  ...FS_PRIMITIVE_TOOLS,
];
