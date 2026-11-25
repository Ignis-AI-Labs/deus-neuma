// ChatFind — the find bar of a chat (Ctrl+F): type words, and every message of this chat that holds them is counted;
// Enter goes to the one before, Shift+Enter to the one after, Escape closes. The match is brought on screen (drawing
// earlier messages when it is above what is drawn) and its words are marked. Nothing is sent anywhere: it reads what
// the screen already holds. impure — the page's key, the transcript's scroll, the highlight registry.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { findMatches, stepMatch, findWords } from './chat-find.js';

const MARK = 'chat-find';
const MARK_HERE = 'chat-find-here';
const registry = () => (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined' ? CSS.highlights : null);

// impure — mark every occurrence of the words in the drawn transcript; those inside `here` stand out.
const markWords = (root, query, here) => {
  const marks = registry();
  if (!marks) return;
  marks.delete(MARK);
  marks.delete(MARK_HERE);
  const needle = query.trim().toLowerCase();
  if (!root || !needle) return;
  const all = [];
  const standing = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.toLowerCase();
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
      const range = new Range();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      (here && here.contains(node) ? standing : all).push(range);
    }
  }
  if (all.length) marks.set(MARK, new Highlight(...all));
  if (standing.length) marks.set(MARK_HERE, new Highlight(...standing));
};

/**
 * @param {{messages: object[], scroller: {current: ?HTMLElement}, frame: {current: ?HTMLElement}, drawnFrom: number,
 *   showFrom: (index: number) => void, onFound?: () => void}} props
 *   drawnFrom: the index of the first drawn message · showFrom: draw from this index up · onFound: the reader left the tail
 */
export const ChatFind = ({ messages, scroller, frame, drawnFrom, showFrom, onFound }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(null);
  const inputRef = useRef(null);
  const matches = useMemo(() => (open ? findMatches(messages, query) : []), [open, messages, query]);
  const standing = matches.length ? matches[Math.min(at ?? matches.length - 1, matches.length - 1)] : null;

  const close = useCallback(() => { setOpen(false); registry()?.delete(MARK); registry()?.delete(MARK_HERE); }, []);

  // Ctrl+F (Cmd+F) opens it for the chat on screen; in a window that is not this chat's, the key is left alone.
  useEffect(() => {
    const key = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'f') return;
      const el = frame.current;
      if (!el || el.offsetParent === null) return;
      const mine = el.closest('[data-window-id]');
      const theirs = document.activeElement?.closest?.('[data-window-id]');
      if (theirs && mine && theirs !== mine) return;
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [frame]);

  // New words start at the newest match.
  useEffect(() => { setAt(null); }, [query]);

  // Bring the standing match on screen: draw up to it when it is above what is drawn, then scroll to it and mark.
  useLayoutEffect(() => {
    if (!open) return;
    if (standing && standing.index < drawnFrom) { showFrom(standing.index); return; }
    const root = scroller.current;
    const here = standing ? root?.querySelector(`[data-msg="${CSS.escape(standing.id)}"]`) : null;
    if (here) { onFound?.(); here.scrollIntoView({ block: 'center' }); }
    markWords(root, query, here);
  }, [open, standing?.id, standing?.index, drawnFrom, query, messages.length]);

  if (!open) return null;
  const go = (way) => setAt((was) => stepMatch(matches.length, was, way));
  const words = findWords(query, matches.length, at === null ? null : Math.min(at, matches.length - 1));
  return (
    <div className="chat-find" role="search" aria-label="Find in this chat">
      <input ref={inputRef} className="cline-input chat-find-box" type="text" value={query} placeholder="FIND IN THIS CHAT" aria-label="Words to find in this chat"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? 'newer' : 'older'); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        }} />
      <span className="chat-find-count label-data" role="status" aria-live="polite">{words}</span>
      <button type="button" className="sec-scan label-data" disabled={!matches.length} onClick={() => go('older')} aria-label="The match before this one (Enter)">↑ OLDER</button>
      <button type="button" className="sec-scan label-data" disabled={!matches.length} onClick={() => go('newer')} aria-label="The match after this one (Shift+Enter)">↓ NEWER</button>
      <button type="button" className="sec-scan label-data" onClick={close} aria-label="Close find (Escape)">CLOSE</button>
    </div>
  );
};
