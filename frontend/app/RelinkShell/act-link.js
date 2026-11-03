// act-link — which act chips lead somewhere when clicked (Design note, 2026-07-23:
// […]). A chip
// whose tool addresses a FILE links its path to the desk's editor; directory
// acts (list/search/create) and legacy moves' stale sources stay plain text.
// Direct transfers carry their destination. A link must land where it points.

const FILE_TOOLS = new Set([
  'write', 'edit', 'read', 'copy', 'move', // the fs primitives; transfers carry their destination
  'write_file', 'edit_file', 'read_file', 'read_text_file', 'get_file_info', // retired spellings (council frames, old records)
]);

/**
 * The editor-openable file behind an act chip, or null when the chip's
 * target is not a file that stands at that path.
 * @param {string} label - the chip's tool name (as the wire carried it)
 * @param {string} path - the chip's target path
 * @returns {string|null}
 */
export const actFilePath = (label, path) => {
  if (!path || typeof path !== 'string') return null;
  return FILE_TOOLS.has(String(label || '').toLowerCase()) ? path : null;
};
