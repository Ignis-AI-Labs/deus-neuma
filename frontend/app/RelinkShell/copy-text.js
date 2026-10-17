// copy-text — the copyable prose of a message's segments (pure; the
// CopyWord component renders it, this module decides it). Chips (acts,
// approvals, asks), images, and UI segments never enter the clipboard —
// a copied reply pastes as words, not as interface debris.

/** The copyable prose of a message's segments. Pure. */
export const speechText = (segments = []) => segments
  .filter((s) => s && typeof s.text === 'string' && (s.kind === undefined || s.kind === 'speech'))
  .map((s) => s.text)
  .join('')
  .trim();

/**
 * The raw text of a fenced code block's hast node (react-markdown's `pre`
 * override). No highlighter runs on this desk, so a block's `code` element
 * holds plain text children — anything shaped otherwise is not ours to copy
 * and answers ''. One trailing newline is trimmed: the fence's own closing
 * break is structure, not words. Pure.
 * @param {object|null} node - the pre element's hast node
 * @returns {string}
 */
export const codeBlockText = (node) => {
  const children = node?.children?.[0]?.children;
  if (!Array.isArray(children)) return '';
  return children.map((c) => (typeof c?.value === 'string' ? c.value : '')).join('')
    .replace(/\n$/, '');
};
