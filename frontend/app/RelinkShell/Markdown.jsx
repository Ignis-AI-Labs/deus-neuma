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
import { openablePath, webAddress } from './path-link.js';
import { openPathDoor, openPathMenu, pathMenuAnchor, openWebLink } from './path-menu.js';
import { CopyWord } from './copy-word.jsx';
import { codeBlockText } from './copy-text.js';
import { isShortCell } from './table-cell.js';
import { recordDoor, remarkDoors } from './doors/record-door.js';
import { openDoor } from './doors/open-door.js';
import { useWindows } from '../windowing/use-windows.js';
import './RelinkMarkdown.css';


const PLUGINS = [remarkGfm, remarkDoors];

// A code span whose whole content is a path is a DOOR. Plain click/Enter opens
// it; right-click or Ctrl/⌘+click raises the existing options (PathOpener.jsx).

// A code span whose whole content is a web address is a LINK: a click opens it in the browser; right-click (or the
// menu key) offers Open link and Copy link, never the file manager.
const WebSpan = ({ url, children, node: _node, ...props }) => (
  <a
    {...props}
    className="relink-md-path relink-md-web"
    href={url}
    target="_blank"
    rel="noreferrer noopener"
    title={`${url}\nClick to open in your browser · Right-click for options`}
    onClick={(e) => { e.preventDefault(); openWebLink(url); }}
    onContextMenu={(e) => { e.preventDefault(); openPathMenu(url, e.clientX, e.clientY); }}
    onKeyDown={(e) => { if (e.key === 'ContextMenu') { e.preventDefault(); openPathMenu(url, ...pathMenuAnchor(e.currentTarget)); } }}
  >
    <code>{children}</code>
  </a>
);

const PathSpan = ({ path, children, ...props }) => (
  <code
    {...props}
    className="relink-md-path"
    role="link"
    tabIndex={0}
    title={`${path}\nClick to open · Right-click (or Ctrl+click) for options`}
    onContextMenu={(e) => { e.preventDefault(); openPathMenu(path, e.clientX, e.clientY); }}
    onClick={(e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) openPathMenu(path, e.clientX, e.clientY);
      else openPathDoor(path);
    }}
    onKeyDown={(e) => {
      if (e.key === 'ContextMenu' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        openPathMenu(path, ...pathMenuAnchor(e.currentTarget));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        openPathDoor(path);
      }
    }}
  >
    {children}
  </code>
);

// A house record or place a member names (an audience id, […]) is a DOOR to it:
// one press opens the POSITIONS window on that tab with the record marked (doors/record-door.js).
const DoorSpan = ({ door, children, ...props }) => {
  const windows = useWindows();
  if (!windows?.dispatch) return <code {...props}>{children}</code>;
  const words = Array.isArray(children) ? children.join('') : children;
  return (
    <button type="button" className="relink-md-door" title={door.words} aria-label={`${words} — ${door.words}`} onClick={() => openDoor(door, windows)}>
      <code {...props}>{children}</code>
    </button>
  );
};

const COMPONENTS = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  // A table stands in its own frame (Design note, 2026-10-24: […]) — the frame scrolls sideways when the table is wider
  // than the message, so the table stays a table and no column is crushed.
  table: ({ node, ...props }) => (
    <div className="relink-md-table"><table {...props} /></div>
  ),
  th: ({ node, ...props }) => <th {...props} className={isShortCell(node) ? 'relink-md-short' : undefined} />,
  td: ({ node, ...props }) => <td {...props} className={isShortCell(node) ? 'relink-md-short' : undefined} />,
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
    const words = Array.isArray(children) ? children.join('') : children;
    // A fenced block's text ends in a newline; only a span inside a sentence is a door.
    const door = /\n/.test(String(words)) ? null : recordDoor(words);
    if (door) return <DoorSpan door={door} {...props}>{children}</DoorSpan>;
    // A web address first: a site with a path after it would otherwise read as a folder on this machine.
    const web = /\n/.test(String(words)) ? null : webAddress(words);
    if (web) return <WebSpan url={web} {...props}>{children}</WebSpan>;
    const path = openablePath(words, { relative: true });
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
