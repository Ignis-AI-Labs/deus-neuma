// XPostLink — a post id renders as the permalink to the real X post (the
// operator's manual double-check, Design note, 2026-08-28; no id renders as plain
// text in the host's own register, never a dead anchor. Leaf: imports the
// pure helper, imports neither card.

import { xPostUrl } from './campaigns-helpers.js';

export const XPostLink = ({ postId, className, children }) => {
  const url = xPostUrl(postId);
  const cls = [className, url ? 'queue-preview-link' : null].filter(Boolean).join(' ');
  return url ? (
    <a className={cls} href={url} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <span className={cls}>{children}</span>
  );
};
