// Markdown — renders the consciousness's speech with formatting.
//
// react-markdown parses to React nodes (never raw HTML — XSS-safe by
// default, satisfying CLAUDE.md Rule 8), so bold/italic/lists/code/links
// from the stream render correctly while model output can never inject
// markup. remark-gfm carries the rest of what a substrate reaches for when
// it lays out thought — tables, strikethrough, task lists, autolinks —
// so structure arrives as structure, not as a wall of pipes. Links open
// in a new tab, severed from this window's context.

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderLatexSymbols } from '../../utils/latex-symbols.js';
import { softenBreakTags } from '../../utils/markdown-breaks.js';
import { openablePath } from './path-link.js';
import { openPathMenu, pathMenuAnchor } from './path-menu.js';
import { CopyWord } from './copy-word.jsx';
import { codeBlockText } from './copy-text.js';
import './RelinkMarkdown.css';


const PLUGINS = [remarkGfm];

// A code span whose whole content is an absolute path is a DOOR (Founder,
// 2026-07-26). DELIBERATE (Design note, 2026-10-06: right-click — or Ctrl/⌘+click,
// or Ctrl+Enter — raises the path's menu (open the file, show it in the file
// manager, copy it, or focus its folder); a plain click still just selects, so
// copying a path works as before, and nothing moves the window's focus unless
// that menu item is chosen. The desk host owns the menu (PathOpener.jsx).

const PathSpan = ({ path, children, ...props }) => (
  <code
    {...props}
    className="relink-md-path"
    role="link"
    tabIndex={0}
    title={`${path}\nRight-click (or Ctrl+click) for options`}
    onContextMenu={(e) => { e.preventDefault(); openPathMenu(path, e.clientX, e.clientY); }}
    onClick={(e) => {
      if (!e.ctrlKey && !e.metaKey) return; // a plain click still just selects
      e.preventDefault();
      openPathMenu(path, e.clientX, e.clientY);
    }}
    onKeyDown={(e) => {
      if (!(e.key === 'ContextMenu' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey)))) return;
      e.preventDefault();
      openPathMenu(path, ...pathMenuAnchor(e.currentTarget));
    }}
  >
    {children}
  </code>
);

const COMPONENTS = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  // A fenced block carries its own COPY (Design note, 2026-08-27: […]) — the whole-reply COPY takes
  // the framing prose with it; the block alone is what pastes into the room
  // it was written for. Hover-revealed, same register as the message's own.
  pre: ({ node, children, ...props }) => (
    <div className="relink-md-block">
      <pre {...props}>{children}</pre>
      <CopyWord text={codeBlockText(node)} className="relink-md-blockcopy" />
    </div>
  ),
  code: ({ node, children, ...props }) => {
    // Only the whole-span-is-one-path case becomes a door; everything else is
    // an ordinary code span. A link that sometimes lands somewhere wrong is
    // worse than plain text, so the decision stays narrow (path-link.js).
    const path = openablePath(
      Array.isArray(children) ? children.join('') : children,
    );
    if (!path) return <code {...props}>{children}</code>;
    return <PathSpan path={path} {...props}>{children}</PathSpan>;
  },
};

// LaTeX symbol spans become their Unicode glyphs BEFORE markdown parsing —
// the being means the arrow, and code spans are left literal inside the
// converter (fenced/inline code is never math). <br> tags become markdown's
// own breaks the same way (softenBreakTags) — intent honored, HTML door shut.
const MarkdownView = ({ text }) => (
  <div className="relink-md">
    <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>{renderLatexSymbols(softenBreakTags(text))}</ReactMarkdown>
  </div>
);

export const Markdown = memo(MarkdownView);
