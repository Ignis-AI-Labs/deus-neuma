/**
 * THE FILESYSTEM TOOL CATALOG — the file tools the platform advertises: the
 * pinned package's 14, plus the organ's own native additions.
 *
 * For the package's 14, names, descriptions, and argument shapes are VERBATIM
 * from @modelcontextprotocol/server-filesystem dist/index.js registrations.
 * That is load-bearing: these strings are what every being's prompt has
 * carried since birth — a changed description is a changed tool surface to a
 * mind that learned the old one. Entries marked NATIVE ADDITION are the
 * organ's own and carry no upstream contract. Handlers live in
 * native-filesystem.js.
 *
 * pure data.
 */

const PATH_ARG = Object.freeze({ type: 'string' });

const tool = (name, title, description, properties, required, annotations) =>
  Object.freeze({
    name,
    title,
    description,
    inputSchema: Object.freeze({ type: 'object', properties, required }),
    annotations,
  });

const READ_ONLY = Object.freeze({ readOnlyHint: true, openWorldHint: false });

export const FILESYSTEM_TOOL_CATALOG = Object.freeze([
  tool('read_file', 'Read File (Deprecated)',
    'DEPRECATED: use read_text_file — it is the one read, and it shows you images too. '
    + 'This is the same handler under an older name.',
    {
      path: PATH_ARG,
      tail: { type: 'number', description: 'If provided, returns only the last N lines of the file' },
      head: { type: 'number', description: 'If provided, returns only the first N lines of the file' },
    }, ['path'], READ_ONLY),

  // ONE VERB FOR "READ THIS PATH" (Design note, 2026-08-29: […]). A being should not have to know that pictures live
  // behind a different verb than text — it asks to read a path, and the file
  // decides what that means.
  tool('read_text_file', 'Read File',
    'Read a file. Text comes back as text. An IMAGE (.png/.jpg/.jpeg/.webp) is '
    + 'placed in front of your eyes instead — you will be looking at it on your next '
    + 'turn, so simply read it and then say what you see. Do not ask for a different '
    + 'tool to view an image, and do not describe an image before it has arrived. '
    + 'Handles various text encodings and gives detailed error messages if the file '
    + 'cannot be read. Use the \'head\' parameter to read only the first N lines, or '
    + '\'tail\' for the last N (both are ignored for images). '
    + 'Only works within allowed directories.',
    {
      path: PATH_ARG,
      tail: { type: 'number', description: 'If provided, returns only the last N lines of the file' },
      head: { type: 'number', description: 'If provided, returns only the first N lines of the file' },
    }, ['path'], READ_ONLY),

  tool('read_media_file', 'Read Media File (Deprecated)',
    'DEPRECATED: use read_text_file for everything, including images — it shows you '
    + 'the picture. This returns raw base64 you cannot see, and exists only for audio '
    + 'and other non-image media. Only works within allowed directories.',
    { path: PATH_ARG }, ['path'], READ_ONLY),

  tool('read_multiple_files', 'Read Multiple Files',
    'Read the contents of multiple files simultaneously. This is more '
    + 'efficient than reading files one by one when you need to analyze '
    + 'or compare multiple files. Each file\'s content is returned with its '
    + 'path as a reference. Failed reads for individual files won\'t stop '
    + 'the entire operation. Only works within allowed directories.',
    {
      paths: {
        type: 'array', items: { type: 'string' }, minItems: 1,
        description: 'Array of file paths to read. Each path must be a string pointing to a valid file within allowed directories.',
      },
    }, ['paths'], READ_ONLY),

  tool('write_file', 'Write File',
    'Create a NEW file. Existing paths are refused: use edit_file for small changes. '
    + 'A deliberate whole-file replacement requires overwrite:true plus expectedMtimeMs '
    + 'from get_file_info, and writes nothing if the file changed. Only works within allowed directories.',
    {
      path: PATH_ARG,
      content: { type: 'string' },
      overwrite: { type: 'boolean', description: 'Explicit whole-file replacement only' },
      expectedMtimeMs: { type: 'number', description: 'Current mtimeMs from get_file_info; required with overwrite' },
    }, ['path', 'content'],
    Object.freeze({ readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false })),

  tool('edit_file', 'Edit File',
    'Make line-based edits to a text file. Each edit replaces exact line sequences '
    + 'with new content. Returns a git-style diff showing the changes made. '
    + 'Only works within allowed directories.',
    {
      path: PATH_ARG,
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            oldText: { type: 'string', description: 'Text to search for - must match exactly' },
            newText: { type: 'string', description: 'Text to replace with' },
          },
          required: ['oldText', 'newText'],
        },
      },
      dryRun: { type: 'boolean', default: false, description: 'Preview changes using git-style diff format' },
    }, ['path', 'edits'],
    Object.freeze({ readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false })),

  tool('create_directory', 'Create Directory',
    'Create a new directory or ensure a directory exists. Can create multiple '
    + 'nested directories in one operation. If the directory already exists, '
    + 'this operation will succeed silently. Perfect for setting up directory '
    + 'structures for projects or ensuring required paths exist. Only works within allowed directories.',
    { path: PATH_ARG }, ['path'],
    Object.freeze({ readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false })),

  tool('list_directory', 'List Directory',
    'Get a detailed listing of all files and directories in a specified path. '
    + 'Results clearly distinguish between files and directories with [FILE] and [DIR] '
    + 'prefixes. This tool is essential for understanding directory structure and '
    + 'finding specific files within a directory. Only works within allowed directories.',
    { path: PATH_ARG }, ['path'], READ_ONLY),

  tool('list_directory_with_sizes', 'List Directory with Sizes',
    'Get a detailed listing of all files and directories in a specified path, including sizes. '
    + 'Results clearly distinguish between files and directories with [FILE] and [DIR] '
    + 'prefixes. This tool is useful for understanding directory structure and '
    + 'finding specific files within a directory. Only works within allowed directories.',
    {
      path: PATH_ARG,
      sortBy: { type: 'string', enum: ['name', 'size'], default: 'name', description: 'Sort entries by name or size' },
    }, ['path'], READ_ONLY),

  tool('directory_tree', 'Directory Tree',
    'Get a recursive tree view of files and directories as a JSON structure. '
    + 'Each entry includes \'name\', \'type\' (file/directory), and \'children\' for directories. '
    + 'Files have no children array, while directories always have a children array (which may be empty). '
    + 'The output is formatted with 2-space indentation for readability. Only works within allowed directories.',
    {
      path: PATH_ARG,
      excludePatterns: { type: 'array', items: { type: 'string' }, default: [] },
    }, ['path'], READ_ONLY),

  tool('move_file', 'Move File',
    'Move or rename files and directories. Can move files between directories '
    + 'and rename them in a single operation. If the destination exists, the '
    + 'operation will fail. Works across different directories and can be used '
    + 'for simple renaming within the same directory. Both source and destination must be within allowed directories.',
    { source: { type: 'string' }, destination: { type: 'string' } }, ['source', 'destination'],
    Object.freeze({ readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false })),

  // NATIVE ADDITION — move relocates; copy keeps the source. Dest must not exist
  // (same refuse as move). Both paths grantable.
  tool('copy_file', 'Copy File',
    'Copy a file or directory to a new path. The source stays where it is. '
    + 'If the destination exists, the operation fails — delete first (that asks '
    + 'your operator), then copy. Both source and destination must be within '
    + 'allowed directories. Prefer this over read+write when moving work between folders.',
    { source: { type: 'string' }, destination: { type: 'string' } }, ['source', 'destination'],
    Object.freeze({ readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false })),


  tool('search_files', 'Search Files',
    'Recursively search for files and directories matching a pattern. '
    + 'The patterns should be glob-style patterns that match paths relative to the working directory. '
    + 'Use pattern like \'*.ext\' to match files in current directory, and \'**/*.ext\' to match files in all subdirectories. '
    + 'Returns full paths to all matching items. Great for finding files when you don\'t know their exact location. '
    + 'Only searches within allowed directories.',
    {
      path: PATH_ARG,
      pattern: { type: 'string' },
      excludePatterns: { type: 'array', items: { type: 'string' }, default: [] },
    }, ['path', 'pattern'], READ_ONLY),

  // NATIVE ADDITION (2026-08-16) — not from the pinned package. search_files
  // finds files by NAME; nothing could find text INSIDE them, so beings
  // walked directories guessing. This is the organ's grep.
  tool('search_content', 'Search Content',
    'Search for text INSIDE files — the grep of the filesystem tools. '
    + 'Recursively scans files under a directory for a literal string (the default) '
    + 'or a JavaScript regular expression (set regex to true), returning each match as '
    + 'path:line: text. Use search_files to find files by NAME; use this to find where '
    + 'code or content lives when you don\'t know which file holds it. Binary files and '
    + 'files over 4 MB are skipped; node_modules and .git are excluded unless '
    + 'excludePatterns is provided explicitly. Only searches within allowed directories.',
    {
      path: PATH_ARG,
      pattern: { type: 'string', description: 'Text to find inside files — a literal string unless regex is true' },
      regex: { type: 'boolean', default: false, description: 'Treat pattern as a JavaScript regular expression' },
      ignoreCase: { type: 'boolean', default: false, description: 'Match without case sensitivity' },
      filePattern: { type: 'string', description: 'Only scan files whose name or relative path matches this glob, e.g. \'*.js\'' },
      excludePatterns: { type: 'array', items: { type: 'string' }, description: 'Names or globs to skip; replaces the node_modules/.git default when provided' },
      maxResults: { type: 'number', default: 100, description: 'Stop after this many matching lines (hard ceiling 500)' },
    }, ['path', 'pattern'], READ_ONLY),

  tool('get_file_info', 'Get File Info',
    'Retrieve detailed metadata about a file or directory. Returns comprehensive '
    + 'information including size, creation time, last modified time, permissions, '
    + 'and type. This tool is perfect for understanding file characteristics '
    + 'without reading the actual content. Only works within allowed directories.',
    { path: PATH_ARG }, ['path'], READ_ONLY),

  tool('list_allowed_directories', 'List Allowed Directories',
    'Returns the list of directories that this server is allowed to access. '
    + 'Subdirectories within these allowed directories are also accessible. '
    + 'Use this to understand which directories and their nested paths are available '
    + 'before trying to access files.',
    {}, [], READ_ONLY),
]);
