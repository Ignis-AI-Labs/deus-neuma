// ModeMenu — the chat's standing MODE, at the composer's eye level.
//
// The one control for the conversation's bearing (Design note, 2026-08-26: […]). Four modes, one menu:
//
//   DEFAULT  free flow — gated acts raise their card per act
//   PLAN     strictly planning — read-only; the being presents a plan, the
//            operator accepts (choosing the bearing it runs under), adjusts
//            it with notes, or denies it
//   AUTO     hands-off — the dangerous bearing; gated acts flow, but the
//            protocol guard still pauses deletes, outward speech, spends,
//            and shell runs on the operator's card (protocol-guard.js)
//   RESEARCH deep research — the being reads widely (the harness counts the
//            pages it reads and sends it back below the floor), then writes a
//            full report with citations, saved in its workspace (research-mode.js)
//
// The mode belongs to the BEING, not the window (the tool:mode law): the
// menu names whose mode it is, and the choice persists per participant. The
// drop-up anchors to .relink-compose like the slash palette and AttachMenu —
// the chamfered box clips positioned descendants (proven live).

import { memo, useEffect, useRef, useState } from 'react';
import { useConsciousnessPick } from './consciousness-context.js';
import { CHAT_MODES } from './stream-preferences.js';
import { uiSound } from '../../services/ui-sound.js';

const MODE_COPY = Object.freeze({
  default: Object.freeze({ label: 'DEFAULT', desc: 'free flow — gated acts ask per act' }),
  plan: Object.freeze({ label: 'PLAN', desc: 'strictly planning — presents a plan for your verdict' }),
  auto: Object.freeze({ label: 'AUTO', desc: 'hands-off — protocol guard still gates the dangerous classes' }),
  research: Object.freeze({ label: 'RESEARCH', desc: 'deep research — reads 20+ sources, then writes a full report with citations' }),
});

const ModeMenuView = ({ disabled }) => {
  const { chatMode, setChatMode, activeCompanion } = useConsciousnessPick('chatMode', 'setChatMode', 'activeCompanion');
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Esc or a click anywhere outside closes the menu — same manners as the dock.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const whose = activeCompanion?.name;
  const current = MODE_COPY[chatMode] ? chatMode : 'default';

  return (
    <div className="relink-mode-root" ref={rootRef}>
      <button
        type="button"
        className={`relink-mode-chip is-${current}`}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`${whose ? `${whose}'s` : 'The'} chat mode — ${MODE_COPY[current].desc}${whose ? ` (${whose} only)` : ''}`}
        onClick={() => { uiSound(open ? 'close' : 'tick'); setOpen((o) => !o); }}
      >
        {MODE_COPY[current].label}
      </button>
      {open ? (
        <div className="relink-mode-menu" role="menu" aria-label="Chat mode">
          {CHAT_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="menuitemradio"
              aria-checked={mode === current}
              className={`relink-attach-menu-row is-mode-${mode}${mode === current ? ' is-active' : ''}`}
              onClick={() => {
                setOpen(false);
                if (mode === current) return;
                uiSound(mode === 'auto' ? 'confirm' : 'toggle');
                setChatMode(mode);
              }}
            >
              <span className="relink-attach-menu-mark" aria-hidden="true" />
              <span className="relink-attach-menu-name">{MODE_COPY[mode].label}</span>
              <span className="relink-attach-menu-desc">{MODE_COPY[mode].desc}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

// Memoized: the composer re-renders on every keystroke; this does not need to
// (2026-09-28 smoothness pass).
export const ModeMenu = memo(ModeMenuView);
