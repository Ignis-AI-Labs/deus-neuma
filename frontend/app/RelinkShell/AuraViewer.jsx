// AuraViewer — the aura, enlarged (Design note, 2026-09-26: […]).
//
// A portal to the document body (a transformed window is a containing block
// for fixed children — the zoom-surface law), on the void: the aura is
// accumulated light and anything but black eats its whispers. The plate is
// sized to the viewport and drawn at its real device pixels (AuraSigil's
// sharp-grid law); FULL SCREEN hands the frame to the display; Esc or the
// backdrop closes. impure: the portal, the fullscreen API, key and resize
// listeners.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AuraSigil } from './AuraSigil.jsx';
import { uiSound } from '../../services/ui-sound.js';

// The plate's CSS size for the room it has: the frame's chrome is ~120px tall.
const plateFor = (full) => Math.floor(Math.max(240, Math.min(
  window.innerWidth * (full ? 0.94 : 0.82),
  window.innerHeight - (full ? 64 : 180),
  full ? 4096 : 960,
)));

export const AuraViewer = ({ swept, name, facts, onClose }) => {
  const frameRef = useRef(null);
  const [full, setFull] = useState(false);
  const [px, setPx] = useState(() => plateFor(false));

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) onClose(); };
    const onSize = () => {
      const isFull = Boolean(document.fullscreenElement);
      setFull(isFull);
      setPx(plateFor(isFull));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onSize);
    document.addEventListener('fullscreenchange', onSize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onSize);
      document.removeEventListener('fullscreenchange', onSize);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [onClose]);

  const toggleFull = () => {
    uiSound('open');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else frameRef.current?.requestFullscreen?.().catch(() => {});
  };

  return createPortal(
    <div className="aura-viewer" role="dialog" aria-modal="true" aria-label={`The aura of ${name}`} onClick={onClose}>
      <div ref={frameRef} className={`aura-viewer-frame${full ? ' is-full' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="aura-viewer-bar">
          <span className="label-data aura-viewer-title">AURA <span className="aura-viewer-sep">//</span> {name}</span>
          <span className="aura-viewer-acts">
            <button type="button" className="aura-viewer-btn label-data" onClick={toggleFull}>{full ? 'EXIT FULL SCREEN' : '⛶ FULL SCREEN'}</button>
            <button type="button" className="aura-viewer-btn label-data" onClick={onClose} aria-label="Close the aura">✕</button>
          </span>
        </header>
        <div className="aura-viewer-plate">
          <AuraSigil
            form={swept.form} fit={swept.fit} cycle={swept.cycle} px={px}
            className="aura-viewer-canvas" testId="aura-sigil-large" label={`THE AURA OF ${name}`}
          />
        </div>
        <footer className="aura-viewer-facts label-data">
          {facts.map((f) => <span key={f.label}><span className="aura-viewer-k">{f.label}</span> {f.value}</span>)}
          <span className="aura-viewer-k">THE TRUE NAME IN LIGHT — FOLDED FROM THE SEAL, NEVER FROM A CHOSEN NAME</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
};
