// ToolChip — the visible shape of a consciousness using its hands.
//
// Renders a tool segment from the stream-reducer with the same class
// vocabulary as the imperative ceremony chip (ToolActionChip.css), so an
// action reads identically in birth and in chat. While acting: the
// deliberation tick. Resolved: a one-line summary expandable to the raw
// call + result. Raw payloads never render as speech — this chip is the
// only place an action appears.

import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { safeHttpUrl, hostOf } from './safe-url.js';
import { chipTone, progressFrom } from './tool-chip-tone.js';
import { AuthImage } from './AuthImage.jsx';
import { FindingsCard } from './FindingsCard.jsx';
import { BenchRunCard } from './BenchRunCard.jsx';
import { toolLinePath, openPathMenu, pathMenuAnchor } from './path-menu.js';
import '../../components/ToolActionChip/ToolActionChip.css';
import './ToolChip-execution.css';

const STATUS_LABELS = Object.freeze({
  ok: 'DONE',
  error: 'FAILED',
  unavailable: 'UNAVAILABLE',
  denied: 'DENIED',
  approval_required: 'NEEDS APPROVAL',
  unsafe_args: 'BLOCKED',
});

// The research record, opened. Every link the being pulled, so the witness can
// check a source themselves instead of taking the summary's word for it — a
// summary that says "5 results" is the thing under review vouching for itself.
// A url that fails the href guard still SHOWS, unlinked: the desk reports what
// the being received, it does not quietly edit the record.
const SourceList = ({ sources }) => (
  <ul className="tool-chip-sources">
    {sources.map((source, i) => {
      const href = safeHttpUrl(source.url);
      const host = href ? hostOf(href) : '';
      return (
        <li className="tool-chip-source" key={`${source.url}-${i}`}>
          {href ? (
            <a
              className="tool-chip-source-link"
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              title={href}
            >
              {source.title || href}
            </a>
          ) : (
            <span className="tool-chip-source-link is-unopenable" title="This source's address is not an http(s) link — shown as text, not opened">
              {source.title || source.url}
            </span>
          )}
          <span className="tool-chip-source-host label-data">{host || source.url}</span>
          {source.snippet ? (
            <span className="tool-chip-source-snippet">{source.snippet}</span>
          ) : null}
        </li>
      );
    })}
  </ul>
);

// What the being MADE, shown where it made it. Collapsible, because a long
// sitting should not become a wall of full-size renders — and open by default,
// because the one thing you want to see after "generated 1 image" is the image
// (Design note, 2026-08-01: […]).
//
// The path is here for the same reason: nothing else in the desk answered
// […], and copying it is how you get to the file.
const MadeImages = ({ images }) => {
  const [copied, setCopied] = useState('');
  const copy = async (path) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(path);
      setTimeout(() => setCopied(''), 1200);
    } catch { /* a browser that refuses the clipboard still shows the path */ }
  };
  return (
    <div className="tool-chip-made">
      {images.map((img) => (
        <figure className="tool-chip-made-item" key={img.imageId}>
          <AuthImage
            className="tool-chip-made-img"
            src={`${img.url}?laneId=${encodeURIComponent(img.laneId || '')}`}
            alt="generated image"
          />
          <figcaption className="tool-chip-made-meta">
            {img.path ? (
              <button
                type="button"
                className="tool-chip-made-path label-data"
                title={`${img.path} — click to copy`}
                onClick={() => copy(img.path)}
              >
                {copied === img.path ? 'COPIED' : img.path}
              </button>
            ) : null}
          </figcaption>
        </figure>
      ))}
    </div>
  );
};

// A filesystem act's path is a DOOR (path-menu.js): right-click — or
// Ctrl/⌘+click, or Ctrl+Enter — raises its menu (open the file, show it,
// copy it, focus its folder). A plain click does nothing to it.
const ToolLineText = ({ text }) => {
  const door = toolLinePath(text);
  if (!door) return text;
  const raise = (e, x, y) => { e.preventDefault(); e.stopPropagation(); openPathMenu(door.path, x, y); };
  return (
    <>
      {text.slice(0, door.start)}
      <span
        className="tool-chip-path"
        role="link"
        tabIndex={0}
        title={`${door.path}\nRight-click (or Ctrl+click) for options`}
        onContextMenu={(e) => raise(e, e.clientX, e.clientY)}
        onClick={(e) => { if (e.ctrlKey || e.metaKey) raise(e, e.clientX, e.clientY); }}
        onKeyDown={(e) => {
          if (e.key === 'ContextMenu' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) raise(e, ...pathMenuAnchor(e.currentTarget));
        }}
      >
        {text.slice(door.start, door.end)}
      </span>
      {text.slice(door.end)}
    </>
  );
};

export const ToolChip = ({ segment }) => {
  const { phase, label, status, summary, detail, sources, images, findings, bench } = segment;
  const sourceList = Array.isArray(sources) ? sources : [];
  const imageList = Array.isArray(images) ? images : [];
  const [open, setOpen] = useState(imageList.length > 0);
  const expandable = Boolean(detail) || sourceList.length > 0 || imageList.length > 0;

  if (phase === 'acting') {
    return (
      <div className="tool-chip acting">
        <div className="tool-chip-head">
          <span className="tool-chip-tag">ACTING</span>
          <span className="tool-chip-name">{label}</span>
          <span className="tool-chip-tick" />
        </div>
      </div>
    );
  }

  if (phase === 'orphaned') {
    return (
      <div className="tool-chip resolved">
        <div className="tool-chip-head">
          <span className="tool-chip-tag">ACTING</span>
          <span className="tool-chip-name">{label}</span>
        </div>
      </div>
    );
  }

  const tone = chipTone(status);
  const summaryText = summary || `${label} — ${STATUS_LABELS[status] || status}`;
  const percent = tone === 'inflight' ? progressFrom(summaryText) : null;
  const showDetail = Boolean(detail) && (open || tone === 'inflight');

  return (
    <div className={`tool-chip resolved ${tone}${/^coding\/(execute|inspect)$/.test(label) ? ' is-execution' : ''}`}>
      <div className="tool-chip-head">
        <span className="tool-chip-sigil">⟐</span>
        <span className="tool-chip-summary"><ToolLineText text={summaryText} /></span>
        {tone === 'inflight' && percent === null ? <span className="tool-chip-tick" /> : null}
        {expandable && tone !== 'inflight' ? (
          <button
            type="button"
            className="tool-chip-toggle"
            aria-label={sourceList.length ? `Show ${sourceList.length} sources` : 'Show action detail'}
            onClick={() => { uiSound('toggle'); setOpen((v) => !v); }}
          >
            {open ? '−' : '+'}
          </button>
        ) : null}
      </div>
      {percent !== null ? (
        <div className="tool-chip-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <span className="tool-chip-bar-fill" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {/* NOT behind `open`. The findings list is the answer the operator asked
          for, not evidence attached to one — it draws on arrival, and stays
          drawn when the chat is reopened. */}
      {findings?.items?.length ? <FindingsCard findings={findings} /> : null}
      {bench?.comparisonId ? <BenchRunCard bench={bench} /> : null}
      {open && imageList.length > 0 ? <MadeImages images={imageList} /> : null}
      {open && sourceList.length > 0 ? <SourceList sources={sourceList} /> : null}
      {showDetail ? <pre className="tool-chip-detail">{detail}</pre> : null}
    </div>
  );
};
