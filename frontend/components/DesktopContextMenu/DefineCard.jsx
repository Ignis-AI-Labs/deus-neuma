// DefineCard — DEFINE's answer: what a word means, from the offline
// dictionary (electron/dictionary.cjs, over the preload bridge), at the spot
// it was asked. Two senses per part of speech at a glance, MORE for the rest.
// ASK IN CHAT drafts […] into the message
// box of the chat it was read in — drafted, never sent. Escape or a press
// elsewhere puts it away.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clampPosition } from './context-menu-view.js';
import { askTextFor, definitionText, hasMore, sensesShown } from './define-view.js';
import { uiSound } from '../../services/ui-sound.js';
import './DefineCard.css';

export const DefineCard = ({ word, x, y, sentence, composer, onClose }) => {
  const [result, setResult] = useState(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x, y });
  const boxRef = useRef(null);

  useEffect(() => {
    let alive = true;
    window.neuma.contextMenu.define(word)
      .then((r) => { if (alive) setResult(r); })
      .catch((err) => { if (alive) setResult({ word, entries: [], error: err.message }); });
    return () => { alive = false; };
  }, [word]);

  // Keep the whole card on screen as its answer arrives and as MORE opens.
  useLayoutEffect(() => {
    const r = boxRef.current?.getBoundingClientRect();
    if (r) setPos(clampPosition({ x, y }, { menuW: r.width, menuH: r.height, viewW: window.innerWidth, viewH: window.innerHeight }));
  }, [x, y, result, open]);

  useEffect(() => {
    const away = (e) => { if (!boxRef.current?.contains(e.target)) { uiSound('close'); onClose(); } };
    const escape = (e) => { if (e.key === 'Escape') { e.preventDefault(); uiSound('close'); onClose(); } };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', escape, true);
    };
  }, [onClose]);

  const ask = () => {
    uiSound('activate');
    composer.dispatchEvent(new CustomEvent('neuma:ask', { detail: { text: askTextFor(word, sentence) } }));
    onClose();
  };
  const copy = () => {
    uiSound('activate');
    void navigator.clipboard.writeText(definitionText(result));
  };

  const entries = result?.entries ?? [];
  return (
    <div ref={boxRef} className="define-card" role="dialog" aria-label={`Definition of ${word}`}
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}>
      <div className="define-word">{word}</div>
      {!result ? <p className="define-note">Looking up…</p> : null}
      {result?.error ? <p className="define-note is-error" role="alert">{result.error}</p> : null}
      {result && !result.error && entries.length === 0 ? (
        <p className="define-note">No entry for “{word}” in the offline dictionary. Ask in chat to have it explained.</p>
      ) : null}
      {entries.map((entry) => (
        <section className="define-entry" key={`${entry.pos}-${entry.lemma}`}>
          <div className="define-pos label-data">
            {entry.pos}{entry.lemma.toLowerCase() !== word.toLowerCase() ? ` · ${entry.lemma}` : ''}
          </div>
          <ol className="define-senses">
            {sensesShown(entry, open).map((s, i) => (
              <li key={i}>
                <span className="define-def">{s.definition}</span>
                {s.examples[0] ? <span className="define-eg">“{s.examples[0]}”</span> : null}
                {s.synonyms.length ? <span className="define-syn">also {s.synonyms.join(', ')}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ))}
      <div className="define-acts">
        <button type="button" className="define-act" disabled={!composer}
          title={composer ? 'Draft the question in this chat’s message box' : 'No chat here to ask in'} onClick={ask}>
          ASK IN CHAT
        </button>
        {hasMore(entries) ? (
          <button type="button" className="define-act" onClick={() => { uiSound('toggle'); setOpen(!open); }}>
            {open ? 'LESS' : 'MORE'}
          </button>
        ) : null}
        {entries.length ? <button type="button" className="define-act" onClick={copy}>COPY</button> : null}
      </div>
    </div>
  );
};
