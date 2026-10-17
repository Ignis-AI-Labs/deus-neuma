// Pure projection for known filesystem schemas. File content is data, not reach.
import { routeFsCall } from './fs-primitives.js';
import { normalizeToolArgs, collectPathArgs } from './sandbox-path-policy.js';

const FILESYSTEM_TOOLS = new Set([
  'read_file', 'read_text_file', 'read_media_file', 'read_multiple_files',
  'get_file_info', 'write_file', 'edit_file', 'create_directory', 'copy_file',
  'move_file', 'rename_file', 'delete_file', 'list_directory',
  'list_directory_with_sizes', 'directory_tree', 'list_allowed_directories',
  'search_files', 'search_content',
]);

/** Return normalized actual target paths, or null for an unknown tool schema.
 * Unknown schemas retain the caller's conservative whole-argument check. Pure. */
export const filesystemTargets = (server, tool, args) => {
  if (server !== 'fs' && (server !== 'filesystem' || !FILESYSTEM_TOOLS.has(tool))) return null;
  const routed = routeFsCall(server, tool, args);
  if (!routed.ok) return null;
  const normalized = normalizeToolArgs(routed.tool, routed.args);
  // Legacy off-name target attempts still fail closed; do not inspect content,
  // edit strings or search patterns as if they were filesystem destinations.
  const extra = server === 'filesystem' && typeof args?.target === 'string' ? [args.target] : [];
  return [...collectPathArgs(normalized), ...extra];
};
